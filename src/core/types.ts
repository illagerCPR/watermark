export type ExportFormat = 'png' | 'jpeg'

/** 可见水印 + 盲水印的全部参数（与旧版 state 一一对应）。 */
export interface WatermarkParams {
  tiledEnabled: boolean
  text: string
  fontFamily: string
  fontSize: number
  bold: boolean
  color: string
  strokeColor: string
  strokeWidth: number
  opacity: number
  angle: number
  gapX: number
  gapY: number
  blindEnabled: boolean
  blindText: string
  blindStrength: number
  format: ExportFormat
  quality: number
}

/** 已解码的图片（单图与批量共用）。 */
export interface LoadedImage {
  name: string
  width: number
  height: number
  size: number
  source: HTMLImageElement
}

/** 批量队列中的一项。 */
export interface BatchItem extends LoadedImage {
  id: number
}
