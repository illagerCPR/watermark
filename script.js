/* 图片平铺水印制作工具 —— 纯前端本地实现 */
(function () {
  'use strict';

  // ---------- DOM ----------
  var previewArea = document.getElementById('previewArea');
  var dropZone = document.getElementById('dropZone');
  var fileInput = document.getElementById('fileInput');
  var canvas = document.getElementById('canvas');
  var downloadBtn = document.getElementById('downloadBtn');
  var extractBtn = document.getElementById('extractBtn');
  var extractInput = document.getElementById('extractInput');
  var extractModal = document.getElementById('extractModal');
  var extractStatus = document.getElementById('extractStatus');
  var extractResult = document.getElementById('extractResult');
  var ctx = canvas.getContext('2d');

  // 离屏画布：生成单个平铺单元，用作 pattern
  var patternCanvas = document.createElement('canvas');
  var pctx = patternCanvas.getContext('2d');

  // ---------- 状态 ----------
  var state = {
    text: '仅供内部使用\nCONFIDENTIAL',
    fontFamily: 'Microsoft YaHei',
    fontSize: 36,
    bold: false,
    color: '#888888',
    strokeColor: '#000000',
    strokeWidth: 0,
    opacity: 0.3,
    angle: -30,
    gapX: 80,
    gapY: 60,
    blindEnabled: false,
    blindText: '',
    blindStrength: 1.5,
    format: 'png',
    quality: 0.92
  };

  var busy = false; // 嵌入/提取进行中，防止重入

  var img = null;            // 已加载的图片
  var originalName = 'image'; // 原文件名（导出时拼接后缀）

  // ---------- 核心渲染 ----------
  function render() {
    if (!img) return;

    // 主画布保持图片原始分辨率，预览缩放交给 CSS
    canvas.width = img.naturalWidth;
    canvas.height = img.naturalHeight;
    ctx.drawImage(img, 0, 0);

    var text = state.text.replace(/\r/g, '');
    if (!text.trim()) return; // 无文本则不叠水印

    var lines = text.split('\n');
    var font = (state.bold ? 'bold ' : '') + state.fontSize + 'px "' + state.fontFamily + '"';

    // 测量最宽行，确定平铺单元尺寸
    pctx.font = font;
    var maxW = 0;
    for (var i = 0; i < lines.length; i++) {
      maxW = Math.max(maxW, pctx.measureText(lines[i]).width);
    }
    var lineHeight = state.fontSize * 1.4;
    var pw = Math.max(1, Math.ceil(maxW + state.gapX));
    var ph = Math.max(1, Math.ceil(lineHeight * lines.length + state.gapY));

    // 重设尺寸会清空画布，之后必须重新设置绘图属性
    patternCanvas.width = pw;
    patternCanvas.height = ph;
    pctx.font = font;
    pctx.textBaseline = 'top';
    pctx.textAlign = 'left';
    pctx.globalAlpha = state.opacity;
    pctx.fillStyle = state.color;
    pctx.strokeStyle = state.strokeColor;
    pctx.lineWidth = state.strokeWidth;
    pctx.lineJoin = 'round';

    var offsetX = state.gapX / 2;
    var offsetY = state.gapY / 2;
    for (var j = 0; j < lines.length; j++) {
      var y = offsetY + j * lineHeight;
      if (state.strokeWidth > 0) {
        pctx.strokeText(lines[j], offsetX, y);
      }
      pctx.fillText(lines[j], offsetX, y);
    }

    // 以画布中心为原点旋转，填充足够大的矩形保证全图覆盖
    var pattern = ctx.createPattern(patternCanvas, 'repeat');
    var cx = canvas.width / 2;
    var cy = canvas.height / 2;
    var diag = Math.hypot(canvas.width, canvas.height);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(state.angle * Math.PI / 180);
    ctx.fillStyle = pattern;
    ctx.fillRect(-diag, -diag, diag * 2, diag * 2);
    ctx.restore();
  }

  // 防抖重绘，避免拖动滑块时频繁全量渲染
  var renderTimer = null;
  function scheduleRender() {
    clearTimeout(renderTimer);
    renderTimer = setTimeout(render, 80);
  }

  // ---------- 图片加载 ----------
  function loadFile(file) {
    if (!file || file.type.indexOf('image/') !== 0) return;
    var url = URL.createObjectURL(file);
    var image = new Image();
    image.onload = function () {
      img = image;
      originalName = file.name || 'image';
      dropZone.hidden = true;
      canvas.hidden = false;
      downloadBtn.disabled = false;
      render();
      URL.revokeObjectURL(url);
    };
    image.onerror = function () {
      URL.revokeObjectURL(url);
      alert('图片加载失败，请换一张试试。');
    };
    image.src = url;
  }

  previewArea.addEventListener('click', function () {
    fileInput.click();
  });

  fileInput.addEventListener('change', function () {
    loadFile(fileInput.files[0]);
    fileInput.value = ''; // 允许重复选择同一文件
  });

  ['dragenter', 'dragover'].forEach(function (evt) {
    previewArea.addEventListener(evt, function (e) {
      e.preventDefault();
      previewArea.classList.add('dragover');
    });
  });

  ['dragleave', 'drop'].forEach(function (evt) {
    previewArea.addEventListener(evt, function (e) {
      e.preventDefault();
      previewArea.classList.remove('dragover');
    });
  });

  previewArea.addEventListener('drop', function (e) {
    var file = e.dataTransfer.files && e.dataTransfer.files[0];
    loadFile(file);
  });

  // ---------- 导出 ----------
  function saveBlob(blob, ext) {
    if (!blob) return;
    var base = originalName.replace(/\.[^.]+$/, '');
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = base + '_watermark.' + ext;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }

  function setBusy(flag, label) {
    busy = flag;
    downloadBtn.disabled = flag || !img;
    extractBtn.disabled = flag;
    downloadBtn.textContent = label || '下载图片';
  }

  downloadBtn.addEventListener('click', function () {
    if (!img || busy) return;

    // 未启用盲水印：维持原有直接导出路径
    if (!state.blindEnabled || !state.blindText.trim()) {
      var mime = state.format === 'jpeg' ? 'image/jpeg' : 'image/png';
      var ext = state.format === 'jpeg' ? 'jpg' : 'png';
      canvas.toBlob(function (blob) { saveBlob(blob, ext); }, mime, state.quality);
      return;
    }

    // 启用盲水印：在最终像素（含可见水印）上嵌入频域水印，强制 PNG
    setBusy(true, '嵌入中 0%');
    var imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    BlindWatermark.embed(imageData, state.blindText.trim(), state.blindStrength, function (p) {
      downloadBtn.textContent = '嵌入中 ' + Math.round(p * 100) + '%';
    }).then(function (out) {
      var tmp = document.createElement('canvas');
      tmp.width = out.width;
      tmp.height = out.height;
      tmp.getContext('2d').putImageData(out, 0, 0);
      tmp.toBlob(function (blob) {
        setBusy(false);
        saveBlob(blob, 'png');
      }, 'image/png');
    }).catch(function (err) {
      setBusy(false);
      alert(err.message || '盲水印嵌入失败');
    });
  });

  // ---------- 控件绑定 ----------
  function bindText(id, key) {
    var el = document.getElementById(id);
    el.addEventListener('input', function () {
      state[key] = el.value;
      scheduleRender();
    });
  }

  function bindSelect(id, key) {
    var el = document.getElementById(id);
    el.addEventListener('change', function () {
      state[key] = el.value;
      scheduleRender();
    });
  }

  function bindCheckbox(id, key) {
    var el = document.getElementById(id);
    el.addEventListener('change', function () {
      state[key] = el.checked;
      scheduleRender();
    });
  }

  // 滑块与数字输入双向同步
  function bindRange(rangeId, numId, key) {
    var range = document.getElementById(rangeId);
    var num = document.getElementById(numId);
    function apply(value) {
      var v = parseFloat(value);
      if (isNaN(v)) return;
      v = Math.min(parseFloat(range.max), Math.max(parseFloat(range.min), v));
      state[key] = v;
      range.value = v;
      num.value = v;
      scheduleRender();
    }
    range.addEventListener('input', function () { apply(range.value); });
    num.addEventListener('change', function () { apply(num.value); });
  }

  bindText('textInput', 'text');
  bindSelect('fontSelect', 'fontFamily');
  bindCheckbox('boldInput', 'bold');
  bindText('colorInput', 'color');
  bindText('strokeColorInput', 'strokeColor');
  bindRange('fontSize', 'fontSizeNum', 'fontSize');
  bindRange('strokeWidth', 'strokeWidthNum', 'strokeWidth');
  bindRange('opacity', 'opacityNum', 'opacity');
  bindRange('angle', 'angleNum', 'angle');
  bindRange('gapX', 'gapXNum', 'gapX');
  bindRange('gapY', 'gapYNum', 'gapY');
  bindRange('quality', 'qualityNum', 'quality');

  // 导出格式切换时，仅 JPEG 显示质量选项
  var formatSelect = document.getElementById('formatSelect');
  var qualityGroup = document.getElementById('qualityGroup');
  var formatHint = document.getElementById('formatHint');
  formatSelect.addEventListener('change', function () {
    state.format = formatSelect.value;
    qualityGroup.hidden = state.format !== 'jpeg';
  });

  // ---------- 盲水印控件（不影响可见预览，无需触发重绘） ----------
  var blindEnabledInput = document.getElementById('blindEnabled');
  var blindGroup = document.getElementById('blindGroup');
  var blindTextInput = document.getElementById('blindText');
  var blindStrength = document.getElementById('blindStrength');
  var blindStrengthNum = document.getElementById('blindStrengthNum');

  blindEnabledInput.addEventListener('change', function () {
    state.blindEnabled = blindEnabledInput.checked;
    blindGroup.hidden = !state.blindEnabled;
    formatSelect.disabled = state.blindEnabled;
    formatHint.hidden = !state.blindEnabled;
    if (state.blindEnabled) {
      formatSelect.value = 'png';
      state.format = 'png';
      qualityGroup.hidden = true;
    }
  });

  blindTextInput.addEventListener('input', function () {
    state.blindText = blindTextInput.value;
  });

  function applyBlindStrength(value) {
    var v = parseFloat(value);
    if (isNaN(v)) return;
    v = Math.min(parseFloat(blindStrength.max), Math.max(parseFloat(blindStrength.min), v));
    state.blindStrength = v;
    blindStrength.value = v;
    blindStrengthNum.value = v;
  }
  blindStrength.addEventListener('input', function () { applyBlindStrength(blindStrength.value); });
  blindStrengthNum.addEventListener('change', function () { applyBlindStrength(blindStrengthNum.value); });

  // ---------- 盲水印提取 ----------
  extractBtn.addEventListener('click', function () {
    if (busy) return;
    extractInput.click();
  });

  document.getElementById('extractClose').addEventListener('click', function () {
    extractModal.hidden = true;
  });

  extractInput.addEventListener('change', function () {
    var file = extractInput.files[0];
    extractInput.value = '';
    if (!file || file.type.indexOf('image/') !== 0) return;

    extractModal.hidden = false;
    extractResult.hidden = true;
    extractResult.value = '';
    extractStatus.textContent = '正在处理… 0%';
    setBusy(true);

    var url = URL.createObjectURL(file);
    var image = new Image();
    image.onload = function () {
      URL.revokeObjectURL(url);
      var probe = document.createElement('canvas');
      probe.width = image.naturalWidth;
      probe.height = image.naturalHeight;
      var pctx = probe.getContext('2d');
      pctx.drawImage(image, 0, 0);
      var imageData = pctx.getImageData(0, 0, probe.width, probe.height);
      BlindWatermark.extract(imageData, function (p) {
        extractStatus.textContent = '正在处理… ' + Math.round(p * 100) + '%';
      }).then(function (text) {
        setBusy(false);
        if (text === null) {
          extractStatus.textContent = '未检测到盲水印（图片未嵌入，或已被裁剪/强压缩破坏）';
        } else {
          extractStatus.textContent = '提取成功：';
          extractResult.value = text;
          extractResult.hidden = false;
        }
      });
    };
    image.onerror = function () {
      URL.revokeObjectURL(url);
      setBusy(false);
      extractStatus.textContent = '图片加载失败，请换一张试试。';
    };
    image.src = url;
  });
})();
