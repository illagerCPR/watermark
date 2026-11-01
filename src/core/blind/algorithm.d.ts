import type { ImageBuffer } from './types'

/**
 * 盲水印核心算法（由旧版 blind.js 逐行迁移）。
 *
 * 与旧实现的差异仅限：
 * - 入参/返回改为纯数据缓冲 ImageBuffer（不再依赖 ImageData 构造器）；
 * - 增加可选的 AbortSignal 取消检查；
 * - 改为 ES 模块导出。
 *
 * 像素级算法保持不变，tests/parity 下有与旧实现的逐像素对拍测试。
 */
export declare function embed(
  image: ImageBuffer,
  text: string,
  strength: number,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<ImageBuffer>

export declare function extract(
  image: ImageBuffer,
  onProgress?: (progress: number) => void,
  signal?: AbortSignal,
): Promise<string | null>

/** 盲水印文本的最大 UTF-8 字节数（帧编码上限）。 */
export declare const MAX_PAYLOAD: number
