import { describe, expect, it } from 'vitest'

import { baseName, exportFileName, safeEntryName, uniqueEntryName } from '@/core/render/export'

describe('导出文件名', () => {
  it('只去掉最后一个扩展名', () => {
    expect(baseName('a.b.jpg')).toBe('a.b')
    expect(exportFileName('a.b.jpg', 'png')).toBe('a.b_watermark.png')
    expect(exportFileName('photo.jpeg', 'jpeg')).toBe('photo_watermark.jpg')
  })

  it('无扩展名时直接追加后缀', () => {
    expect(exportFileName('photo', 'png')).toBe('photo_watermark.png')
    expect(exportFileName('  ', 'png')).toBe('image_watermark.png')
  })

  it('ZIP 内同名文件自动编号', () => {
    const used = new Set<string>()
    expect(uniqueEntryName('a_watermark.png', used)).toBe('a_watermark.png')
    expect(uniqueEntryName('a_watermark.png', used)).toBe('a_watermark (2).png')
    expect(uniqueEntryName('a_watermark.png', used)).toBe('a_watermark (3).png')
  })

  it('替换 ZIP 条目中的非法字符', () => {
    expect(safeEntryName('a/b\\c:d*e?.png')).toBe('a_b_c_d_e_.png')
  })
})
