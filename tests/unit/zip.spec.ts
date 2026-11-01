import { unzipSync } from 'fflate'
import { describe, expect, it } from 'vitest'

import { createMemorySink, ZipWriter, type ZipSink } from '@/core/zip'

const encode = (text: string): Uint8Array<ArrayBuffer> => new TextEncoder().encode(text)

describe('ZipWriter', () => {
  it('流式写入的字节可被解压，条目内容完整', async () => {
    const memory = createMemorySink()
    const writer = new ZipWriter(memory.sink)

    await writer.add('a.txt', encode('hello'))
    await writer.add('nested/b.txt', encode('world'))
    await writer.finish()

    const entries = unzipSync(new Uint8Array(await memory.toBlob().arrayBuffer()))
    expect(new TextDecoder().decode(entries['a.txt'])).toBe('hello')
    expect(new TextDecoder().decode(entries['nested/b.txt'])).toBe('world')
  })

  it('abort 后丢弃已写入的内容，并拒绝继续写入', async () => {
    const memory = createMemorySink()
    const writer = new ZipWriter(memory.sink)

    await writer.add('a.txt', encode('hello'))
    await writer.abort()

    expect(memory.toBlob().size).toBe(0)
    await expect(writer.add('b.txt', encode('x'))).rejects.toThrow('无法继续写入')
  })

  it('sink 写入串行，add 返回时字节已经落盘', async () => {
    const writes: number[] = []
    let inFlight = 0
    let maxInFlight = 0

    const sink: ZipSink = {
      async write(chunk) {
        inFlight += 1
        maxInFlight = Math.max(maxInFlight, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 1))
        writes.push(chunk.length)
        inFlight -= 1
      },
      async close() {},
      async abort() {},
    }

    const writer = new ZipWriter(sink)
    await writer.add('a.bin', new Uint8Array(4096))

    expect(writes.length).toBeGreaterThan(0)
    expect(inFlight).toBe(0)
    expect(maxInFlight).toBe(1)
    await writer.abort()
  })

  it('sink 报错会中止整个写入器', async () => {
    const sink: ZipSink = {
      write() {
        throw new Error('磁盘已满')
      },
      async close() {},
      async abort() {},
    }

    const writer = new ZipWriter(sink)
    await expect(writer.add('a.bin', new Uint8Array(16))).rejects.toThrow('磁盘已满')
    await expect(writer.add('b.bin', new Uint8Array(16))).rejects.toThrow('磁盘已满')
  })
})
