import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'
import { unzipSync } from 'fflate'

const SINGLE = 'section[aria-label="单图模式"]'
const BATCH = 'section[aria-label="批量模式"]'

const fixture = (name: string): string =>
  fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))

async function saveDownload(
  page: Page,
  trigger: () => Promise<unknown>,
): Promise<{ path: string; name: string }> {
  const [download] = await Promise.all([page.waitForEvent('download'), trigger()])
  const path = test.info().outputPath(download.suggestedFilename())
  await download.saveAs(path)
  return { path, name: download.suggestedFilename() }
}

function readPngSize(buffer: Buffer): { width: number; height: number } {
  expect(buffer.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

function canvasChecksum(page: Page): Promise<number> {
  return page.locator(`${SINGLE} canvas`).evaluate((canvas: HTMLCanvasElement) => {
    const context = canvas.getContext('2d')
    if (!context) throw new Error('no 2d context')
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height)
    let sum = 0
    for (let index = 0; index < data.length; index += 1009) {
      sum = (sum * 31 + (data[index] ?? 0)) % 1_000_000_007
    }
    return sum
  })
}

test.describe('单图模式', () => {
  test('导出 PNG 保持原始分辨率与文件名约定', async ({ page }) => {
    await page.goto('/')
    await page.setInputFiles(`${SINGLE} input[type=file]`, fixture('photo.jpg'))
    await expect(page.locator(`${SINGLE} canvas`)).toBeVisible()

    const { path, name } = await saveDownload(page, () =>
      page.locator(`${SINGLE} footer button.btn-primary`).click(),
    )

    expect(name).toBe('photo_watermark.png')
    expect(readPngSize(readFileSync(path))).toEqual({ width: 1200, height: 800 })
  })

  test('参数变化会重绘预览，JPEG 质量只在 JPEG 格式下出现', async ({ page }) => {
    await page.goto('/')
    await page.setInputFiles(`${SINGLE} input[type=file]`, fixture('photo.jpg'))
    await expect(page.locator(`${SINGLE} canvas`)).toBeVisible()

    const before = await canvasChecksum(page)
    const fontSize = page.locator('input[aria-label="字体大小数值"]')
    await fontSize.fill('72')
    await fontSize.press('Tab')
    await page.waitForTimeout(350)
    expect(await canvasChecksum(page)).not.toBe(before)

    // 旧版 bug：.group.row 的 flex 会覆盖 hidden，JPEG 质量行在 PNG 下常显。
    const quality = page.getByRole('slider', { name: 'JPEG 质量' })
    await expect(quality).toHaveCount(0)
    await page.getByLabel('图片格式').selectOption('jpeg')
    await expect(quality).toBeVisible()
    await page.getByLabel('图片格式').selectOption('png')
    await expect(quality).toHaveCount(0)
  })

  test('盲水印：格式锁定、导出后可从图片中提取', async ({ page }) => {
    await page.goto('/')
    await page.setInputFiles(`${SINGLE} input[type=file]`, fixture('photo.jpg'))
    await expect(page.locator(`${SINGLE} canvas`)).toBeVisible()

    await page.getByRole('switch', { name: '嵌入盲水印' }).click()
    await expect(page.getByLabel('图片格式')).toBeDisabled()
    await page.getByPlaceholder('如：版权归属-张三').fill('e2e-盲水印-42')

    const { path, name } = await saveDownload(page, () =>
      page.locator(`${SINGLE} footer button.btn-primary`).click(),
    )
    expect(name).toBe('photo_watermark.png')

    await page.getByRole('button', { name: '提取盲水印' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.setInputFiles('[role=dialog] input[type=file]', path)
    await expect(page.locator('[role=dialog] textarea')).toHaveValue('e2e-盲水印-42', {
      timeout: 30_000,
    })
  })

  test('盲水印：任一边小于 256 像素时拒绝导出', async ({ page }) => {
    await page.goto('/')
    await page.setInputFiles(`${SINGLE} input[type=file]`, fixture('small.png'))
    await expect(page.locator(`${SINGLE} canvas`)).toBeVisible()

    await page.getByRole('switch', { name: '嵌入盲水印' }).click()
    await page.getByPlaceholder('如：版权归属-张三').fill('too-small')
    await page.locator(`${SINGLE} footer button.btn-primary`).click()

    await expect(page.getByText(/无法嵌入盲水印/)).toBeVisible()
  })
})

test.describe('批量模式', () => {
  test('ZIP 导出包含全部图片', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('tab', { name: '批量' }).click()
    await page.setInputFiles(`${BATCH} input[type=file]`, [
      fixture('photo.jpg'),
      fixture('photo2.jpg'),
    ])
    await expect(page.locator(`${BATCH} canvas`)).toHaveCount(2)

    const { path, name } = await saveDownload(page, () =>
      page.locator(`${BATCH} footer button.btn-primary`).click(),
    )
    expect(name).toMatch(/^watermarks_\d{8}-\d{6}\.zip$/)

    const entries = unzipSync(new Uint8Array(readFileSync(path)))
    expect(Object.keys(entries).sort()).toEqual([
      'photo2_watermark.png',
      'photo_watermark.png',
    ])
  })

  test('盲水印开启时跳过小图并在 ZIP 中排除', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('switch', { name: '嵌入盲水印' }).click()
    await page.getByPlaceholder('如：版权归属-张三').fill('batch-blind')

    await page.getByRole('tab', { name: '批量' }).click()
    await page.setInputFiles(`${BATCH} input[type=file]`, [
      fixture('photo.jpg'),
      fixture('small.png'),
    ])
    await expect(page.locator(`${BATCH} canvas`)).toHaveCount(2)

    const { path } = await saveDownload(page, () =>
      page.locator(`${BATCH} footer button.btn-primary`).click(),
    )

    await expect(page.getByText(/1 张尺寸过小已跳过/)).toBeVisible()
    const entries = unzipSync(new Uint8Array(readFileSync(path)))
    expect(Object.keys(entries)).toEqual(['photo_watermark.png'])
    expect(entries['photo_watermark.png']?.byteLength ?? 0).toBeGreaterThan(1000)
  })
})

test.describe('提取与设置', () => {
  test('未嵌入水印的图片提示未检测到', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '提取盲水印' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.setInputFiles('[role=dialog] input[type=file]', fixture('neutral.png'))
    await expect(page.getByText(/未检测到盲水印/)).toBeVisible({ timeout: 30_000 })
  })

  test('主题切换后刷新仍保持', async ({ page }) => {
    await page.goto('/')
    await page.getByRole('button', { name: '切换到浅色主题' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.reload()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
  })

  test('参数刷新后从 localStorage 恢复', async ({ page }) => {
    await page.goto('/')
    const fontSize = page.locator('input[aria-label="字体大小数值"]')
    await fontSize.fill('88')
    await fontSize.press('Tab')
    await page.waitForTimeout(500)

    await page.reload()
    await expect(page.locator('input[aria-label="字体大小数值"]')).toHaveValue('88')
  })
})
