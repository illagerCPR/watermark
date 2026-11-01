import type { ExportFormat } from '@/core/types'

export const FORMAT_MIME: Record<ExportFormat, string> = {
  png: 'image/png',
  jpeg: 'image/jpeg',
}

export const FORMAT_EXTENSION: Record<ExportFormat, string> = {
  png: 'png',
  jpeg: 'jpg',
}

export function canvasToBlob(
  canvas: HTMLCanvasElement,
  format: ExportFormat,
  quality: number,
): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('导出失败：画布内容为空'))
      },
      FORMAT_MIME[format],
      format === 'jpeg' ? quality : undefined,
    )
  })
}

/** 去掉最后一个扩展名；没有扩展名时原样返回。 */
export function baseName(name: string): string {
  const trimmed = name.trim() || 'image'
  const dot = trimmed.lastIndexOf('.')
  return dot > 0 ? trimmed.slice(0, dot) : trimmed
}

export function exportFileName(originalName: string, format: ExportFormat): string {
  return `${baseName(originalName)}_watermark.${FORMAT_EXTENSION[format]}`
}

/** ZIP 条目名不能包含路径分隔符等非法字符。 */
export function safeEntryName(name: string): string {
  return name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
}

export function uniqueEntryName(name: string, used: Set<string>): string {
  let candidate = safeEntryName(name)
  if (!used.has(candidate)) {
    used.add(candidate)
    return candidate
  }

  const dot = candidate.lastIndexOf('.')
  const stem = dot > 0 ? candidate.slice(0, dot) : candidate
  const extension = dot > 0 ? candidate.slice(dot) : ''
  let index = 2
  while (used.has(`${stem} (${index})${extension}`)) index += 1
  candidate = `${stem} (${index})${extension}`
  used.add(candidate)
  return candidate
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.rel = 'noopener'
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
