import { describe, expect, it } from 'vitest'

import {
  DEFAULT_PARAMS,
  blindTextByteLength,
  sanitizeParams,
  visibleSignature,
} from '@/core/params'

describe('参数清洗', () => {
  it('空输入回退到默认值', () => {
    expect(sanitizeParams(null)).toEqual(DEFAULT_PARAMS)
    expect(sanitizeParams({})).toEqual(DEFAULT_PARAMS)
  })

  it('数值越界被钳制', () => {
    const params = sanitizeParams({
      fontSize: 999,
      opacity: -3,
      angle: 400,
      quality: 0.1,
      blindStrength: 42,
      gapX: -5,
      strokeWidth: 0.3,
    })
    expect(params.fontSize).toBe(200)
    expect(params.opacity).toBe(0.05)
    expect(params.angle).toBe(90)
    expect(params.quality).toBe(0.6)
    expect(params.blindStrength).toBe(10)
    expect(params.gapX).toBe(0)
    expect(params.strokeWidth).toBe(0.3)
  })

  it('非法颜色、字体与格式回退', () => {
    const params = sanitizeParams({
      color: 'red',
      strokeColor: '#GGGGGG',
      fontFamily: 'Comic Sans MS',
      format: 'gif',
    })
    expect(params.color).toBe(DEFAULT_PARAMS.color)
    expect(params.strokeColor).toBe(DEFAULT_PARAMS.strokeColor)
    expect(params.fontFamily).toBe(DEFAULT_PARAMS.fontFamily)
    expect(params.format).toBe('png')
  })

  it('开启盲水印时格式锁定 PNG', () => {
    const params = sanitizeParams({ blindEnabled: true, format: 'jpeg' })
    expect(params.format).toBe('png')
  })

  it('盲水印文本按字符而不是 UTF-16 单元截断', () => {
    const params = sanitizeParams({ blindText: '😀'.repeat(80) })
    expect(Array.from(params.blindText)).toHaveLength(64)
    expect(blindTextByteLength(params.blindText)).toBe(64 * 4)
  })

  it('可见水印签名随参数变化', () => {
    const params = { ...DEFAULT_PARAMS }
    const before = visibleSignature(params)
    params.fontSize = 48
    expect(visibleSignature(params)).not.toBe(before)
    // 与可见水印无关的参数不应触发重绘
    const blindOnly = { ...DEFAULT_PARAMS, blindEnabled: true, blindText: 'x' }
    expect(visibleSignature(blindOnly)).toBe(visibleSignature({ ...DEFAULT_PARAMS }))
  })
})
