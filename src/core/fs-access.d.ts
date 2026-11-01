/**
 * File System Access API 中 TypeScript 5.9 的 lib.dom 尚未声明的部分。
 * `FileSystemFileHandle` / `FileSystemWritableFileStream` 已有官方定义，只需补保存对话框。
 */

interface SaveFilePickerOptions {
  suggestedName?: string
  types?: Array<{
    description?: string
    accept: Record<string, string[]>
  }>
  excludeAcceptAllOption?: boolean
  id?: string
}

interface Window {
  showSaveFilePicker?: (options?: SaveFilePickerOptions) => Promise<FileSystemFileHandle>
}
