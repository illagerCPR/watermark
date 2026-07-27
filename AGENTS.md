# AGENTS.md

面向用户的文档见 `README.md`，本文件只记录开发/验证时容易踩坑的硬经验。

## 项目形态

- 零依赖纯静态文件（`index.html` + `style.css` + `script.js` + `blind.js` + `favicon.ico`），**没有也不应引入** npm、构建工具或框架；直接编辑文件，双击 `index.html` 即可运行。
- 可见水印逻辑在 `script.js` 的 IIFE 闭包内：`state` 对象 + `renderToCanvas(targetCtx, image)`（核心渲染，单图预览与批量共用）。水印渲染核心 = 离屏 pattern canvas -> `ctx.createPattern` -> 以画布中心旋转后填充对角线 2 倍的矩形。`render()` 是单图预览的防抖包装（调 `renderToCanvas(ctx, img)`）。改渲染行为只需动 `renderToCanvas`。
- **双 Tab 视图**：`switchTab(name)` 切换 `#singleView`/`#batchView` 显隐，参数面板 `<aside>` 两视图共享。`state` 变更后两视图都生效（批量用当前 `state` 串行处理）。
- **批量处理**：`batchFiles[]` 维护文件列表，`renderThumbs()` 渲染缩略图网格（含单张删除）。`processBatch(files)` 串行：每张图 `renderToCanvas` -> 可选盲水印嵌入 -> `toBlob` -> `saveBlob`。进度显示在 `#batchExportBtn` 文字。
- **平铺水印开关**：`state.tiledEnabled`（默认 true）。`renderToCanvas` 开头判断，未勾选则只 `drawImage` 原图、跳过 pattern 叠加。盲水印不受此开关影响。
- 盲水印逻辑在 `blind.js`（IIFE -> `window.BlindWatermark`），含手写 radix-2 FFT + 比特编解码 + 嵌入/提取。嵌入在单图下载与批量导出两处触达，完全不动 `renderToCanvas`。
- **盲水印尺寸门槛**：`BLIND_MIN_SIZE = 256`（`script.js`）。嵌入端（单图下载 + 批量导出）与提取端均在调用 `BlindWatermark` 前拦截任一边 < 256 的图片：单图弹 alert 不开始；批量 `continue` 跳过并计入 `skippedSmall`，最终 alert 体现；提取端直接把状态文案改为"尺寸过小"不进入算法。可见水印不受此门槛影响。
- UI 文案为简体中文，深色主题；保持这一风格。

## 盲水印架构（v2 瓦片架构，容易踩坑）

- **为什么不能 Web Worker**：项目要求支持 `file://` 双击使用，Chrome 下 `file:` 页面创建 Worker 抛 SecurityError。FFT 采用主线程 `MessageChannel` 分片异步（每 64 行/列让出事件循环）。
- **瓦片架构（核心）**：嵌入 = 空频谱生成**单个** 256×256 delta 瓦片（单次 IFFT，~50ms）→ 按 256 周期平铺叠加亮度。任意 256² 提取窗恰含一个循环位移周期，**幅度谱平移不变**，天然抗平移/裁剪。不要改回分块重叠融合方案（那会导致窗间 delta 混合、无法解码）。
- **编码**：文本帧（魔数 0xA5 + 长度 + payload + CRC8）的每个比特用成对随机频点做**幅度差分**（bit1：F(p1)=α∠φ、F(p2)=0；随机相位使空间波纹呈噪声状；共轭镜像保证 IFFT 为实数）。位置由固定种子 PRNG 在环带 [0.12, 0.35] 生成，嵌入/提取两端序列必须一致（`makePositionGen` 连续两次调用为一对）。
- **同步模板**：半径 0.05N 处 4 峰星座（0°/45°/90°/135° + 镜像，幅度 3α，随机相位），用于估计缩放（半径）与旋转（角度，45° 周期 → 8 个 k·45° 假设）。
- **强度语义**：`strength` = 空间波纹 RMS 目标下限（灰度级）。`α = CAL·strength·N²/√(2·pairs+72)`（Parseval，72 = 模板 8 点×3²）。**内容自适应增益**：嵌入前 `measurePayloadMed` 测代表性窗口 payload 带内容幅度中位数，`α = max(α, 2.0×medC)`，否则强内容图（med>α）无法解码。s=1.5 对典型图 RMSE≈1.5。
- **提取解码**：两级网格（B/2 粗 → B/4 细）逐窗 FFT → 先 `findConstellation`（差分模板评分：on 与 22.5° off 幅度差中位数，内容邻近频点相关被抵消）找候选解码；失败走 `decodeBlockRot`（`estimateRotation` 径向能量角度直方图估 θ + `estimateScaleR` 定 θ 扫半径估 s，**纯频域校正**，tryDecode 内置坐标变换直接采样，无第二次像素插值）。
- **表决**：`(m1-m2)/(m1+m2+1)` 归一化累加——内容弱的位置信号纯净（票≈±1），内容强的位置被分母自动抑制。**不要用符号投票或线性和**（前者把强信号与噪声等权，后者被单点强内容峰淹没）。
- **门控**：魔数**软门控**（汉明距 ≤1，魔数不参与 CRC 故容错安全）+ CRC8 硬裁决 + **2 块一致采信**（无 firstFound 兜底——单块 CRC 侥幸通过的误码必须被挡，宁可漏检不可误检）。RED_HEADER=12，payload 冗余 `redundancyFor` 自适应（3–8）。
- **已知边界**：任意角度旋转/缩放依赖插值后幸存的频谱峰，在内容方向性强（大文字、规则纹理）的图上可能失败；sinc 插值损失不可逆，提高强度/冗余可缓解。任一边 <256 的图片在 UI 层即被拦截（`BLIND_MIN_SIZE`），不进入算法--因为 padding 单块模式无几何鲁棒性且在宽 ≥256 但高 <256 的混合尺寸下两端 padding 策略不一致会导致提取失败。

