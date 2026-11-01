import type { LoadedImage } from './types'

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

/**
 * 用 object URL + HTMLImageElement 解码图片（与旧版一致）。
 * 返回的 Image 已完全解码，可反复 drawImage；URL 在 onload 后立即释放。
 */
export function loadImageFile(file: File): Promise<LoadedImage> {
  return new Promise((resolve, reject) => {
    if (!isImageFile(file)) {
      reject(new Error('不是支持的图片格式'))
      return
    }

    const url = URL.createObjectURL(file)
    const image = new Image()
    image.decoding = 'async'
    image.onload = () => {
      URL.revokeObjectURL(url)
      if (!image.naturalWidth || !image.naturalHeight) {
        reject(new Error('图片尺寸无效'))
        return
      }
      resolve({
        name: file.name,
        width: image.naturalWidth,
        height: image.naturalHeight,
        size: file.size,
        source: image,
      })
    }
    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('图片加载失败，请换一张试试'))
    }
    image.src = url
  })
}

/** 把图片绘制进一个临时画布并取出像素数据（盲水印与提取共用）。 */
export function toImageData(source: CanvasImageSource, width: number, height: number): ImageData {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('当前浏览器不支持 Canvas 2D')
  context.drawImage(source, 0, 0, width, height)
  return context.getImageData(0, 0, width, height)
}

/** 新建一个指定尺寸的画布并取得 2D 上下文。 */
export function createCanvas(
  width: number,
  height: number,
  attributes?: CanvasRenderingContext2DSettings,
): {
  canvas: HTMLCanvasElement
  context: CanvasRenderingContext2D
} {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d', attributes)
  if (!context) throw new Error('当前浏览器不支持 Canvas 2D')
  return { canvas, context }
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / 1024 ** exponent
  return `${value.toFixed(value >= 10 || exponent === 0 ? 0 : 1)} ${units[exponent]}`
}

export function formatDimensions(width: number, height: number): string {
  return `${width} × ${height}`
}
