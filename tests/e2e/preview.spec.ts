import { expect, test } from '@playwright/test'

import { fixture, saveDownload } from './support'

const SINGLE = 'section[aria-label="单图模式"]'

/**
 * 生产构建冒烟：dev server 走根路径，无法覆盖 base=/watermark/ 的问题，
 * 因此这里单独跑一份 vite preview 的构建产物。
 */
test.describe('生产构建冒烟（base=/watermark/）', () => {
  test('子路径下资源、导出与 Web Worker 全链路正常', async ({ page }) => {
    const httpErrors: string[] = []
    const consoleErrors: string[] = []

    page.on('response', (response) => {
      if (response.status() >= 400) httpErrors.push(`${response.status()} ${response.url()}`)
    })
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => consoleErrors.push(String(error)))

    // baseURL 已包含 /watermark/，用 '.' 解析到子路径根。
    await page.goto('.')
    await expect(page.locator(SINGLE)).toBeVisible()

    await page.setInputFiles(`${SINGLE} input[type=file]`, fixture('photo.jpg'))
    await expect(page.locator(`${SINGLE} canvas`)).toBeVisible()

    // 盲水印依赖 Worker 与动态导入，子路径写错时在这一步立即暴露。
    await page.getByRole('switch', { name: '嵌入盲水印' }).click()
    await page.getByPlaceholder('如：版权归属-张三').fill('preview-子路径-42')

    const { path, name } = await saveDownload(page, () =>
      page.locator(`${SINGLE} footer button.btn-primary`).click(),
    )
    expect(name).toBe('photo_watermark.png')

    await page.getByRole('button', { name: '提取盲水印' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.setInputFiles('[role=dialog] input[type=file]', path)
    await expect(page.locator('[role=dialog] textarea')).toHaveValue('preview-子路径-42', {
      timeout: 30_000,
    })

    expect(httpErrors).toEqual([])
    expect(consoleErrors).toEqual([])
  })
})
