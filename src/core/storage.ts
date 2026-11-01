import { sanitizeParams } from './params'
import type { WatermarkParams } from './types'

const STORAGE_KEYS = {
  params: 'watermark.params',
  theme: 'watermark.theme',
} as const

function readItem(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeItem(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    // 隐私模式或配额不足时静默降级：功能本身不依赖持久化。
  }
}

/** 读取并清洗已保存参数；没有保存时返回 null（由调用方套用默认值）。 */
export function loadStoredParams(): WatermarkParams | null {
  const raw = readItem(STORAGE_KEYS.params)
  if (!raw) return null
  try {
    return sanitizeParams(JSON.parse(raw))
  } catch {
    return null
  }
}

export function saveStoredParams(params: WatermarkParams): void {
  writeItem(STORAGE_KEYS.params, JSON.stringify(params))
}

export type ThemeName = 'dark' | 'light'

export function loadStoredTheme(): ThemeName | null {
  const raw = readItem(STORAGE_KEYS.theme)
  return raw === 'dark' || raw === 'light' ? raw : null
}

export function saveStoredTheme(theme: ThemeName): void {
  writeItem(STORAGE_KEYS.theme, theme)
}
