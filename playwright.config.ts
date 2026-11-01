import { defineConfig, devices } from '@playwright/test'

const PORT = 5173
const baseURL = `http://127.0.0.1:${PORT}`

/**
 * E2E 直接跑在 Vite 开发服务器上：Worker、动态导入等行为与生产一致，
 * 且无需每次构建。视觉/构建验证用 `pnpm build && pnpm preview` 手动走查。
 */
export default defineConfig({
  testDir: './tests/e2e',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL,
    channel: 'chrome',
    acceptDownloads: true,
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  webServer: {
    command: `pnpm dev --port ${PORT} --strictPort`,
    url: baseURL,
    reuseExistingServer: true,
    timeout: 120_000,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})
