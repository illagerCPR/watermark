/* 盲水印模块：DFT 频域嵌入 / 提取，零依赖
 *
 * 原理（v2，瓦片架构，抗几何攻击版）：
 *   嵌入 —— 在空频谱上生成一个 256×256 delta 瓦片：同步模板（半径 0.05N 处 4 峰
 *           星座 + 共轭镜像，随机相位，幅度 3α）+ 文本比特幅度差分对（每比特取成对
 *           随机频点，bit1 时 F(p1)=α∠φ、F(p2)=0，bit0 反之，共轭镜像保证 IFFT 为实）
 *           → 单次 2D IFFT 得空间瓦片 → 按 256 周期平铺叠加到亮度通道。
 *           α 由强度（目标 RMS）经 Parseval 反解，并按内容自适应提升（≥2×payload
 *           带内容幅度中位数，保证强内容图可提取）。
 *   提取 —— 两级滑窗网格（B/2 粗 + B/4 细）取 256² 块 → FFT → 幅度谱。瓦片的周期
 *           平铺使任意窗口恰含一个循环位移周期，幅度谱平移不变，天然抗平移/裁剪。
 *           解码先试星座匹配（差分模板评分找半径/角度候选），失败再走旋转/缩放
 *           纯频域校正（径向能量角度直方图估 θ、定 θ 扫半径估 s，按校正坐标直接
 *           采样，无第二次像素插值）→ 成对频点幅度差分（(m1-m2)/(m1+m2+1) 归一化
 *           表决）还原比特 → 魔数软门控（汉明距 ≤1）+ CRC8 硬裁决，2 块一致采信。
 *
 * 几何鲁棒性（图幅 ≥ 256×256）：
 *   任意平移、裁剪（保留 ≥256² 且内容不极端）、旋转（15°/90° 等实测可过，任意
 *   角度在内容方向性干扰强时可能失败）、缩放约 0.7×–1.45×（插值损失大时受限）。
 *   小图（任一边 < 256）退化为整图 padding 单块模式，无几何鲁棒性。
 *
 * 说明：不使用 Web Worker（file:// 协议下浏览器禁止创建 Worker），
 *       FFT 按行/列分片让出事件循环（MessageChannel，避免 setTimeout
 *       深层嵌套被钳制到 4ms），配合进度回调避免页面假死。
 */
