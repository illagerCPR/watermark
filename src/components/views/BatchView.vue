<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import AppIcon from '@/components/ui/AppIcon.vue'
import ThumbCard from '@/components/views/ThumbCard.vue'
import { embedBlind } from '@/core/blind/client'
import { BLIND_MAX_BYTES, BLIND_MIN_SIZE, MEMORY_ZIP_WARN_BYTES } from '@/core/constants'
import { isStreamingSaveSupported, pickZipFile } from '@/core/file-save'
import {
  createCanvas,
  formatBytes,
  isImageFile,
  loadImageFile,
} from '@/core/image'
import { blindTextByteLength } from '@/core/params'
import {
  canvasToBlob,
  downloadBlob,
  exportFileName,
  uniqueEntryName,
} from '@/core/render/export'
import { renderWatermark } from '@/core/render/watermark'
import type { BatchItem } from '@/core/types'
import { errorMessage, isAbortError, timestampForFileName } from '@/core/utils'
import { createFileSink, createMemorySink, ZipWriter } from '@/core/zip'
import { appBusy, beginAppTask } from '@/composables/useAppLock'
import { useParams } from '@/composables/useParams'
import { pushToast } from '@/composables/useToasts'

type ExportResult = 'done' | 'skipped' | 'failed'
type ExportPhase = 'idle' | 'render' | 'finalize'

const { params } = useParams()

const items = ref<BatchItem[]>([])
const results = ref<Record<number, ExportResult>>({})
const zipEnabled = ref(true)

const busy = ref(false)
const phase = ref<ExportPhase>('idle')
const progress = ref(0)
const currentIndex = ref(0)
const currentProgress = ref(0)
const dragging = ref(false)
const zipStreaming = ref(false)

const fileInputRef = ref<HTMLInputElement | null>(null)
let abortController: AbortController | null = null
let nextId = 0
let dragDepth = 0

const totalSize = computed(() => items.value.reduce((sum, item) => sum + item.size, 0))
const overallPercent = computed(() => {
  if (phase.value === 'finalize') return 100
  if (!busy.value) return 0
  const total = items.value.length || 1
  return Math.min(100, Math.round(((Math.max(0, currentIndex.value - 1) + currentProgress.value) / total) * 100))
})

const statusText = computed(() => {
  if (phase.value === 'finalize') return '正在生成 ZIP…'
  if (busy.value) {
    const embedding = params.blindEnabled && params.blindText.trim().length > 0
    const embedSuffix = embedding ? ` · 嵌入 ${Math.round(currentProgress.value * 100)}%` : ''
    const zipSuffix = zipStreaming.value ? ' · 写入 ZIP' : ''
    return `正在处理 ${currentIndex.value}/${items.value.length}${embedSuffix}${zipSuffix}`
  }
  if (!items.value.length) return '还没有添加图片'
  return `${items.value.length} 张待处理`
})

const blindWillEmbed = computed(
  () => params.blindEnabled && params.blindText.trim().length > 0,
)

const smallBlindCount = computed(
  () =>
    items.value.filter(
      (item) => item.width < BLIND_MIN_SIZE || item.height < BLIND_MIN_SIZE,
    ).length,
)

function openPicker(): void {
  if (busy.value) return
  fileInputRef.value?.click()
}

function onInputChange(event: Event): void {
  const input = event.target as HTMLInputElement
  // FileList 是活的：必须在清空 input 之前复制成普通数组。
  const files = Array.from(input.files ?? [])
  input.value = ''
  void addFiles(files)
}

async function addFiles(files: FileList | File[] | null | undefined): Promise<void> {
  if (!files || busy.value) return
  const list = Array.from(files).filter(isImageFile)
  if (!list.length) {
    pushToast('请选择图片文件（JPG / PNG / WebP）', 'error')
    return
  }

  let failed = 0
  for (const file of list) {
    try {
      const loaded = await loadImageFile(file)
      items.value = [...items.value, { ...loaded, id: ++nextId }]
    } catch {
      failed += 1
    }
  }
  if (failed > 0) pushToast(`${failed} 张图片加载失败`, 'error')
}

function removeItem(id: number): void {
  if (busy.value) return
  items.value = items.value.filter((item) => item.id !== id)
  delete results.value[id]
}

function clearAll(): void {
  if (busy.value) return
  items.value = []
  results.value = {}
}

function onDragEnter(event: DragEvent): void {
  event.preventDefault()
  if (busy.value) return
  dragDepth += 1
  dragging.value = true
}

function onDragOver(event: DragEvent): void {
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
}

function onDragLeave(event: DragEvent): void {
  event.preventDefault()
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) dragging.value = false
}

function onDrop(event: DragEvent): void {
  event.preventDefault()
  dragDepth = 0
  dragging.value = false
  void addFiles(event.dataTransfer?.files)
}

function cancel(): void {
  abortController?.abort()
}

