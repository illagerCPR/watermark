/* 图片水印工具 —— 纯前端本地实现 */
(function () {
  'use strict';

  // ---------- DOM ----------
  var previewArea = document.getElementById('previewArea');
  var dropZone = document.getElementById('dropZone');
  var fileInput = document.getElementById('fileInput');
  var canvas = document.getElementById('canvas');
  var downloadBtn = document.getElementById('downloadBtn');
  var extractBtn = document.getElementById('extractBtn');
  var tabSingle = document.getElementById('tabSingle');
  var tabBatch = document.getElementById('tabBatch');
  var singleView = document.getElementById('singleView');
  var batchView = document.getElementById('batchView');
  var batchArea = document.getElementById('batchArea');
  var batchDropZone = document.getElementById('batchDropZone');
  var thumbGrid = document.getElementById('thumbGrid');
  var batchInput = document.getElementById('batchInput');
  var batchExportBtn = document.getElementById('batchExportBtn');
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
    tiledEnabled: true,
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
  var batchFiles = [];       // 批量处理待处理文件列表

  // ---------- 核心渲染 ----------
  // 将水印渲染到任意 ctx（单图预览与批量共用）
  function renderToCanvas(targetCtx, image) {
    var w = image.naturalWidth, h = image.naturalHeight;
    targetCtx.canvas.width = w;
    targetCtx.canvas.height = h;
    targetCtx.clearRect(0, 0, w, h);
    targetCtx.drawImage(image, 0, 0);

    // 未启用平铺水印或无文本：仅保留原图
    if (!state.tiledEnabled) return;
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
    var pattern = targetCtx.createPattern(patternCanvas, 'repeat');
    var cx = w / 2;
    var cy = h / 2;
    var diag = Math.hypot(w, h);
    targetCtx.save();
    targetCtx.translate(cx, cy);
    targetCtx.rotate(state.angle * Math.PI / 180);
    targetCtx.fillStyle = pattern;
    targetCtx.fillRect(-diag, -diag, diag * 2, diag * 2);
    targetCtx.restore();
  }

  // 单图预览渲染（防抖）
  function render() {
    if (!img) return;
    renderToCanvas(ctx, img);
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
  function saveBlob(blob, ext, name) {
    if (!blob) return;
    var base = (name || originalName).replace(/\.[^.]+$/, '');
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
    batchExportBtn.disabled = flag || batchFiles.length === 0;
    extractBtn.disabled = flag;
    tabSingle.disabled = flag;
    tabBatch.disabled = flag;
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

  // ---------- Tab 切换 ----------
  function switchTab(name) {
    var isSingle = name === 'single';
    tabSingle.classList.toggle('active', isSingle);
    tabBatch.classList.toggle('active', !isSingle);
    singleView.hidden = !isSingle;
    batchView.hidden = isSingle;
  }
  tabSingle.addEventListener('click', function () { if (!busy) switchTab('single'); });
  tabBatch.addEventListener('click', function () { if (!busy) switchTab('batch'); });

  // ---------- 批量处理 ----------
  batchDropZone.addEventListener('click', function () {
    if (!busy) batchInput.click();
  });

  // 拖拽上传到批量区
  ['dragenter', 'dragover'].forEach(function (evt) {
    batchArea.addEventListener(evt, function (e) {
      e.preventDefault();
      batchArea.classList.add('dragover');
    });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    batchArea.addEventListener(evt, function (e) {
      e.preventDefault();
      batchArea.classList.remove('dragover');
    });
  });
  batchArea.addEventListener('drop', function (e) {
    if (busy) return;
    var files = e.dataTransfer.files;
    if (files && files.length) addBatchFiles(files);
  });

  batchInput.addEventListener('change', function () {
    if (batchInput.files.length) addBatchFiles(batchInput.files);
    batchInput.value = '';
  });

  function addBatchFiles(fileList) {
    for (var i = 0; i < fileList.length; i++) {
      var f = fileList[i];
      if (f.type.indexOf('image/') === 0) batchFiles.push(f);
    }
    renderThumbs();
  }

  function renderThumbs() {
    thumbGrid.innerHTML = '';
    batchExportBtn.disabled = busy || batchFiles.length === 0;
    for (var i = 0; i < batchFiles.length; i++) {
      (function (idx, file) {
        var card = document.createElement('div');
        card.className = 'thumb';
        var imgEl = document.createElement('img');
        imgEl.src = URL.createObjectURL(file);
        imgEl.alt = file.name;
        var nameEl = document.createElement('div');
        nameEl.className = 'thumb-name';
        nameEl.textContent = file.name;
        var del = document.createElement('button');
        del.className = 'thumb-del';
        del.textContent = '×';
        del.title = '移除';
        del.addEventListener('click', function (e) {
          e.stopPropagation();
          if (busy) return;
          batchFiles.splice(idx, 1);
          renderThumbs();
        });
        card.appendChild(imgEl);
        card.appendChild(nameEl);
        card.appendChild(del);
        thumbGrid.appendChild(card);
      })(i, batchFiles[i]);
    }
  }

  function loadImageFromFile(file) {
    return new Promise(function (resolve, reject) {
      var url = URL.createObjectURL(file);
      var image = new Image();
      image.onload = function () { URL.revokeObjectURL(url); resolve(image); };
      image.onerror = function () { URL.revokeObjectURL(url); reject(new Error('加载失败')); };
      image.src = url;
    });
  }

  function canvasToBlob(targetCanvas, mime, quality) {
    return new Promise(function (resolve) {
      targetCanvas.toBlob(resolve, mime, quality);
    });
  }

  batchExportBtn.addEventListener('click', function () {
    if (busy || batchFiles.length === 0) return;
    processBatch(batchFiles.slice());
  });

  async function processBatch(files) {
    setBusy(true);
    var useBlind = state.blindEnabled && state.blindText.trim();
    var mime = useBlind ? 'image/png' : (state.format === 'jpeg' ? 'image/jpeg' : 'image/png');
    var ext = useBlind ? 'png' : (state.format === 'jpeg' ? 'jpg' : 'png');
    var okCount = 0;

    for (var i = 0; i < files.length; i++) {
      var file = files[i];
      batchExportBtn.textContent = '批量 ' + (i + 1) + '/' + files.length;
      try {
        var image = await loadImageFromFile(file);
        var tmpCanvas = document.createElement('canvas');
        var tmpCtx = tmpCanvas.getContext('2d');
        renderToCanvas(tmpCtx, image);

        if (useBlind) {
          var imageData = tmpCtx.getImageData(0, 0, tmpCanvas.width, tmpCanvas.height);
          batchExportBtn.textContent = '批量 ' + (i + 1) + '/' + files.length + ' 嵌入中';
          var out = await BlindWatermark.embed(imageData, state.blindText.trim(), state.blindStrength);
          tmpCanvas.width = out.width;
          tmpCanvas.height = out.height;
          tmpCtx.putImageData(out, 0, 0);
        }

        var blob = await canvasToBlob(tmpCanvas, mime, state.quality);
        saveBlob(blob, ext, file.name);
        okCount++;
      } catch (err) {
        console.error('批量处理失败:', file.name, err);
      }
    }

    setBusy(false);
    batchExportBtn.textContent = '批量导出';
    alert('批量完成：' + okCount + '/' + files.length + ' 张成功');
  }

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

  bindCheckbox('tiledEnabled', 'tiledEnabled');
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
