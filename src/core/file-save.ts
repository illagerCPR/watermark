export type SaveFilePickResult =
  | { status: 'picked'; handle: FileSystemFileHandle }
  | { status: 'unsupported' }
  | { status: 'cancelled' }
  | { status: 'failed'; error: unknown }

/** 浏览器是否支持把文件直接写到用户选定的位置（Chromium 系）。 */
export function isStreamingSaveSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.showSaveFilePicker === 'function'
}

/**
 * 弹出保存对话框选择 ZIP 的落盘位置。
 *
 * 必须在用户手势（点击）的同步调用栈里发起，否则浏览器会以安全原因拒绝。
 * 用户取消与「浏览器不支持」需要区分：前者应当中止导出，后者走内存回退。
 */
export async function pickZipFile(suggestedName: string): Promise<SaveFilePickResult> {
  const picker = window.showSaveFilePicker
  if (!picker) return { status: 'unsupported' }

  try {
    const handle = await picker.call(window, {
      suggestedName,
      types: [{ description: 'ZIP 压缩包', accept: { 'application/zip': ['.zip'] } }],
    })
    return { status: 'picked', handle }
  } catch (error) {
    return isAbort(error) ? { status: 'cancelled' } : { status: 'failed', error }
  }
}

function isAbort(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    (error as { name?: unknown }).name === 'AbortError'
  )
}