async function exportAll(): Promise<void> {
  if (!items.value.length || busy.value) return
  if (appBusy.value) {
    pushToast('已有处理任务在进行，请稍候', 'info')
    return
  }

  const blindText = params.blindText.trim()
  const useBlind = params.blindEnabled && blindText.length > 0

  if (useBlind && blindTextByteLength(blindText) > BLIND_MAX_BYTES) {
    pushToast('盲水印文本超过 200 字节，请缩短后再导出', 'error')
    return
  }

  const total = items.value.length
  const zipMode = zipEnabled.value && total > 1
  const zipName = `watermarks_${timestampForFileName()}.zip`

  // 保存对话框必须在用户手势的同步调用栈里发起，因此放在任何 await 之前。
  let zipWriter: ZipWriter | null = null
  let memoryZip: ReturnType<typeof createMemorySink> | null = null

  if (zipMode) {
    let handle: FileSystemFileHandle | null = null

    if (isStreamingSaveSupported()) {
      const picked = await pickZipFile(zipName)
      if (picked.status === 'cancelled') {
        pushToast('已取消批量导出', 'info')
        return
      }
      if (picked.status === 'picked') {
        handle = picked.handle
      } else if (picked.status === 'failed') {
        pushToast(`无法写入所选位置，改为内存打包：${errorMessage(picked.error)}`, 'info')
      }
    }

    if (handle) {
      zipWriter = new ZipWriter(createFileSink(handle))
    } else {
      // 不支持流式落盘：仍然边处理边攒，只是最后统一下载。
      memoryZip = createMemorySink()
      zipWriter = new ZipWriter(memoryZip.sink)
      if (totalSize.value > MEMORY_ZIP_WARN_BYTES) {
        pushToast('浏览器不支持流式保存，图片较多时建议分批导出，避免占用过多内存', 'info')
      }
    }
  }

  const streaming = zipWriter !== null && memoryZip === null

  busy.value = true
  phase.value = 'render'
  zipStreaming.value = streaming
  results.value = {}
  progress.value = 0
  currentIndex.value = 0
  currentProgress.value = 0

  const controller = new AbortController()
  abortController = controller
  const releaseTask = beginAppTask()

  const { canvas, context } = createCanvas(1, 1, { willReadFrequently: true })
  const usedNames = new Set<string>()
  const skipped: string[] = []
  const failed: string[] = []
  let done = 0
  let written = 0
  let cancelled = false

  try {
    for (let index = 0; index < total; index += 1) {
      if (controller.signal.aborted) {
        cancelled = true
        break
      }

      const item = items.value[index]
      if (!item) continue
      currentIndex.value = index + 1
      currentProgress.value = 0

      let format = params.format
      let blob: Blob | null = null

      try {
        renderWatermark(context, item, params)

        if (useBlind) {
          if (item.width < BLIND_MIN_SIZE || item.height < BLIND_MIN_SIZE) {
            skipped.push(item.name)
            results.value[item.id] = 'skipped'
            continue
          }
          format = 'png'
          const imageData = context.getImageData(0, 0, item.width, item.height)
          const output = await embedBlind(
            { width: imageData.width, height: imageData.height, data: imageData.data },
            blindText,
            params.blindStrength,
            {
              signal: controller.signal,
              onProgress: (value) => {
                currentProgress.value = value
              },
            },
          )
          if (canvas.width !== output.width || canvas.height !== output.height) {
            canvas.width = output.width
            canvas.height = output.height
          }
          context.putImageData(
            new ImageData(output.data, output.width, output.height),
            0,
            0,
          )
        }

        blob = await canvasToBlob(canvas, format, params.quality)
      } catch (error) {
        if (isAbortError(error)) {
          cancelled = true
          break
        }
        failed.push(item.name)
        results.value[item.id] = 'failed'
        console.error('批量处理失败：', item.name, error)
        continue
      }

      if (!blob) continue

      if (zipWriter) {
        // 写盘失败（磁盘满、权限被收回）属于整体故障，直接中止整批。
        const entryName = uniqueEntryName(exportFileName(item.name, format), usedNames)
        await zipWriter.add(entryName, new Uint8Array(await blob.arrayBuffer()))
        written += 1
      } else {
        downloadBlob(blob, exportFileName(item.name, format))
      }

      results.value[item.id] = 'done'
      done += 1
      currentProgress.value = 0
      progress.value = (index + 1) / total
    }

    if (cancelled) {
      await zipWriter?.abort()
      pushToast('已取消批量导出', 'info')
      return
    }

    if (zipWriter) {
      if (written === 0) {
        await zipWriter.abort()
        pushToast('没有可导出的图片', 'error')
        return
      }
      // 内存回退路径要等中央目录与 Blob 生成；直接写盘时这一步几乎瞬时。
      phase.value = 'finalize'
      await zipWriter.finish()
      if (memoryZip) downloadBlob(memoryZip.toBlob(), zipName)
    }

    const summary = [`批量完成：${done}/${total} 张成功`]
    if (skipped.length > 0) summary.push(`${skipped.length} 张尺寸过小已跳过`)
    if (failed.length > 0) summary.push(`${failed.length} 张失败`)
    pushToast(summary.join('，'), failed.length > 0 || skipped.length > 0 ? 'info' : 'success')
  } catch (error) {
    await zipWriter?.abort(error)
    if (isAbortError(error)) pushToast('已取消批量导出', 'info')
    else pushToast(errorMessage(error), 'error')
  } finally {
    busy.value = false
    phase.value = 'idle'
    zipStreaming.value = false
    progress.value = 0
    currentIndex.value = 0
    currentProgress.value = 0
    abortController = null
    releaseTask()
  }
}

