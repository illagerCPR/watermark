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
