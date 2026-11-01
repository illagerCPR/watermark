import type { BlindRequest, BlindResponse } from './protocol'
import type { ImageBuffer } from './types'

export interface BlindJobOptions {
  onProgress?: (progress: number) => void
  signal?: AbortSignal
}

/** 用户主动取消盲水印任务时抛出（name 为标准的 AbortError）。 */
export class BlindCancelledError extends Error {
  constructor() {
    super('操作已取消')
    this.name = 'AbortError'
  }
}

interface PendingJob {
  resolve: (value: ImageBuffer | string | null) => void
  reject: (reason?: unknown) => void
  onProgress?: (progress: number) => void
  cleanup: () => void
}

let worker: Worker | null = null
let workerUnavailable = false
let nextId = 0
const pending = new Map<number, PendingJob>()

function failAll(reason: Error): void {
  const jobs = [...pending.values()]
  pending.clear()
  for (const job of jobs) {
    job.cleanup()
    job.reject(reason)
  }
  if (worker) {
    worker.terminate()
    worker = null
  }
}

function handleMessage(message: BlindResponse): void {
  const job = pending.get(message.id)
  if (!job) return

  if (message.type === 'progress') {
    job.onProgress?.(message.progress)
    return
  }

  pending.delete(message.id)
  job.cleanup()

  if (message.type === 'error') {
    job.reject(new Error(message.message))
  } else if (message.type === 'embed-done') {
    job.resolve(message.image)
  } else {
    job.resolve(message.text)
  }
}

function ensureWorker(): Worker | null {
  if (workerUnavailable) return null
  if (worker) return worker
  if (typeof Worker === 'undefined') {
    workerUnavailable = true
    return null
  }

  try {
    const instance = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
    instance.onmessage = (event: MessageEvent<BlindResponse>) => handleMessage(event.data)
    instance.onerror = () => {
      // Worker 脚本加载/运行失败时不再尝试，后续任务自动回退主线程。
      workerUnavailable = true
      failAll(new Error('盲水印 Worker 运行失败'))
    }
    worker = instance
    return instance
  } catch {
    workerUnavailable = true
    return null
  }
}

/** 主线程回退路径：算法内部按行/列分片让出事件循环，UI 仍有响应。 */
async function runOnMainThread(
  request: BlindRequest,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<ImageBuffer | string | null> {
  const algorithm = await import('./algorithm.js')
  return request.type === 'embed'
    ? algorithm.embed(request.image, request.text, request.strength, onProgress, signal)
    : algorithm.extract(request.image, onProgress, signal)
}

function dispatch(
  request: BlindRequest,
  options: BlindJobOptions,
): Promise<ImageBuffer | string | null> {
  return new Promise((resolve, reject) => {
    if (options.signal?.aborted) {
      reject(new BlindCancelledError())
      return
    }

    const instance = ensureWorker()
    if (!instance) {
      runOnMainThread(request, options.onProgress, options.signal).then(resolve, reject)
      return
    }

    const onAbort = () => {
      if (!pending.delete(request.id)) return
      // FFT 计算一旦开始无法从外部打断，终止 Worker 是唯一可靠的即时取消手段。
      // 同一时间只允许一个盲水印任务（UI 层保证），因此不会误伤其他任务。
      instance.terminate()
      if (worker === instance) worker = null
      reject(new BlindCancelledError())
    }

    pending.set(request.id, {
      resolve,
      reject,
      onProgress: options.onProgress,
      cleanup: () => options.signal?.removeEventListener('abort', onAbort),
    })
    options.signal?.addEventListener('abort', onAbort, { once: true })

    // 转移所有权：调用方在任务开始后不得再使用该缓冲区（调用点均为一次性数据）。
    instance.postMessage(request, [request.image.data.buffer as ArrayBuffer])
  })
}

async function embedBlind(
  image: ImageBuffer,
  text: string,
  strength: number,
  options: BlindJobOptions = {},
): Promise<ImageBuffer> {
  const result = await dispatch(
    { id: ++nextId, type: 'embed', image, text, strength },
    options,
  )
  return result as ImageBuffer
}

async function extractBlind(
  image: ImageBuffer,
  options: BlindJobOptions = {},
): Promise<string | null> {
  const result = await dispatch({ id: ++nextId, type: 'extract', image }, options)
  return result as string | null
}

export { embedBlind, extractBlind }