onBeforeUnmount(() => {
  abortController?.abort()
})
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col" aria-label="批量模式">
    <div
      class="relative min-h-0 flex-1 overflow-y-auto p-3 transition-colors sm:p-4"
      :class="dragging ? 'bg-accent-soft' : ''"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <div v-if="!items.length" class="flex h-full min-h-[300px] items-center justify-center">
        <button
          type="button"
          class="flex w-full max-w-xl flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-line-strong bg-surface/40 px-6 py-14 text-center text-muted transition-colors hover:border-accent hover:text-accent"
          @click="openPicker"
        >
          <span class="grid h-14 w-14 place-items-center rounded-2xl bg-surface-2">
            <AppIcon name="image" :size="28" :stroke-width="1.5" />
          </span>
          <span class="text-base font-medium">点击选择多张图片，或拖拽到此处</span>
          <span class="text-xs leading-relaxed text-faint">
            支持 JPG / PNG / WebP · 按当前参数统一加水印，可打包为 ZIP 下载
          </span>
        </button>
      </div>

      <template v-else>
        <button
          type="button"
          class="mb-3 flex w-full items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-3 text-sm text-muted transition-colors hover:border-accent hover:text-accent disabled:cursor-not-allowed disabled:opacity-50"
          :disabled="busy"
          @click="openPicker"
        >
          <AppIcon name="plus" :size="16" />
          添加图片（也可直接拖入）
        </button>

        <div
          class="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-3 pb-2 sm:grid-cols-[repeat(auto-fill,minmax(170px,1fr))]"
        >
          <ThumbCard
            v-for="item in items"
            :key="item.id"
            :item="item"
            :params="params"
            :result="results[item.id]"
            @remove="removeItem(item.id)"
          />
        </div>
      </template>

      <div
        v-if="dragging"
        class="pointer-events-none absolute inset-3 grid place-items-center rounded-xl border-2 border-dashed border-accent bg-app/60 text-sm font-medium text-accent backdrop-blur-sm"
      >
        松开以添加图片
      </div>
    </div>

    <footer class="shrink-0 border-t border-line bg-surface">
      <div v-if="busy" class="h-0.5 w-full bg-surface-3">
        <div
          class="h-full bg-accent transition-[width] duration-150"
          :style="{ width: `${overallPercent}%` }"
        />
      </div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4">
        <div class="min-w-0 flex-1">
          <p class="truncate text-sm text-ink">{{ statusText }}</p>
          <p class="mt-0.5 text-[11px] text-faint">
            <template v-if="items.length">{{ items.length }} 张 · {{ formatBytes(totalSize) }}</template>
            <template v-else>支持多选与拖拽</template>
            <span v-if="blindWillEmbed && smallBlindCount > 0" class="text-warning">
              · {{ smallBlindCount }} 张小于 256px 将被跳过
            </span>
            <span v-else-if="params.blindEnabled && !blindWillEmbed" class="text-warning">
              · 盲水印文本为空，将只导出可见水印
            </span>
          </p>
        </div>

        <label
          class="flex cursor-pointer items-center gap-1.5 text-xs text-muted"
          title="多张图片打包为一个 ZIP，避免浏览器拦截连续下载"
        >
          <input
            v-model="zipEnabled"
            type="checkbox"
            class="h-4 w-4 rounded border-line"
            :disabled="busy"
          />
          打包为 ZIP
        </label>

        <button v-if="busy" type="button" class="btn btn-ghost" @click="cancel">取消</button>
        <button
          v-if="!busy && items.length"
          type="button"
          class="btn btn-ghost"
          @click="clearAll"
        >
          清空
        </button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="!items.length || busy || appBusy"
          @click="exportAll"
        >
          <AppIcon name="download" :size="16" />
          {{ busy ? '处理中…' : '批量导出' }}
        </button>
      </div>
    </footer>

    <input
      ref="fileInputRef"
      type="file"
      accept="image/*"
      multiple
      class="hidden"
      @change="onInputChange"
    />
  </section>
</template>