window.BlindWatermark = (function () {
  'use strict';

  // ---------- 常量（嵌入/提取两端必须一致） ----------
  var MAGIC = 0xA5;          // 帧头魔数
  var SEED = 20260726;       // 位置 PRNG 固定种子
  var BLOCK = 256;           // 分块尺寸（2 的幂）
  var BAND_MIN = 0.12;       // payload 环带下限（归一化半径）
  var BAND_MAX = 0.35;       // payload 环带上限（缩放 0.7× 时恰好触及 0.5N 奈奎斯特）
  var TEMPLATE_R = 0.05;     // 模板峰值半径（归一化）
  var RED_HEADER = 12;        // 帧头（魔数+长度）每比特冗余对数
  var RED_MIN = 3;           // payload 每比特冗余对数下限
  var RED_MAX = 8;           // payload 每比特冗余对数上限
  var MAX_PAYLOAD = 200;     // payload 最大字节数（保证 RED_MIN 下位置充足）
  var SCALE_MIN = 0.65;      // 缩放估计合法区间
  var SCALE_MAX = 1.5;
  var CHUNK = 64;            // FFT 异步分片粒度（行/列数）
  var CAL = 1.0;             // 强度校准系数（实测 RMSE 后调整）

  // ---------- 宏任务调度（MessageChannel 无 4ms 钳制） ----------
  var yieldTask = (function () {
    if (typeof MessageChannel !== 'undefined') {
      var ch = new MessageChannel();
      var queue = [];
      ch.port1.onmessage = function () {
        var cb = queue.shift();
        if (cb) cb();
      };
      return function (cb) { queue.push(cb); ch.port2.postMessage(0); };
    }
    return function (cb) { setTimeout(cb, 0); };
  })();

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

  function median(arr) {
    if (arr.length === 0) return 0;
    arr.sort(function (a, b) { return a - b; });
    var m = arr.length >> 1;
    return arr.length % 2 ? arr[m] : (arr[m - 1] + arr[m]) / 2;
  }

  function clamp8(v) {
    return v < 0 ? 0 : v > 255 ? 255 : v;
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
      if (r < h) { yieldTask(rowsChunk); return; }
      yieldTask(colsChunk);
    }

    function colsChunk() {
      var end = Math.min(c + CHUNK, w);
      for (; c < end; c++) {
        for (var i = 0; i < h; i++) { colRe[i] = re[i * w + c]; colIm[i] = im[i * w + c]; }
        fft1d(colRe, colIm, 0, h, invert);
        for (var i2 = 0; i2 < h; i2++) { re[i2 * w + c] = colRe[i2]; im[i2 * w + c] = colIm[i2]; }
      }
      if (onProgress) onProgress((h + c) / total);
      if (c < w) { yieldTask(colsChunk); return; }
      done();
    }

    rowsChunk();
  }

  // ---------- 亮度通道 ----------
  // 从 (bx,by) 截取 B×B 亮度块
  function lumaBlock(data, w, bx, by, B) {
    var y = new Float64Array(B * B);
    for (var r = 0; r < B; r++) {
      var rowBase = r * B, srcBase = (by + r) * w + bx;
      for (var c = 0; c < B; c++) {
        var i = (srcBase + c) * 4;
        y[rowBase + c] = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
      }
    }
    return y;
  }
  // ---------- 频点坐标（带符号归一化） ----------
  function signedFreq(u, n) {
    return u <= n / 2 ? u / n : (u - n) / n;
  }

  // 旋转角估计：模板带内径向能量角度直方图（折叠到 45° 周期）。
  // 模板 4 峰旋转 θ0 后位于 θ0+k·45°，折叠后相干叠加成单峰；内容方向随机非相干。
  // 径向积分对非整周期泄漏与缩放均鲁棒（能量守恒、角度不变）。返回角度（度，[0,45)）。
  function estimateRotation(mag, N) {
    var rb = templateRadius(N, N).ru;
    var rLo = Math.max(3, rb / SCALE_MAX), rHi = rb / SCALE_MIN;
    var NB = 90; // 0.5° 分辨率
    var E = new Float64Array(NB);
    for (var r = rLo; r <= rHi; r += 1) {
      for (var tDeg = 0; tDeg < 180; tDeg += 0.5) {
        var a = tDeg * Math.PI / 180;
        var m = sampleMag(mag, N, N, r * Math.sin(a) / N, r * Math.cos(a) / N);
        var bin = Math.round((tDeg % 45) * 2) % NB;
        E[bin] += m;
      }
    }
    // 平滑（3 点滑动）后取峰，抛物线细化
    var S = new Float64Array(NB);
    for (var i = 0; i < NB; i++) S[i] = E[(i + NB - 1) % NB] + 2 * E[i] + E[(i + 1) % NB];
    var best = 0;
    for (var j = 1; j < NB; j++) if (S[j] > S[best]) best = j;
    var y0 = S[(best + NB - 1) % NB], y1 = S[best], y2 = S[(best + 1) % NB];
    var d = 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2);
    if (!isFinite(d)) d = 0;
    d = Math.max(-1, Math.min(1, d));
    return (best + d) * 0.5;
  }

  // ---------- 嵌入位置生成器 ----------
  // payload 环带内随机取点，与共轭镜像互不复用；fu/fv 供提取端校正采样
  function makePositionGen(h, w) {
    var rand = mulberry32(SEED);
    var seen = new Set();
    return function next() {
      for (;;) {
        var u = (rand() * h) | 0;
        var v = (rand() * w) | 0;
        var fu = signedFreq(u, h);
        var fv = signedFreq(v, w);
        var rn = Math.sqrt(fu * fu + fv * fv);
        if (rn < BAND_MIN || rn > BAND_MAX) continue;
        var idx = u * w + v;
        var mirror = ((h - u) % h) * w + ((w - v) % w);
        if (idx === mirror || seen.has(idx) || seen.has(mirror)) continue;
        seen.add(idx);
        seen.add(mirror);
        return { idx: idx, mirror: mirror, fu: fu, fv: fv };
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

  // payload 冗余对数：位置预算内自适应，嵌入/提取两端按同一公式推导
  function redundancyFor(restBits, h, w) {
    var budget = Math.floor(0.16 * h * w); // 环带可用位置数的安全估计
    var red = Math.floor(budget / (2 * restBits));
    return red < RED_MIN ? RED_MIN : red > RED_MAX ? RED_MAX : red;
  }

  // ---------- 同步模板 ----------
  function templateRadius(h, w) {
    return {
      ru: Math.max(4, Math.round(TEMPLATE_R * h)),
      rv: Math.max(4, Math.round(TEMPLATE_R * w))
    };
  }

  // 模板星座 4 个峰值位置（含对角取整）
  function templatePeakPos(h, w) {
    var tr = templateRadius(h, w);
    var du = Math.round(tr.ru / Math.SQRT2), dv = Math.round(tr.rv / Math.SQRT2);
    return [[tr.ru, 0], [du, dv], [0, tr.rv], [h - du, dv]];
  }

  // 模板星座名义归一化半径（嵌入取整后的真实均值，提取端缩放基准）
  function templateNominalRn(h, w) {
    var peaks = templatePeakPos(h, w);
    var rnSum = 0;
    for (var i = 0; i < peaks.length; i++) {
      var fu = signedFreq(peaks[i][0], h), fv = signedFreq(peaks[i][1], w);
      rnSum += Math.sqrt(fu * fu + fv * fv);
    }
    return rnSum / peaks.length;
  }

  // ---------- 瓦片嵌入：空频谱上的绝对幅度编码 ----------
  // 差分对：bit=1 时 F(p1)=α∠φ、F(p2)=0；bit=0 反之。φ 随机（空间波纹呈噪声状，
  // 避免规则纹理），镜像取共轭保证 IFFT 为实数。
  function embedPairsTile(re, im, gen, bits, alpha, red, rand) {
    for (var i = 0; i < bits.length; i++) {
      for (var k = 0; k < red; k++) {
        var p1 = gen(), p2 = gen();
        var hi = bits[i] ? p1 : p2;
        var phi = rand() * 2 * Math.PI;
        var cr = alpha * Math.cos(phi), ci = alpha * Math.sin(phi);
        re[hi.idx] = cr; im[hi.idx] = ci;
        re[hi.mirror] = cr; im[hi.mirror] = -ci;
      }
    }
  }

  // 瓦片模板：星座 4 峰（含镜像 8 点），随机相位，固定幅度 3α
  function embedTemplateTile(re, im, N, amp, rand) {
    var peaks = templatePeakPos(N, N);
    for (var i = 0; i < peaks.length; i++) {
      var u = peaks[i][0], v = peaks[i][1];
      var idx = u * N + v, mir = ((N - u) % N) * N + ((N - v) % N);
      var phi = rand() * 2 * Math.PI;
      var cr = amp * Math.cos(phi), ci = amp * Math.sin(phi);
      re[idx] = cr; im[idx] = ci;
      re[mir] = cr; im[mir] = -ci;
    }
  }

  // ---------- 提取端：幅度谱双线性采样（wrap 边界） ----------
  function sampleMag(mag, h, w, fu, fv) {
    var u = (((fu * h) % h) + h) % h;
    var v = (((fv * w) % w) + w) % w;
    var u0 = u | 0, v0 = v | 0;
    var du = u - u0, dv = v - v0;
    var u1 = (u0 + 1) % h, v1 = (v0 + 1) % w;
    var m00 = mag[u0 * w + v0], m01 = mag[u0 * w + v1];
    var m10 = mag[u1 * w + v0], m11 = mag[u1 * w + v1];
    return (m00 * (1 - du) + m10 * du) * (1 - dv) + (m01 * (1 - du) + m11 * du) * dv;
  }

  // 差分模板评分：模板峰(on)与 22.5°空位(off)的幅度差中位数。内容邻近频点幅度
  // 相近（空间相关）被差分抵消，模板差分保留。findConstellation/estimateScaleR 共用。
  function diffScore(mag, h, w, r, tRad) {
    var HALF = Math.PI / 8; // 22.5°
    var diffs = [];
    for (var j = 0; j < 8; j++) {
      var aOn = tRad + j * Math.PI / 4;
      var aOff = aOn + HALF;
      var mOn = sampleMag(mag, h, w, r * Math.sin(aOn) / h, r * Math.cos(aOn) / w);
      var mOff = sampleMag(mag, h, w, r * Math.sin(aOff) / h, r * Math.cos(aOff) / w);
      diffs.push(mOn - mOff);
    }
    return median(diffs);
  }

  // ---------- 提取端：模板星座匹配检测 ----------
  // 在半径/角度网格上对 45° 周期星座做匹配滤波：score = 8 个图案采样点的中位数。
  // 天然杂峰难以凑齐整个图案，远比单峰检测鲁棒。返回按得分降序的 top-3 候选
  // [{r, theta, score}]（≤3 个），由 decodeBlock 逐一尝试。
  function findConstellation(mag, h, w) {
    // 差分模板：每个模板峰旁（22.5°偏移）设"空位"，检测时比较 |F(on)| - |F(off)|。
    // 内容在邻近频点幅度相近（空间相关），差分后被抵消；模板差分保留。
    var r0 = templateRadius(h, w).ru;
    var rMin = Math.max(4, Math.ceil(r0 / SCALE_MAX));
    var rMax = Math.floor(r0 / SCALE_MIN);
    var top = [];
    for (var r = rMin; r <= rMax; r++) {
      for (var tDeg = 0; tDeg < 45; tDeg++) {
        var sc = diffScore(mag, h, w, r, tDeg * Math.PI / 180);
        if (sc > 0) top.push({ r: r, tDeg: tDeg, score: sc });
      }
    }
    if (top.length === 0) return [];
    top.sort(function (a, b) { return b.score - a.score; });
    var merged = [];
    for (var i = 0; i < top.length && merged.length < 8; i++) {
      var c = top[i], dup = false;
      for (var j = 0; j < merged.length; j++) {
        if (Math.abs(merged[j].r - c.r) <= 1 && Math.abs(merged[j].tDeg - c.tDeg) <= 1) { dup = true; break; }
      }
      if (!dup) merged.push(c);
    }
    var out = [];
    for (var m = 0; m < merged.length; m++) {
      var b = merged[m];
      var sm = diffScore(mag, h, w, b.r - 1, b.tDeg * Math.PI / 180), sp = diffScore(mag, h, w, b.r + 1, b.tDeg * Math.PI / 180);
      var dr = 0.5 * (sm - sp) / (sm - 2 * b.score + sp);
      if (!isFinite(dr)) dr = 0;
      dr = Math.max(-1, Math.min(1, dr));
      var tm = diffScore(mag, h, w, b.r, (b.tDeg - 1) * Math.PI / 180), tp = diffScore(mag, h, w, b.r, (b.tDeg + 1) * Math.PI / 180);
      var dt = 0.5 * (tm - tp) / (tm - 2 * b.score + tp);
      if (!isFinite(dt)) dt = 0;
      dt = Math.max(-1, Math.min(1, dt));
      out.push({ r: b.r + dr, theta: (b.tDeg + dt) * Math.PI / 180, score: b.score });
    }
    return out;
  }

  // 模式匹配解码：星座检测 → 缩放细化 × 8 个 45° 旋转假设 × 角度微调 → 差分解码 + CRC 裁决
  // （payload 采样对缩放/角度误差极敏感：带缘 89bin 处 0.5% 缩放误差即 0.45bin 偏移）
  var SCALE_REFINE = [1, 0.995, 1.005, 0.99, 1.01, 0.985, 1.015, 0.98, 1.02, 0.97, 1.03, 0.96, 1.04];
  var THETA_REFINE = [0, -0.25, 0.25, -0.5, 0.5, -0.75, 0.75, -1, 1];
  function decodeBlock(re, im, mag, N) {
    var candidates = findConstellation(mag, N, N);
    for (var ci = 0; ci < candidates.length; ci++) {
      var c = candidates[ci];
      var s0 = templateNominalRn(N, N) * N / c.r; // c.r 单位为 bin，换回归一化半径
      for (var sr = 0; sr < SCALE_REFINE.length; sr++) {
        var s = s0 * SCALE_REFINE[sr];
        if (s < SCALE_MIN || s > SCALE_MAX) continue;
        for (var k = 0; k < 8; k++) {
          for (var tr2 = 0; tr2 < THETA_REFINE.length; tr2++) {
            var theta = c.theta + k * Math.PI / 4 + THETA_REFINE[tr2] * Math.PI / 180;
            var text = tryDecode(mag, N, s, theta);
            if (text !== null) return text;
          }
        }
      }
    }
    return null;
  }

  // 缩放半径估计：固定 θ（estimateRotation 已给出），沿半径扫差分模板评分取峰。
  // 纯频域，无像素重采样——旋转/缩放攻击下 findConstellation 失败时的备用参数源。
  function estimateScaleR(mag, N, thetaDeg) {
    var r0 = templateRadius(N, N).ru;
    var rLo = Math.max(4, Math.ceil(r0 / SCALE_MAX)), rHi = Math.floor(r0 / SCALE_MIN);
    var tRad = thetaDeg * Math.PI / 180;
    var best = -1, bestScore = -Infinity;
    for (var r = rLo; r <= rHi; r += 0.25) {
      var sc = diffScore(mag, N, N, r, tRad);
      if (sc > bestScore) { bestScore = sc; best = r; }
    }
    if (best < 0) return r0;
    var sm = diffScore(mag, N, N, best - 0.25, tRad), sp = diffScore(mag, N, N, best + 0.25, tRad);
    var dr = 0.5 * (sm - sp) / (sm - 2 * bestScore + sp);
    if (!isFinite(dr)) dr = 0;
    return best + Math.max(-0.25, Math.min(0.25, dr)) * 0.25;
  }

  // 旋转/缩放校正解码（纯频域）：estimateRotation 给 θ、estimateScaleR 给 r，
  // 在旋转频谱上按校正坐标直接采样（tryDecode 内置变换），无第二次像素插值。
  // θ≈0 也照常尝试：45° 整数倍旋转会使星座重合（est 折叠到 0），payload 由 8 个
  // k·45° 假设覆盖；此时 findConstellation 往往失效，本路径是唯一救星。
  function decodeBlockRot(mag, N) {
    var thetaDeg = estimateRotation(mag, N);
    var rPeak = estimateScaleR(mag, N, thetaDeg);
    var s0 = templateNominalRn(N, N) * N / rPeak;
    for (var sr = 0; sr < SCALE_REFINE.length; sr++) {
      var s = s0 * SCALE_REFINE[sr];
      if (s < SCALE_MIN || s > SCALE_MAX) continue;
      for (var k = 0; k < 8; k++) {
        for (var tr2 = 0; tr2 < THETA_REFINE.length; tr2++) {
          var theta = thetaDeg * Math.PI / 180 + k * Math.PI / 4 + THETA_REFINE[tr2] * Math.PI / 180;
          var text = tryDecode(mag, N, s, theta);
          if (text !== null) return text;
        }
      }
    }
    return null;
  }

  // ---------- 提取端：幅度差分解码 ----------
// tiled 架构下提取窗恰含一个水印周期（循环位移），幅度谱平移不变，
// 故无需估计平移；成对位置幅度对决 + 多数表决还原比特。旋转/缩放
// 由星座匹配估计后校正采样坐标。
  function tryDecode(mag, N, s, theta) {
    var cos = Math.cos(theta), sin = Math.sin(theta);
    var gen = makePositionGen(N, N);

    function readBits(count, red) {
      var bits = new Array(count);
      for (var i = 0; i < count; i++) {
        // 归一化投票 (m1-m2)/(m1+m2+1)：内容弱的位置信号纯净（|c|<<α 时差分≈±α，
        // 票≈±1），内容强的位置差分不可靠但分母大、票被自动抑制。有界免截断。
        var votes = 0;
        for (var k = 0; k < red; k++) {
          var p1 = gen(), p2 = gen();
          var f1u = (p1.fv * sin + p1.fu * cos) / s;
          var f1v = (p1.fv * cos - p1.fu * sin) / s;
          var f2u = (p2.fv * sin + p2.fu * cos) / s;
          var f2v = (p2.fv * cos - p2.fu * sin) / s;
          var m1 = sampleMag(mag, N, N, f1u, f1v);
          var m2 = sampleMag(mag, N, N, f2u, f2v);
          votes += (m1 - m2) / (m1 + m2 + 1);
        }
        bits[i] = votes > 0 ? 1 : 0;
      }
      return bits;
    }

    // 分阶段解码：先 8bit magic 软门控（汉明距离 ≤1，容忍单 bit 翻转——magic 不参与
    // CRC，容错安全），淘汰绝大多数假候选；再读 len 与 payload，CRC8 硬裁决。
    var magicByte = bitsToBytes(readBits(8, RED_HEADER))[0];
    var mx = magicByte ^ MAGIC, mdist = 0;
    while (mx) { mdist += mx & 1; mx >>= 1; }
    if (mdist > 1) return null;
    var lenBytes = bitsToBytes(readBits(16, RED_HEADER));
    var len = (lenBytes[0] << 8) | lenBytes[1];
    if (len <= 0 || len > MAX_PAYLOAD) return null;

    var head = new Uint8Array([MAGIC, lenBytes[0], lenBytes[1]]);
    var red = redundancyFor(len * 8 + 8, N, N);
    var rest = bitsToBytes(readBits(len * 8 + 8, red));
    var frame = new Uint8Array(3 + len + 1);
    frame.set(head, 0);
    frame.set(rest, 3);
    if (crc8(frame, 1, 2 + len) !== frame[frame.length - 1]) return null;
    return new TextDecoder().decode(frame.slice(3, 3 + len));
  }  // ---------- 公开 API：embed(imageData, text, strength, onProgress) → Promise<ImageData> ----------
  // 瓦片架构：水印 = 256 周期 delta 瓦片（模板星座 + payload 幅度差分，空频谱生成），
  // 平铺叠加到亮度通道。任意 256² 提取窗恰好包含一个周期（循环位移，幅度谱不变），
  // 天然抗平移/裁剪；旋转/缩放由星座匹配校正。strength = 空间波纹 RMS（灰度级）。
  function measurePayloadMed(data, w, h, done) {
    if (w < BLOCK || h < BLOCK) { done(0); return; } // 小图跳过自适应
    var starts = [[(w - BLOCK) >> 1, (h - BLOCK) >> 1]];
    if (w >= 2 * BLOCK && h >= 2 * BLOCK) {
      starts.push([0, 0], [w - BLOCK, 0], [0, h - BLOCK], [w - BLOCK, h - BLOCK]);
    }
    var meds = [];
    var i = 0;
    function step() {
      if (i >= starts.length) {
        meds.sort(function (a, b) { return a - b; });
        done(meds[meds.length >> 1]);
        return;
      }
      var st = starts[i++];
      var blk = lumaBlock(data, w, st[0], st[1], BLOCK);
      var d = { re: blk, im: new Float64Array(BLOCK * BLOCK), w: BLOCK, h: BLOCK };
      fft2dAsync(d, false, null, function () {
        var mags = [];
        for (var u = 0; u < BLOCK; u++) {
          var fu = signedFreq(u, BLOCK);
          for (var v = 0; v < BLOCK; v++) {
            var fv = signedFreq(v, BLOCK);
            var rn = Math.sqrt(fu * fu + fv * fv);
            if (rn >= BAND_MIN && rn <= BAND_MAX) {
              var idx = u * BLOCK + v;
              mags.push(Math.hypot(d.re[idx], d.im[idx]));
            }
          }
        }
        mags.sort(function (a, b) { return a - b; });
        meds.push(mags[mags.length >> 1]);
        step();
      });
    }
    step();
  }

  // ---------- 公开 API：embed(imageData, text, strength, onProgress) → Promise<ImageData> ----------
  // 瓦片架构：水印 = 256 周期 delta 瓦片（模板星座 + payload 幅度差分，空频谱生成），
  // 平铺叠加到亮度通道。任意 256² 提取窗恰好包含一个周期（循环位移，幅度谱不变），
  // 天然抗平移/裁剪；旋转/缩放由星座匹配校正。strength = 空间波纹 RMS 下限（灰度级）；
  // 对频域内容强的图，α 自动提升至 1.5×内容中位数以保证可提取（RMSE 相应增大）。
  function embed(imageData, text, strength, onProgress) {
    return new Promise(function (resolve, reject) {
      var bits, frame;
      try {
        frame = encodeFrame(text);
        bits = bytesToBits(frame);
      } catch (err) {
        reject(err);
        return;
      }
      var w = imageData.width, h = imageData.height;
      var data = imageData.data;
      var progress = function (p) { if (onProgress) onProgress(p); };

      measurePayloadMed(data, w, h, function (medC) {
        var restRed = redundancyFor((frame.length - 3) * 8 + 8, BLOCK, BLOCK);
        var N = BLOCK, n2 = N * N;
        var re = new Float64Array(n2), im = new Float64Array(n2);
        var pairs = 24 * RED_HEADER + (bits.length - 24) * restRed;
        // Parseval：RMS = α·√(2·pairs + 8·3²) / N ⇒ 反解 α（模板幅度 3α，占 72）
        var alpha = CAL * strength * n2 / Math.sqrt(2 * pairs + 72);
        // 内容自适应增益：α 需盖过代表性窗口的 payload 带内容中位数
        var alphaMin = 2.0 * medC;
        if (alpha < alphaMin) alpha = alphaMin;
        var rand = mulberry32(SEED ^ 0x9e3779b9);
        embedTemplateTile(re, im, N, 3 * alpha, rand);
        var gen = makePositionGen(N, N);
        // 帧头 24bit 固定冗余，payload+CRC 自适应冗余；位置序列与提取端一致
        embedPairsTile(re, im, gen, bits.slice(0, 24), alpha, RED_HEADER, rand);
        embedPairsTile(re, im, gen, bits.slice(24), alpha, restRed, rand);

        var d = { re: re, im: im, w: N, h: N };
        fft2dAsync(d, true, function (p) { progress(p * 0.8); }, function () {
          var tile = d.re;
          var out = new ImageData(w, h);
          var od = out.data;
          for (var r = 0; r < h; r++) {
            var tRow = (r % N) * N, rowBase = r * w;
            for (var c = 0; c < w; c++) {
              var delta = tile[tRow + (c % N)];
              var i = (rowBase + c) * 4;
              od[i] = clamp8(data[i] + delta);
              od[i + 1] = clamp8(data[i + 1] + delta);
              od[i + 2] = clamp8(data[i + 2] + delta);
              od[i + 3] = data[i + 3];
            }
          }
          progress(1);
          resolve(out);
        });
      });
    });
  }

  // ---------- 公开 API：extract(imageData, onProgress) → Promise<string|null> ----------
  // 提取顺序：分块网格（星座解码）→ 小图 padding 到 256 分块 → 整图 padding 单块兜底
  function extract(imageData, onProgress) {
    return new Promise(function (resolve) {
      var w = imageData.width, h = imageData.height;
      var progress = function (p) { if (onProgress) onProgress(p); };

      // 对给定 RGBA 数据按分块网格提取。两级网格：先 B/2 粗网格，无结果再 B/4 偏移
      // 加密级（窗口错开半格，内容不同带来新机会）。跨级共享计数。
      // 采信规则：同一文本在 2 个不同窗口解码成功才返回（CRC 误码依赖窗口内容，
      // 两窗一致误码概率极低）；无 firstFound 兜底——宁可漏检不可误检。
      function tryGrid(data, W, H, done) {
        var found = {};
        function startsWithOffset(L, B, offset) {
          var step = B >> 1;
          var starts = [];
          for (var s = offset; s <= L - B; s += step) starts.push(s);
          if (starts.length === 0) starts.push(0);
          return starts;
        }
        function runLevel(offset, cb) {
          var xs = startsWithOffset(W, BLOCK, offset), ys = startsWithOffset(H, BLOCK, offset);
          var blocks = [];
          for (var iy = 0; iy < ys.length; iy++) {
            for (var ix = 0; ix < xs.length; ix++) blocks.push({ x: xs[ix], y: ys[iy] });
          }
          var bi = 0;
          function nextBlock() {
            if (bi >= blocks.length) { cb(null); return; }
            var bk = blocks[bi++];
            var blk = lumaBlock(data, W, bk.x, bk.y, BLOCK);
            var d = { re: blk, im: new Float64Array(BLOCK * BLOCK), w: BLOCK, h: BLOCK };
            fft2dAsync(d, false, null, function () {
              var mag = new Float64Array(BLOCK * BLOCK);
              for (var i = 0; i < BLOCK * BLOCK; i++) {
                mag[i] = Math.sqrt(d.re[i] * d.re[i] + d.im[i] * d.im[i]);
              }
              // 常规路径（findConstellation 候选），失败再走旋转/缩放纯频域校正路径
              var text = decodeBlock(d.re, d.im, mag, BLOCK);
              if (text === null) text = decodeBlockRot(mag, BLOCK);
              if (text !== null) {
                found[text] = (found[text] || 0) + 1;
                if (found[text] >= 2) { cb(text); return; } // 两块一致即采信
              }
              progress(Math.min(bi / blocks.length * 0.95, 0.95));
              yieldTask(nextBlock);
            });
          }
          yieldTask(nextBlock);
        }
        runLevel(0, function (res) {
          if (res !== null) { done(res); return; }
          runLevel(BLOCK >> 2, function (res2) { done(res2); });
        });
      }

      if (w >= BLOCK && h >= BLOCK) {
        tryGrid(imageData.data, w, h, function (text) {
          progress(1);
          resolve(text);
        });
      } else {
        // 任一边 < 256：padding 到 256 后走分块（瓦片水印在 256 窗内仍有完整周期结构）
        var w2 = Math.max(w, BLOCK), h2 = Math.max(h, BLOCK);
        var padded = new Uint8ClampedArray(w2 * h2 * 4);
        for (var r = 0; r < h2; r++) {
          var sr = r < h ? r : h - 1;
          for (var c = 0; c < w2; c++) {
            var sc = c < w ? c : w - 1;
            var si = (sr * w + sc) * 4, di = (r * w2 + c) * 4;
            padded[di] = imageData.data[si];
            padded[di + 1] = imageData.data[si + 1];
            padded[di + 2] = imageData.data[si + 2];
            padded[di + 3] = imageData.data[si + 3];
          }
        }
        tryGrid(padded, w2, h2, function (text) {
          progress(1);
          resolve(text);
        });
      }
    });
  }

  return {
    embed: embed,
    extract: extract,
    MAX_PAYLOAD: MAX_PAYLOAD,
    _debug: {
      fft2dAsync: fft2dAsync,
      lumaBlock: lumaBlock,
      estimateRotation: estimateRotation,
      findConstellation: findConstellation,
      decodeBlock: decodeBlock,
      tryDecode: tryDecode,
      makePositionGen: makePositionGen,
      sampleMag: sampleMag,
      redundancyFor: redundancyFor
    }
  };
})();
