import { defineConfig, devices } from '@playwright/test'

const DEV_PORT = 5173
const PREVIEW_PORT = 4173
const devURL = `http://127.0.0.1:${DEV_PORT}`
const previewURL = `http://127.0.0.1:${PREVIEW_PORT}/watermark/`

const isCI = Boolean(process.env.CI)

/**
 * E2E 跑两个目标：
 * - dev：Vite 开发服务器（根路径），覆盖交互与算法闭环；
 * - preview：`vite build` 产物（base=/watermark/），专治子路径资源/Worker 回归。
 * CI 使用 Playwright 固定版本 chromium；本地默认系统 Chrome，免去额外下载。
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: isCI ? 1 : 0,
  reporter: isCI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  use: {
    channel: isCI ? undefined : 'chrome',
    acceptDownloads: true,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  webServer: [
    {
      command: `pnpm dev --port ${DEV_PORT} --strictPort`,
      url: devURL,
      reuseExistingServer: !isCI,
      timeout: 120_000,
    },
    {
      // 构建产物才是线上真正跑的东西，先构建再预览。
      command: `pnpm build && pnpm preview --port ${PREVIEW_PORT} --strictPort`,
      url: previewURL,
      reuseExistingServer: !isCI,
      timeout: 180_000,
    },
  ],
  projects: [
    {
      name: 'dev',
      testIgnore: /preview\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: devURL },
    },
    {
      name: 'preview',
      testMatch: /preview\.spec\.ts/,
      use: { ...devices['Desktop Chrome'], baseURL: previewURL },
    },
  ],
})
