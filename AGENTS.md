# AGENTS.md

面向用户的文档见 `README.md`，本文件只记录开发/验证时容易踩坑的硬经验。

## 项目形态

- 零依赖纯静态文件（`index.html` + `style.css` + `script.js` + `blind.js`），**没有也不应引入** npm、构建工具或框架；直接编辑文件，双击 `index.html` 即可运行。
- 可见水印逻辑在 `script.js` 的 IIFE 闭包内：`state` 对象 + `render()`。水印渲染核心 = 离屏 pattern canvas → `ctx.createPattern` → 以画布中心旋转后填充对角线 2 倍的矩形。改渲染行为只需动 `render()`。
- 盲水印逻辑在 `blind.js`（IIFE → `window.BlindWatermark`），含手写 radix-2 FFT + 比特编解码 + 嵌入/提取。嵌入仅在导出时触达（`script.js` 下载分支），完全不动 `render()`。
- UI 文案为简体中文，深色主题；保持这一风格。

## 盲水印架构（新增，容易踩坑）

- **为什么不能 Web Worker**：项目要求支持 `file://` 双击使用，Chrome 下 `file:` 页面创建 Worker 抛 SecurityError。FFT 采用主线程 `setTimeout` 分片异步，每 64 行/列让出事件循环。
- **强度语义**：`embed()` 的 `strength` 参数 = **空间域波纹 RMS 幅度（灰度级）**，不是频域增量。内部换算 `alpha = strength × N² / (2√M)`（N=padding 后像素数，M=嵌入位置数），与图像尺寸解耦。默认值 s=2，对 256² 图 alpha≈3000，RMSE≈1.4 灰度。
- **共轭对称**：嵌入端在 `(u,v)` 和 `(H-u)%H, (W-v)%W` 加相同的实数值（实数 BPSK），保证 IFFT 结果为实数图像。提取端读取两处系数符号投票。
- **量化阈值**：设计强度时必须确保空间域波纹 RMS > 0.5 灰度，否则 8bit 载体会将信号完全抹除（MSE=0）。此前 s=2 对 800² 以上图产生 RMSE≈1.4，越过量化阈值。
- **提取门控**：帧头含固定魔数 `0xA5`（8bit）+ 长度（16bit）+ payload + CRC8。魔数和 CRC 任一校验失败即返回 null，避免误识别非水印图。

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
- 验证完成后清理：关闭浏览器（`close`）、停掉 HTTP 服务器进程、删除测试产物（测试图片、服务器脚本、`.playwright-cli/` 目录）。
