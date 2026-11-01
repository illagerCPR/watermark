import type { ImageBuffer } from './types'

/** 主线程 → Worker 的任务消息。image.data 的 buffer 通过 Transferable 转移。 */
export type BlindRequest =
  | { id: number; type: 'embed'; image: ImageBuffer; text: string; strength: number }
  | { id: number; type: 'extract'; image: ImageBuffer }

/** Worker → 主线程的进度与结果消息。 */
export type BlindResponse =
  | { id: number; type: 'progress'; progress: number }
  | { id: number; type: 'embed-done'; image: ImageBuffer }
  | { id: number; type: 'extract-done'; text: string | null }
  | { id: number; type: 'error'; message: string }
