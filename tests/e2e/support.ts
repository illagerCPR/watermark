import { test, type Page } from '@playwright/test'
import { fileURLToPath } from 'node:url'

/** 测试图片的绝对路径（tests/fixtures 下）。 */
export function fixture(name: string): string {
  return fileURLToPath(new URL(`../fixtures/${name}`, import.meta.url))
}

/** 等待下载事件，把文件保存到测试输出目录并返回路径与文件名。 */
export async function saveDownload(
  page: Page,
  trigger: () => Promise<unknown>,
): Promise<{ path: string; name: string }> {
  const [download] = await Promise.all([page.waitForEvent('download'), trigger()])
  const name = download.suggestedFilename()
  const path = test.info().outputPath(name)
  await download.saveAs(path)
  return { path, name }
}

/**
 * 用假句柄替掉浏览器的保存对话框：写入的字节在 close() 时合成 Blob 并触发下载，
 * 这样 Playwright 仍能拿到真实的 ZIP 字节，而不会被原生弹窗卡住。
 */
export async function stubFileSystemAccess(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const saveFilePicker = async (options?: SaveFilePickerOptions) => {
      let chunks: Uint8Array[] = []
      return {
        kind: 'file',
        name: options?.suggestedName ?? 'stub.zip',
        async createWritable() {
          chunks = []
          return {
            async write(chunk: Uint8Array) {
              chunks.push(new Uint8Array(chunk))
            },
            async close() {
              const blob = new Blob(chunks as BlobPart[], { type: 'application/zip' })
              const url = URL.createObjectURL(blob)
              const link = document.createElement('a')
              link.href = url
              link.download = options?.suggestedName ?? 'stub.zip'
              document.body.appendChild(link)
              link.click()
              link.remove()
              setTimeout(() => URL.revokeObjectURL(url), 1000)
            },
            async abort() {
              chunks = []
            },
          }
        },
      }
    }
    window.showSaveFilePicker = saveFilePicker as unknown as NonNullable<
      Window['showSaveFilePicker']
    >
  })
}

/** 模拟不支持 File System Access 的浏览器（Firefox / Safari）。 */
export async function disableFileSystemAccess(page: Page): Promise<void> {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', {
      value: undefined,
      configurable: true,
      writable: true,
    })
  })
}

/** 模拟用户在保存对话框里点“取消”。 */
export async function cancelFileSystemAccess(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const saveFilePicker = async () => {
      throw new DOMException('用户取消', 'AbortError')
    }
    window.showSaveFilePicker = saveFilePicker as unknown as NonNullable<
      Window['showSaveFilePicker']
    >
  })
}
