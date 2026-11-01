import { Zip, ZipPassThrough } from 'fflate'

export interface ZipEntry {
  name: string
  data: Uint8Array
}

function yieldToUi(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0)
  })
}

/**
 * 用 fflate 的流式打包器生成 ZIP。
 * 图片本身已是压缩格式，因此使用 store（不压缩），速度快且不改变画质。
 * 每加入一个文件让出一次事件循环，保证进度条与取消按钮始终可响应。
 */
export async function createZip(
  entries: ZipEntry[],
  onProgress?: (done: number, total: number) => void,
  shouldAbort?: () => boolean,
): Promise<Blob> {
  const chunks: Uint8Array[] = []
  let failure: Error | null = null

  const zip = new Zip((error, chunk) => {
    if (error) {
      failure = error
      return
    }
    if (chunk && chunk.length > 0) chunks.push(chunk)
  })

  for (let index = 0; index < entries.length; index += 1) {
    if (shouldAbort?.()) {
      const abortError = new Error('操作已取消')
      abortError.name = 'AbortError'
      throw abortError
    }
    const entry = entries[index]
    if (!entry) continue
    const file = new ZipPassThrough(entry.name)
    zip.add(file)
    file.push(entry.data, true)
    onProgress?.(index + 1, entries.length)
    await yieldToUi()
    if (failure) throw failure
  }

  zip.end()
  if (failure) throw failure
  if (chunks.length === 0) throw new Error('打包失败：没有可写入的文件')

  // 每个 chunk 都是独立拷贝，拼成 Blob 后即可交给浏览器下载。
  return new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' })
}
