# 开发与部署

## 环境要求

- Node.js ≥ 22.12（推荐 24 LTS），pnpm 11
- 端到端测试默认使用系统安装的 Chrome（Playwright `channel: 'chrome'`）；没有时执行 `npx playwright install chromium` 并在 `playwright.config.ts` 中改用默认 chromium

## 常用命令

```bash
pnpm install        # 安装依赖
pnpm dev            # 开发服务器（根路径 /）
pnpm build          # 类型检查 + 生产构建（base=/watermark/）
pnpm preview        # 预览构建产物（/watermark/ 路径）
pnpm typecheck      # 仅类型检查
pnpm test           # Vitest 单元测试
pnpm test:e2e       # Playwright E2E + 新旧对拍（自动启动 dev server）
```

## 测试说明

- **单元测试**（`tests/unit`）：盲水印往返、负样本、取消、长度限制；参数清洗；导出文件名与 ZIP 去重。
- **对拍测试**（`tests/e2e/parity.spec.ts`）：把 `tests/parity/fixtures/legacy-blind.js` 注入页面，验证新旧实现的嵌入结果逐字节相同，并且可以双向交叉提取。算法一旦有意修改，需要同步更新基线（见 `tests/parity/README.md`）。
- **E2E**（`tests/e2e/app.spec.ts`）：单图导出、参数重绘、JPEG 质量行回归、盲水印闭环、尺寸拦截、批量 ZIP、跳过小图、未检测到、主题与参数持久化。

手工验收建议：

1. `pnpm build && pnpm preview`，访问 `http://127.0.0.1:4173/watermark/`，确认 Worker 路径与资源路径正常；
2. 桌面 1440×900、移动 420×860 各走一遍单图 / 批量 / 提取；
3. 深浅两套主题截图检查对比度与禁用态；
4. 用大图（≥4000px）测试进度条与取消。

## 部署（GitHub Pages）

`.github/workflows/deploy.yml` 在 `main` 分支推送时执行：

1. `pnpm install --frozen-lockfile`
2. `pnpm test`（单元测试）
3. `pnpm build`（含 `vue-tsc --noEmit`）
4. `actions/configure-pages` → `actions/upload-pages-artifact`（`dist`）→ `actions/deploy-pages`

### 首次启用需要把 Pages 源切换到 Actions

仓库设置 → **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**，或使用有 `pages` 权限的 token：

```bash
gh auth refresh -s pages          # 当前的经典 token 需要补 pages scope
gh api -X PUT repos/illagerCPR/watermark/pages -f build_type=workflow
```

切换后旧的分支部署停止；在第一次 Actions 部署成功之前，站点继续服务上一次成功部署的版本。

### 自定义域与 HTTPS

- 自定义域为 `www.illageraris.dpdns.org`，站点路径为 `/watermark/`，因此 `vite.config.ts` 中生产 `base` 固定为 `/watermark/`
- `public/CNAME` 随构建产物发布，保证自定义域不丢
- 证书签发期间（通常 ≤24 小时）只能用 `http://` 验证；签发完成后可开启 HTTPS 强制跳转

### 仓库改名 / 换域名

同时修改：`vite.config.ts` 的 `BASE_PATH`、`public/CNAME`、本文档与 README 中的地址。

## 常见问题

- **页面空白 / 资源 404**：生产构建必须挂在 `/watermark/` 下；直接双击 `dist/index.html` 不可用（ES Module 与 Worker 都不允许 `file://` 协议）。
- **盲水印任务一直不完成**：检查浏览器控制台是否报 Worker 创建失败；失败时 `client.ts` 会回退主线程，仍可用但会占用 UI 线程。
- **提取很慢**：未嵌入水印的图片需要扫描全部窗口，属预期行为，可用取消按钮中断。
- **字体看起来不对**：字体选项按名称引用系统字体，Linux/Android 上没有雅黑等字体会回退，属正常现象。
- **E2E 启动失败**：`webServer` 复用 5173 端口，若已有 dev server 会直接复用；端口被其他程序占用时修改 `playwright.config.ts` 的 `PORT`。
