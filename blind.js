/* 盲水印模块：DFT 频域嵌入 / 提取，零依赖
 *
 * 原理：
 *   嵌入 —— 亮度通道 padding 到 2 的幂 → 2D FFT → 文本比特 BPSK 调制后
 *           加到共轭对称的中频系数上 → 2D IFFT → ΔY 回写 RGB。
 *   提取 —— 同一 padding 规则重做 FFT，按固定种子 PRNG 重建嵌入位置，
 *           对系数实部符号做多数表决还原比特，校验帧头与 CRC。
 *
 * 说明：不使用 Web Worker（file:// 协议下浏览器禁止创建 Worker），
 *       FFT 按行/列分片让出事件循环，配合进度回调避免页面假死。
 */
window.BlindWatermark = (function () {
  'use strict';

  // ---------- 常量（嵌入/提取两端必须一致） ----------
  var MAGIC = 0xA5;        // 帧头魔数
  var SEED = 20260726;     // 位置 PRNG 固定种子
  var REDUNDANCY = 5;      // 每比特冗余位置数（实际样本含共轭镜像，为 2 倍）
  var BAND_MIN = 0.1;      // 中频环带下限（归一化半径）
  var BAND_MAX = 0.5;      // 中频环带上限
  var MAX_PAYLOAD = 255;   // payload 最大字节数
  var CHUNK = 64;          // 异步分片粒度（行/列数）

  // ---------- 基础工具 ----------
  function nextPow2(n) {
    var p = 1;
    while (p < n) p <<= 1;
    return p;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function crc8(bytes, start, len) {
    var crc = 0;
    for (var i = start; i < start + len; i++) {
      crc ^= bytes[i];
      for (var j = 0; j < 8; j++) {
        crc = (crc & 0x80) ? ((crc << 1) ^ 0x07) & 0xFF : (crc << 1) & 0xFF;
      }
    }
    return crc;
  }

  function bytesToBits(bytes) {
    var bits = new Array(bytes.length * 8);
    for (var i = 0; i < bytes.length; i++) {
      for (var j = 0; j < 8; j++) {
        bits[i * 8 + j] = (bytes[i] >> (7 - j)) & 1;
      }
    }
    return bits;
  }

  function bitsToBytes(bits) {
    var bytes = new Uint8Array(bits.length / 8);
    for (var i = 0; i < bytes.length; i++) {
      var b = 0;
      for (var j = 0; j < 8; j++) b = (b << 1) | bits[i * 8 + j];
      bytes[i] = b;
    }
    return bytes;
  }

  // ---------- 1D FFT（迭代 radix-2，就地作用于 re/im[off, off+n)） ----------
  function fft1d(re, im, off, n, invert) {
    var i, j, bit, tr, ti;
    for (i = 1, j = 0; i < n; i++) {
      bit = n >> 1;
      for (; j & bit; bit >>= 1) j ^= bit;
      j ^= bit;
      if (i < j) {
        tr = re[off + i]; re[off + i] = re[off + j]; re[off + j] = tr;
        ti = im[off + i]; im[off + i] = im[off + j]; im[off + j] = ti;
      }
    }
    for (var len = 2; len <= n; len <<= 1) {
      var ang = 2 * Math.PI / len * (invert ? -1 : 1);
      var wr = Math.cos(ang), wi = Math.sin(ang);
      var half = len >> 1;
      for (i = 0; i < n; i += len) {
        var cwr = 1, cwi = 0;
        for (j = 0; j < half; j++) {
          var a = off + i + j, b = a + half;
          var ur = re[a], ui = im[a];
          var vr = re[b] * cwr - im[b] * cwi;
          var vi = re[b] * cwi + im[b] * cwr;
          re[a] = ur + vr; im[a] = ui + vi;
          re[b] = ur - vr; im[b] = ui - vi;
          var nr = cwr * wr - cwi * wi;
          cwi = cwr * wi + cwi * wr;
          cwr = nr;
        }
      }
    }
    if (invert) {
      for (i = 0; i < n; i++) { re[off + i] /= n; im[off + i] /= n; }
    }
  }

  // ---------- 2D FFT（行列分解，分片异步） ----------
  // d = {re, im, w, h}，w/h 均为 2 的幂；onProgress(0..1) 可选
  function fft2dAsync(d, invert, onProgress, done) {
    var w = d.w, h = d.h, re = d.re, im = d.im;
    var colRe = new Float64Array(h), colIm = new Float64Array(h);
    var total = h + w;
    var r = 0, c = 0;

    function rowsChunk() {
      var end = Math.min(r + CHUNK, h);
      for (; r < end; r++) {
        fft1d(re, im, r * w, w, invert);
      }
      if (onProgress) onProgress(r / total);
      if (r < h) { setTimeout(rowsChunk, 0); return; }
      setTimeout(colsChunk, 0);
    }

    function colsChunk() {
      var end = Math.min(c + CHUNK, w);
      for (; c < end; c++) {
        for (var i = 0; i < h; i++) { colRe[i] = re[i * w + c]; colIm[i] = im[i * w + c]; }
        fft1d(colRe, colIm, 0, h, invert);
        for (var i2 = 0; i2 < h; i2++) { re[i2 * w + c] = colRe[i2]; im[i2 * w + c] = colIm[i2]; }
      }
      if (onProgress) onProgress((h + c) / total);
      if (c < w) { setTimeout(colsChunk, 0); return; }
      done();
    }

    rowsChunk();
  }

  // ---------- 亮度通道（边缘复制 padding 到 2 的幂） ----------
  function extractLuma(data, w, h, w2, h2) {
    var y = new Float64Array(w2 * h2);
    for (var r = 0; r < h2; r++) {
      var sr = r < h ? r : h - 1;
      var rowBase = r * w2, srcBase = sr * w;
      for (var c = 0; c < w2; c++) {
        var sc = c < w ? c : w - 1;
        var i = (srcBase + sc) * 4;
        y[rowBase + c] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
    }
    return y;
  }

  // ---------- 嵌入位置生成器 ----------
  // 中频环带内随机取点，与其共轭镜像成对登记、互不复用
  function makePositionGen(h, w) {
    var rand = mulberry32(SEED);
    var seen = new Set();
    return function next() {
      for (;;) {
        var u = (rand() * h) | 0;
        var v = (rand() * w) | 0;
        var fu = Math.min(u, h - u) / h;
        var fv = Math.min(v, w - v) / w;
        var rn = Math.sqrt(fu * fu + fv * fv);
        if (rn < BAND_MIN || rn > BAND_MAX) continue;
        var idx = u * w + v;
        var mirror = ((h - u) % h) * w + ((w - v) % w);
        if (idx === mirror || seen.has(idx) || seen.has(mirror)) continue;
        seen.add(idx);
        seen.add(mirror);
        return { idx: idx, mirror: mirror };
      }
    };
  }

  // ---------- 帧编解码 ----------
  function encodeFrame(text) {
    var payload = new TextEncoder().encode(text);
    if (payload.length === 0) throw new Error('盲水印文本为空');
    if (payload.length > MAX_PAYLOAD) throw new Error('盲水印文本过长（UTF-8 编码后超过 ' + MAX_PAYLOAD + ' 字节）');
    var frame = new Uint8Array(3 + payload.length + 1);
    frame[0] = MAGIC;
    frame[1] = payload.length >> 8;
    frame[2] = payload.length & 0xFF;
    frame.set(payload, 3);
    frame[frame.length - 1] = crc8(frame, 1, 2 + payload.length);
    return frame;
  }

  // ---------- 频域写入 / 读取 ----------
  function embedBits(re, w, h, bits, alpha) {
    var gen = makePositionGen(h, w);
    for (var i = 0; i < bits.length; i++) {
      var delta = bits[i] ? alpha : -alpha;
      for (var k = 0; k < REDUNDANCY; k++) {
        var p = gen();
        re[p.idx] += delta;
        re[p.mirror] += delta;
      }
    }
  }

  // 顺序读取 count 个比特；调用方分两次调用时位置序列与一次性生成一致
  function readBits(gen, re, count) {
    var bits = new Array(count);
    for (var i = 0; i < count; i++) {
      var sum = 0;
      for (var k = 0; k < REDUNDANCY; k++) {
        var p = gen();
        sum += re[p.idx] + re[p.mirror];
      }
      bits[i] = sum > 0 ? 1 : 0;
    }
    return bits;
  }

  function clamp8(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
  }

  // ---------- 公开 API：embed(imageData, text, strength, onProgress) → Promise<ImageData> ----------
  // strength = 期望的空间域波纹幅度（灰度级，RMS），内部换算为频域增量：
  //   M 个随机相位频点叠加的空间波纹 RMS ≈ 2·alpha·√M / N  ⇒  alpha = strength·N / (2·√M)
  // 强度与图像尺寸解耦，保证任意分辨率下不可见性一致、且能越过 8bit 量化阈值。
  function embed(imageData, text, strength, onProgress) {
    return new Promise(function (resolve, reject) {
      var bits;
      try {
        bits = bytesToBits(encodeFrame(text));
      } catch (err) {
        reject(err);
        return;
      }

      var w = imageData.width, h = imageData.height;
      var w2 = nextPow2(w), h2 = nextPow2(h);
      var n2 = w2 * h2;
      var m = bits.length * REDUNDANCY;
      var alpha = strength * n2 / (2 * Math.sqrt(m));
      var data = imageData.data;
      var y = extractLuma(data, w, h, w2, h2);
      var yOrig = y.slice();
      var d = { re: y, im: new Float64Array(n2), w: w2, h: h2 };

      // 进度分配：正变换 0–45%，逆变换 45–90%，回写 90–100%
      fft2dAsync(d, false, function (p) {
        if (onProgress) onProgress(p * 0.45);
      }, function () {
        embedBits(d.re, w2, h2, bits, alpha);
        fft2dAsync(d, true, function (p) {
          if (onProgress) onProgress(0.45 + p * 0.45);
        }, function () {
          var out = new ImageData(w, h);
          var od = out.data;
          for (var r = 0; r < h; r++) {
            for (var c = 0; c < w; c++) {
              var delta = y[r * w2 + c] - yOrig[r * w2 + c];
              var i = (r * w + c) * 4;
              od[i] = clamp8(data[i] + delta);
              od[i + 1] = clamp8(data[i + 1] + delta);
              od[i + 2] = clamp8(data[i + 2] + delta);
              od[i + 3] = data[i + 3];
            }
          }
          if (onProgress) onProgress(1);
          resolve(out);
        });
      });
    });
  }

  // ---------- 公开 API：extract(imageData, onProgress) → Promise<string|null> ----------
  function extract(imageData, onProgress) {
    return new Promise(function (resolve) {
      var w = imageData.width, h = imageData.height;
      var w2 = nextPow2(w), h2 = nextPow2(h);
      var y = extractLuma(imageData.data, w, h, w2, h2);
      var d = { re: y, im: new Float64Array(w2 * h2), w: w2, h: h2 };

      fft2dAsync(d, false, onProgress, function () {
        var gen = makePositionGen(h2, w2);
        var head = bitsToBytes(readBits(gen, d.re, 24));
        if (head[0] !== MAGIC) { resolve(null); return; }
        var len = (head[1] << 8) | head[2];
        if (len <= 0 || len > MAX_PAYLOAD) { resolve(null); return; }

        var rest = bitsToBytes(readBits(gen, d.re, len * 8 + 8));
        var frame = new Uint8Array(3 + len + 1);
        frame.set(head, 0);
        frame.set(rest, 3);
        if (crc8(frame, 1, 2 + len) !== frame[frame.length - 1]) { resolve(null); return; }

        resolve(new TextDecoder().decode(frame.slice(3, 3 + len)));
      });
    });
  }

  return {
    embed: embed,
    extract: extract,
    MAX_PAYLOAD: MAX_PAYLOAD
  };
})();
