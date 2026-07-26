# AGENTS.md

面向用户的文档见 `README.md`，本文件只记录开发/验证时容易踩坑的硬经验。

## 项目形态

- 零依赖纯静态三文件（`index.html` + `style.css` + `script.js`），**没有也不应引入** npm、构建工具或框架；直接编辑文件，双击 `index.html` 即可运行。
- 全部逻辑在 `script.js` 的 IIFE 闭包内：`state` 对象 + `render()`。水印渲染核心 = 离屏 pattern canvas → `ctx.createPattern` → 以画布中心旋转后填充对角线 2 倍的矩形。改渲染行为只需动 `render()`。
- UI 文案为简体中文，深色主题；保持这一风格。

## 环境约束（重要）

- **绝不要用 Read 工具读取图片文件**（png/jpg 等），会导致进程异常中断。验证渲染效果一律用像素统计代替看图。
- 全局 `playwright-cli` 命令在本机执行会报 `ChildProcess.kill` 错误，必须使用 `npx --no-install playwright-cli`。
- `playwright-cli` 会拦截 `file://` 协议，验证前必须先起一个本地 HTTP 服务器（如 `npx --yes serve -l 8321 .`，或临时写个 node 静态服务器后台运行），然后访问 `http://127.0.0.1:8321/index.html`。

## 验证方法（无测试框架，用 Playwright 实测）

- 上传图片：file input 是 hidden 的，用 `run-code` 执行 `await page.setInputFiles('#fileInput', '<绝对路径>')`。
- 触发控件：range/textarea 赋值后需 `dispatchEvent(new Event('input'))`，select 用 `'change'`。
- 断言渲染：`eval` 里读 `canvas.getContext('2d').getImageData(...)`，统计颜色数/像素和变化（`state` 在闭包内，外部无法直接读取）。
- 断言导出：页面上下文用 `canvas.toBlob` 回调拿 `blob.size`/`type`；验证下载按钮用 `page.waitForEvent('download')` + `download.suggestedFilename()`。
- `run-code` 的沙箱中**不能 `require('fs')`**，文件类断言要放到页面 `evaluate` 里做。
- 验证完成后清理：关闭浏览器（`close`）、停掉 HTTP 服务器进程、删除测试产物（测试图片、服务器脚本、`.playwright-cli/` 目录）。
