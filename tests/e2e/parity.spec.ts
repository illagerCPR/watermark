import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

/**
 * 新旧实现对拍：
 * - 同一张图、同一参数下，旧版 blind.js 与新模块的嵌入结果必须逐字节相同；
 * - 双向交叉提取都必须成功（帧格式兼容）。
 * 旧实现固定在 tests/parity/fixtures/legacy-blind.js（取自 old 分支的 blind.js）。
 */
const legacyScript = fileURLToPath(
  new URL('../parity/fixtures/legacy-blind.js', import.meta.url),
)

test('新实现与旧版 blind.js 逐像素一致，且可双向提取', async ({ page }) => {
  await page.goto('/')
  await page.addScriptTag({ path: legacyScript })

  const result = await page.evaluate(async () => {
    type LegacyImage = {
      width: number
      height: number
      data: Uint8ClampedArray<ArrayBuffer>
    }
    type LegacyApi = {
      embed: (image: ImageData, text: string, strength: number) => Promise<ImageData>
      extract: (image: LegacyImage) => Promise<string | null>
    }

    const legacy = (window as unknown as { BlindWatermark: LegacyApi }).BlindWatermark
    const modulePath: string = '/src/core/blind/algorithm.js'
    const current = (await import(modulePath)) as {
      embed: (image: LegacyImage, text: string, strength: number) => Promise<LegacyImage>
      extract: (image: LegacyImage) => Promise<string | null>
    }

    const width = 512
    const height = 512
    const base = new Uint8ClampedArray(width * height * 4)
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const index = (y * width + x) * 4
        base[index] = (x * 3 + y) % 256
        base[index + 1] = (y * 5 + x * 2) % 256
        base[index + 2] = (x * x + y * 7) % 256
        base[index + 3] = 255
      }
    }

    const asBuffer = (image: LegacyImage): LegacyImage => ({
      width: image.width,
      height: image.height,
      data: new Uint8ClampedArray(image.data),
    })

    const legacyInput = new ImageData(new Uint8ClampedArray(base), width, height)
    const legacyOutput = await legacy.embed(legacyInput, 'parity-2026', 2)
    const currentOutput = await current.embed(asBuffer(legacyInput), 'parity-2026', 2)

    const digest = async (data: Uint8ClampedArray<ArrayBuffer>): Promise<string> => {
      const hash = await crypto.subtle.digest('SHA-256', data)
      return Array.from(new Uint8Array(hash))
        .map((byte) => byte.toString(16).padStart(2, '0'))
        .join('')
    }

    let equal = legacyOutput.data.length === currentOutput.data.length
    if (equal) {
      for (let i = 0; i < legacyOutput.data.length; i += 1) {
        if (legacyOutput.data[i] !== currentOutput.data[i]) {
          equal = false
          break
        }
      }
    }

    return {
      equal,
      legacyHash: await digest(legacyOutput.data),
      currentHash: await digest(currentOutput.data),
      legacyText: await legacy.extract(legacyOutput),
      currentText: await current.extract(currentOutput),
      crossLegacy: await current.extract(asBuffer(legacyOutput)),
      crossCurrent: await legacy.extract({
        width: currentOutput.width,
        height: currentOutput.height,
        data: new Uint8ClampedArray(currentOutput.data),
      }),
    }
  })

  expect(
    result.equal,
    `哈希不一致：legacy=${result.legacyHash} current=${result.currentHash}`,
  ).toBe(true)
  expect(result.legacyText).toBe('parity-2026')
  expect(result.currentText).toBe('parity-2026')
  expect(result.crossLegacy).toBe('parity-2026')
  expect(result.crossCurrent).toBe('parity-2026')
})