## 环境约束（重要）

- **绝不要用 Read 工具读取图片文件**（png/jpg 等），会导致进程异常中断。验证渲染效果一律用像素统计代替看图。
- 全局 `playwright-cli` 命令在本机执行会报 `ChildProcess.kill` 错误，必须使用 `npx --no-install playwright-cli`。
- `playwright-cli` 会拦截 `file://` 协议，验证前必须先起一个本地 HTTP 服务器（如 `npx --yes serve -l 8321 .`，或临时写个 node 静态服务器后台运行），然后访问 `http://127.0.0.1:8321/index.html`。
- `npx --no-install playwright-cli open` 有时仍报 `ChildProcess.kill`，但浏览器可能已启动；用 `list` 确认状态，用 `close` / `kill-all` 清理僵尸会话后重试。

## 验证方法（无测试框架，用 Playwright 实测）

- 上传图片：file input 是 hidden 的，用 `run-code` 执行 `await page.setInputFiles('#fileInput', '<绝对路径>')`。
- 触发控件：range/textarea 赋值后需 `dispatchEvent(new Event('input'))`，select 用 `'change'`。checkbox 用 `page.check`/`page.uncheck`。
- 断言渲染：`eval` 里读 `canvas.getContext('2d').getImageData(...)`，统计颜色数/像素和变化（`state` 在闭包内，外部无法直接读取）。
- 断言导出：页面上下文用 `canvas.toBlob` 回调拿 `blob.size`/`type`；验证下载按钮用 `page.waitForEvent('download')` + `download.suggestedFilename()`。
- `run-code` 的沙箱中**不能 `require('fs')`**，文件类断言要放到页面 `evaluate` 里做。
- **盲水印 roundtrip**：页面内 `BlindWatermark.embed(imgData, text, strength, onProgress)` → `.then(out => BlindWatermark.extract(out, onProgress))` 验证内存闭环；完整 UI 流程需 `download.saveAs` 保存后 `setInputFiles('#extractInput', path)` 再读取 modal 结果。
- **不可见性**：嵌入前后 `ImageData` 逐像素 MSE/RMSE，s=2 默认 RMSE≈1.3–1.5 灰度。
- **负样本**：对未嵌入图片做 `BlindWatermark.extract` 应返回 `null`（magic/CRC 门控生效）。
- 文件选择器（file chooser）弹出后 eval 会阻塞，需用 `playwright-cli upload <path>` 命令将文件填入已打开的 chooser。
- `hidden` 属性（`display: none`）会被 CSS `.class { display: flex }` 覆盖，需显式声明 `.class[hidden] { display: none }`。这是真实兼容性坑——已在 `style.css` 修复。
- **flex column 子项需 `min-height: 0`**：`.preview`（`flex:1`）默认 `min-height: auto` 不收缩，大图 canvas（即使设了 `max-height:100%`）会撑开预览区把 `.view-actions`（含下载按钮）推出视口底部不可见。已加 `min-height: 0` 修复。
- 验证完成后清理：关闭浏览器（`close`）、停掉 HTTP 服务器进程、删除测试产物（测试图片、服务器脚本、`.playwright-cli/` 目录）。
