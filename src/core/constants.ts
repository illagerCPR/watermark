export const APP_NAME = '图片水印工具'
export const APP_TAGLINE = '本地处理 · 不上传服务器'

/** 盲水印要求图片任一边不小于该值（256 为频域瓦片周期）。 */
export const BLIND_MIN_SIZE = 256

/** 盲水印文本在 UI 层的字符上限。 */
export const BLIND_TEXT_MAX_LENGTH = 64

/** 盲水印文本的硬限制：UTF-8 编码后的字节数（由算法帧编码决定，单测校验一致性）。 */
export const BLIND_MAX_BYTES = 200

/** 与旧版保持一致的字体列表。 */
export const FONT_FAMILIES = [
  { value: 'Microsoft YaHei', label: '微软雅黑' },
  { value: 'SimSun', label: '宋体' },
  { value: 'SimHei', label: '黑体' },
  { value: 'KaiTi', label: '楷体' },
  { value: 'FangSong', label: '仿宋' },
  { value: 'Arial', label: 'Arial' },
  { value: 'Times New Roman', label: 'Times New Roman' },
  { value: 'Courier New', label: 'Courier New' },
  { value: 'Georgia', label: 'Georgia' },
  { value: 'Impact', label: 'Impact' },
] as const

export interface NumberLimit {
  min: number
  max: number
  step: number
}

export const LIMITS = {
  fontSize: { min: 12, max: 200, step: 1 },
  strokeWidth: { min: 0, max: 10, step: 0.5 },
  opacity: { min: 0.05, max: 1, step: 0.05 },
  angle: { min: -90, max: 90, step: 1 },
  gapX: { min: 0, max: 400, step: 5 },
  gapY: { min: 0, max: 400, step: 5 },
  quality: { min: 0.6, max: 1, step: 0.02 },
  blindStrength: { min: 0.5, max: 10, step: 0.5 },
} as const satisfies Record<string, NumberLimit>

export type LimitKey = keyof typeof LIMITS
