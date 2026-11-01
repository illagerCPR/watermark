/** 盲水印算法与 Worker 共享的纯数据缓冲区（不依赖 DOM，可在 Node 中测试）。 */
export interface ImageBuffer {
  width: number
  height: number
  /** 使用 ArrayBuffer 而非 ArrayBufferLike，便于直接构造 ImageData。 */
  data: Uint8ClampedArray<ArrayBuffer>
}
