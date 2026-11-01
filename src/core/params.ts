import { BLIND_TEXT_MAX_LENGTH, FONT_FAMILIES, LIMITS } from './constants'
import type { ExportFormat, WatermarkParams } from './types'

export const DEFAULT_PARAMS: WatermarkParams = {
  tiledEnabled: true,
  text: '仅供内部使用\nCONFIDENTIAL',
  fontFamily: 'Microsoft YaHei',
  fontSize: 36,
  bold: false,
  color: '#888888',
  strokeColor: '#000000',
  strokeWidth: 0,
  opacity: 0.3,
  angle: -30,
  gapX: 80,
  gapY: 60,
  blindEnabled: false,
  blindText: '',
  blindStrength: 1.5,
  format: 'png',
  quality: 0.92,
}

const FONT_VALUES = new Set<string>(FONT_FAMILIES.map((font) => font.value))
const HEX_COLOR = /^#[0-9a-f]{6}$/i
const MAX_TEXT_LENGTH = 5000

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null
}

function asBoolean(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function asString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function asColor(value: unknown, fallback: string): string {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value.toLowerCase() : fallback
}

export function clampNumber(
  value: number,
  limit: { min: number; max: number; step: number },
): number {
  if (!Number.isFinite(value)) return limit.min
  const clamped = Math.min(limit.max, Math.max(limit.min, value))
  // 消除浮点噪声（例如 0.15000000000000002），同时不强行对齐 step。
  return Math.round(clamped * 1000) / 1000
}

function asNumber(
  value: unknown,
  limit: { min: number; max: number; step: number },
  fallback: number,
): number {
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return fallback
  return clampNumber(numeric, limit)
}

function asLimit<T extends keyof typeof LIMITS>(value: unknown, key: T, fallback: number): number {
  return asNumber(value, LIMITS[key], fallback)
}

function truncateChars(value: string, maxLength: number): string {
  const chars = Array.from(value)
  return chars.length > maxLength ? chars.slice(0, maxLength).join('') : value
}

/** 把任意来源（localStorage、旧版本数据）清洗成合法参数。 */
export function sanitizeParams(raw: unknown): WatermarkParams {
  const input = isRecord(raw) ? raw : {}
  const format: ExportFormat = input.format === 'jpeg' ? 'jpeg' : 'png'
  const blindEnabled = asBoolean(input.blindEnabled, DEFAULT_PARAMS.blindEnabled)
  const fontFamily = asString(input.fontFamily, DEFAULT_PARAMS.fontFamily)

  return {
    tiledEnabled: asBoolean(input.tiledEnabled, DEFAULT_PARAMS.tiledEnabled),
    text: asString(input.text, DEFAULT_PARAMS.text).slice(0, MAX_TEXT_LENGTH),
    fontFamily: FONT_VALUES.has(fontFamily) ? fontFamily : DEFAULT_PARAMS.fontFamily,
    fontSize: asLimit(input.fontSize, 'fontSize', DEFAULT_PARAMS.fontSize),
    bold: asBoolean(input.bold, DEFAULT_PARAMS.bold),
    color: asColor(input.color, DEFAULT_PARAMS.color),
    strokeColor: asColor(input.strokeColor, DEFAULT_PARAMS.strokeColor),
    strokeWidth: asLimit(input.strokeWidth, 'strokeWidth', DEFAULT_PARAMS.strokeWidth),
    opacity: asLimit(input.opacity, 'opacity', DEFAULT_PARAMS.opacity),
    angle: asLimit(input.angle, 'angle', DEFAULT_PARAMS.angle),
    gapX: asLimit(input.gapX, 'gapX', DEFAULT_PARAMS.gapX),
    gapY: asLimit(input.gapY, 'gapY', DEFAULT_PARAMS.gapY),
    blindEnabled,
    blindText: truncateChars(
      asString(input.blindText, DEFAULT_PARAMS.blindText).replace(/\r/g, ''),
      BLIND_TEXT_MAX_LENGTH,
    ),
    blindStrength: asLimit(input.blindStrength, 'blindStrength', DEFAULT_PARAMS.blindStrength),
    // 开启盲水印时导出格式锁定 PNG（与旧版行为一致）。
    format: blindEnabled ? 'png' : format,
    quality: asLimit(input.quality, 'quality', DEFAULT_PARAMS.quality),
  }
}

/** 盲水印文本按 UTF-8 编码后的字节数（算法帧的硬限制是 200 字节）。 */
export function blindTextByteLength(text: string): number {
  return new TextEncoder().encode(text).length
}

/** 参数是否会影响可见水印的渲染（用于缩略图/预览的重绘判断）。 */
export function visibleSignature(params: WatermarkParams): string {
  return [
    params.tiledEnabled,
    params.text,
    params.fontFamily,
    params.fontSize,
    params.bold,
    params.color,
    params.strokeColor,
    params.strokeWidth,
    params.opacity,
    params.angle,
    params.gapX,
    params.gapY,
  ].join('|')
}
