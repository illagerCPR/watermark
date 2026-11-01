import { describe, expect, it } from 'vitest'

import { embed, extract, MAX_PAYLOAD } from '@/core/blind/algorithm.js'
import type { ImageBuffer } from '@/core/blind/types'
import { BLIND_MAX_BYTES } from '@/core/constants'

/** 生成确定性的渐变 + 噪声图，避免纯色图在频域上表现过于理想。 */
function makeImage(width: number, height: number): ImageBuffer {
  const data = new Uint8ClampedArray(width * height * 4)
  let seed = 0x1234_5678
  const rand = () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
    return seed / 0x1_0000_0000
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = (y * width + x) * 4
      data[index] = Math.round((x / width) * 190 + rand() * 45)
      data[index + 1] = Math.round((y / height) * 150 + rand() * 60)
      data[index + 2] = Math.round(120 + Math.sin((x + y) / 17) * 50)
      data[index + 3] = 255
    }
  }

  return {
    width,
    height,
    data: data as Uint8ClampedArray<ArrayBuffer>,
  }
}

describe('盲水印算法（迁移自 blind.js）', () => {
  it('嵌入后可原样提取', async () => {
    const image = makeImage(512, 512)
    const embedded = await embed(image, '版权测试-2026', 2)
    expect(embedded.width).toBe(512)
    expect(embedded.height).toBe(512)
    expect(await extract(embedded)).toBe('版权测试-2026')
  })

  it('未嵌入的图片返回 null', async () => {
    const image = makeImage(320, 320)
    expect(await extract(image)).toBeNull()
  })

  it('拒绝空文本与超长文本', async () => {
    await expect(embed(makeImage(300, 300), '', 1.5)).rejects.toThrow('盲水印文本为空')
    await expect(
      embed(makeImage(300, 300), 'a'.repeat(BLIND_MAX_BYTES + 1), 1.5),
    ).rejects.toThrow('盲水印文本过长')
  })

  it('已取消的 AbortSignal 立即拒绝', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      embed(makeImage(300, 300), 'x', 1.5, undefined, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
    await expect(
      extract(makeImage(300, 300), undefined, controller.signal),
    ).rejects.toMatchObject({ name: 'AbortError' })
  })

  it('UI 常量与算法上限保持一致', () => {
    expect(MAX_PAYLOAD).toBe(BLIND_MAX_BYTES)
  })
})
