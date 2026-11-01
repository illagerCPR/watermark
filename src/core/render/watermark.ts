import type { WatermarkParams } from '@/core/types'

export interface RenderableImage {
  source: CanvasImageSource
  width: number
  height: number
}

export interface RenderOptions {
  /** 目标画布宽度（默认等于原图宽度）。 */
  width?: number
  /** 目标画布高度（默认等于原图高度）。 */
  height?: number
  /**
   * 水印几何的缩放系数（缩略图用）。默认按目标宽度 / 原图宽度推导；
   * 导出路径不传即为 1。
   */
  scale?: number
}

// 平铺单元画布复用，避免每次渲染都新建 canvas。
const patternCanvas = document.createElement('canvas')
const patternContextOrNull = patternCanvas.getContext('2d')
if (!patternContextOrNull) throw new Error('当前浏览器不支持 Canvas 2D')
const patternContext: CanvasRenderingContext2D = patternContextOrNull

/**
 * 可见水印渲染（由旧版 renderToCanvas 迁移，绘制逻辑保持一致）：
 * 原图 → 文字平铺单元 → createPattern → 以画布中心旋转后填充 2×对角线区域。
 * 预览、单图导出、批量导出与缩略图共用这一个函数，避免逻辑分叉。
 */
export function renderWatermark(
  target: CanvasRenderingContext2D,
  image: RenderableImage,
  params: WatermarkParams,
  options: RenderOptions = {},
): void {
  const width = options.width ?? image.width
  const height = options.height ?? image.height
  const scale = options.scale ?? (image.width > 0 ? width / image.width : 1)

  target.canvas.width = width
  target.canvas.height = height
  target.clearRect(0, 0, width, height)
  target.drawImage(image.source, 0, 0, width, height)

  if (!params.tiledEnabled) return

  const text = params.text.replace(/\r/g, '')
  if (!text.trim()) return

  const lines = text.split('\n')
  const fontSize = Math.max(1, params.fontSize * scale)
  const gapX = params.gapX * scale
  const gapY = params.gapY * scale
  const strokeWidth = params.strokeWidth * scale
  const font = `${params.bold ? 'bold ' : ''}${fontSize}px "${params.fontFamily}"`

  // 先测量最宽行，决定平铺单元尺寸。
  patternContext.font = font
  let maxLineWidth = 0
  for (const line of lines) {
    maxLineWidth = Math.max(maxLineWidth, patternContext.measureText(line).width)
  }

  const lineHeight = fontSize * 1.4
  const tileWidth = Math.max(1, Math.ceil(maxLineWidth + gapX))
  const tileHeight = Math.max(1, Math.ceil(lineHeight * lines.length + gapY))

  // 重设尺寸会清空上下文状态，之后必须重新设置绘制属性。
  patternCanvas.width = tileWidth
  patternCanvas.height = tileHeight
  patternContext.font = font
  patternContext.textBaseline = 'top'
  patternContext.textAlign = 'left'
  patternContext.globalAlpha = params.opacity
  patternContext.fillStyle = params.color
  patternContext.strokeStyle = params.strokeColor
  patternContext.lineWidth = strokeWidth
  patternContext.lineJoin = 'round'

  const offsetX = gapX / 2
  const offsetY = gapY / 2
  lines.forEach((line, index) => {
    const y = offsetY + index * lineHeight
    if (strokeWidth > 0) patternContext.strokeText(line, offsetX, y)
    patternContext.fillText(line, offsetX, y)
  })

  const pattern = target.createPattern(patternCanvas, 'repeat')
  if (!pattern) return

  const centerX = width / 2
  const centerY = height / 2
  const diagonal = Math.hypot(width, height)

  target.save()
  target.translate(centerX, centerY)
  target.rotate((params.angle * Math.PI) / 180)
  target.fillStyle = pattern
  target.fillRect(-diagonal, -diagonal, diagonal * 2, diagonal * 2)
  target.restore()
}
