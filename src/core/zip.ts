import { Zip, ZipPassThrough } from 'fflate'

export interface ZipEntry {
  name: string
  data: Uint8Array
}

/** 接收 ZIP 字节流的目标：内存 Blob，或直接落到用户选定的文件。 */
export interface ZipSink {
  write(chunk: Uint8Array<ArrayBuffer>): Promise<void> | void
  close(): Promise<void>
  abort(reason?: unknown): Promise<void>
}

/**
 * 边生成边写出的 ZIP 写入器。
 *
 * fflate 的回调是同步的，这里用 Promise 队列把字节接到异步 sink 上；
 * 每写完一个条目就 await 队列形成反压，因此内存里最多只有当前这张图的字节。
 */
export class ZipWriter {
  private readonly zip: Zip
  private tail: Promise<void> = Promise.resolve()
  private failure: Error | null = null
  private closed = false

  constructor(private readonly sink: ZipSink) {
    this.zip = new Zip((error, chunk) => {
      if (error) {
        this.fail(error)
        return
      }
      if (!chunk || chunk.length === 0) return
      this.tail = this.tail.then(async () => {
        if (this.failure) return
        await this.sink.write(chunk)
      })
    })
  }

  /** 写入一个条目；返回时该条目的字节已经交给 sink。 */
  async add(name: string, data: Uint8Array): Promise<void> {
    this.assertOpen()
    const file = new ZipPassThrough(name)
    this.zip.add(file)
    file.push(data, true)
    await this.drain()
  }

  /** 写完中央目录并关闭 sink；之后不再接受新条目。 */
  async finish(): Promise<void> {
    this.assertOpen()
    this.closed = true
    this.zip.end()
    await this.drain()
    await this.sink.close()
  }

  /** 放弃本次打包：已写出的半成品由 sink 负责丢弃。 */
  async abort(reason?: unknown): Promise<void> {
    if (this.closed) return
    this.closed = true
    await this.tail.catch(() => undefined)
    await this.sink.abort(reason)
  }

  private assertOpen(): void {
    if (this.closed) throw new Error('ZIP 已关闭，无法继续写入')
    if (this.failure) throw this.failure
  }

  private fail(error: Error): void {
    this.failure ??= error
  }

  private async drain(): Promise<void> {
    await this.tail.catch((error: unknown) => {
      this.fail(error instanceof Error ? error : new Error(String(error)))
    })
    if (this.failure) throw this.failure
  }
}

/** 把 ZIP 攒在内存里，结束时交给浏览器下载；不支持流式落盘时使用。 */
export function createMemorySink(): { sink: ZipSink; toBlob: () => Blob } {
  const chunks: Uint8Array[] = []
  let aborted = false

  return {
    sink: {
      write(chunk) {
        if (!aborted) chunks.push(chunk)
      },
      async close() {
        // 由 toBlob() 统一生成，无需额外动作。
      },
      async abort() {
        aborted = true
        chunks.length = 0
      },
    },
    toBlob() {
      return new Blob(chunks as unknown as BlobPart[], { type: 'application/zip' })
    },
  }
}

/** 直接写入用户通过保存对话框选定的文件（File System Access API）。 */
export function createFileSink(handle: FileSystemFileHandle): ZipSink {
  const writablePromise = handle.createWritable()

  return {
    async write(chunk) {
      const writable = await writablePromise
      await writable.write(chunk)
    },
    async close() {
      const writable = await writablePromise
      await writable.close()
    },
    async abort(reason) {
      try {
        const writable = await writablePromise
        await writable.abort(reason)
      } catch {
        // 文件流可能已经关闭或用户已收回权限，取消时忽略即可。
      }
    },
  }
}

/** 一次性把小批量条目打成内存 ZIP，供测试与其他调用方使用。 */
export async function createZip(
  entries: ZipEntry[],
  onProgress?: (done: number, total: number) => void,
  shouldAbort?: () => boolean,
): Promise<Blob> {
  const memory = createMemorySink()
  const writer = new ZipWriter(memory.sink)

  for (let index = 0; index < entries.length; index += 1) {
    if (shouldAbort?.()) {
      await writer.abort()
      const abortError = new Error('操作已取消')
      abortError.name = 'AbortError'
      throw abortError
    }
    const entry = entries[index]
    if (!entry) continue
    await writer.add(entry.name, entry.data)
    onProgress?.(index + 1, entries.length)
  }

  if (entries.length === 0) throw new Error('打包失败：没有可写入的文件')
  await writer.finish()
  return memory.toBlob()
}
