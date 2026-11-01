import { embed, extract } from './algorithm.js'
import type { BlindRequest, BlindResponse } from './protocol'

/**
 * 盲水印 Worker：把 FFT 计算移出主线程。
 * 进度通过 postMessage 汇报；结果缓冲区以 Transferable 零拷贝回传。
 */

interface WorkerScope {
  postMessage(message: BlindResponse, transfer?: Transferable[]): void
  onmessage: ((event: MessageEvent<BlindRequest>) => void) | null
}

const scope = self as unknown as WorkerScope

scope.onmessage = (event: MessageEvent<BlindRequest>) => {
  const request = event.data
  const post = (message: BlindResponse, transfer: Transferable[] = []) => {
    scope.postMessage(message, transfer)
  }

  const run = async () => {
    try {
      if (request.type === 'embed') {
        const image = await embed(request.image, request.text, request.strength, (progress) => {
          post({ id: request.id, type: 'progress', progress })
        })
        post({ id: request.id, type: 'embed-done', image }, [image.data.buffer as ArrayBuffer])
      } else {
        const text = await extract(request.image, (progress) => {
          post({ id: request.id, type: 'progress', progress })
        })
        post({ id: request.id, type: 'extract-done', text })
      }
    } catch (error) {
      post({
        id: request.id,
        type: 'error',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  void run()
}
