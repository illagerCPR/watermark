<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import AppIcon from '@/components/ui/AppIcon.vue'
import { embedBlind } from '@/core/blind/client'
import { BLIND_MAX_BYTES, BLIND_MIN_SIZE } from '@/core/constants'
import { createCanvas, formatBytes, formatDimensions, isImageFile, loadImageFile } from '@/core/image'
import { blindTextByteLength, visibleSignature } from '@/core/params'
import { canvasToBlob, downloadBlob, exportFileName } from '@/core/render/export'
import { renderWatermark } from '@/core/render/watermark'
import type { LoadedImage } from '@/core/types'
import { errorMessage, isAbortError } from '@/core/utils'
import { appBusy, beginAppTask } from '@/composables/useAppLock'
import { useParams } from '@/composables/useParams'
import { pushToast } from '@/composables/useToasts'

const { params } = useParams()

const image = ref<LoadedImage | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

const loading = ref(false)
const dragging = ref(false)
const busy = ref(false)
const progress = ref(0)

let controller: AbortController | null = null
let renderTimer: ReturnType<typeof setTimeout> | undefined
let dragDepth = 0

const percentage = computed(() => Math.round(progress.value * 100))
const blindWillEmbed = computed(
  () => params.blindEnabled && params.blindText.trim().length > 0,
)

function openPicker(): void {
  if (busy.value || loading.value) return
  fileInputRef.value?.click()
}

function onInputChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  void selectFile(file)
}

async function selectFile(file: File | null | undefined): Promise<void> {
  if (!file) return
  if (busy.value) return
  if (!isImageFile(file)) {
    pushToast('请选择图片文件（JPG / PNG / WebP）', 'error')
    return
  }

  loading.value = true
  try {
    image.value = await loadImageFile(file)
    await nextTick()
    renderPreview()
  } catch (error) {
    pushToast(errorMessage(error), 'error')
  } finally {
    loading.value = false
  }
}

function renderPreview(): void {
  const loaded = image.value
  const canvas = canvasRef.value
  if (!loaded || !canvas) return
  const context = canvas.getContext('2d')
  if (!context) return
  renderWatermark(
    context,
    { source: loaded.source, width: loaded.width, height: loaded.height },
    params,
  )
}

function scheduleRender(): void {
  if (renderTimer) clearTimeout(renderTimer)
  renderTimer = setTimeout(renderPreview, 80)
}

watch(() => visibleSignature(params), scheduleRender)

function onDragEnter(event: DragEvent): void {
  event.preventDefault()
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
  if (busy.value) return
  void selectFile(event.dataTransfer?.files?.[0])
}

async function download(): Promise<void> {
  const loaded = image.value
  const canvas = canvasRef.value
  if (!loaded || !canvas || busy.value) return
  if (appBusy.value) {
    pushToast('已有处理任务在进行，请稍候', 'info')
    return
  }

  const blindText = params.blindText.trim()
  const useBlind = params.blindEnabled && blindText.length > 0

  if (useBlind) {
    if (blindTextByteLength(blindText) > BLIND_MAX_BYTES) {
      pushToast('盲水印文本超过 200 字节，请缩短后再导出', 'error')
      return
    }
    if (loaded.width < BLIND_MIN_SIZE || loaded.height < BLIND_MIN_SIZE) {
      pushToast(`图片任一边小于 ${BLIND_MIN_SIZE} 像素，无法嵌入盲水印`, 'error')
      return
    }
  }

  if (!useBlind) {
    try {
      const blob = await canvasToBlob(canvas, params.format, params.quality)
      downloadBlob(blob, exportFileName(loaded.name, params.format))
      pushToast('已导出图片', 'success')
    } catch (error) {
      pushToast(errorMessage(error), 'error')
    }
    return
  }

  busy.value = true
  progress.value = 0
  controller = new AbortController()
  const releaseTask = beginAppTask()

  try {
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('当前浏览器不支持 Canvas 2D')
    const imageData = context.getImageData(0, 0, canvas.width, canvas.height)

    const output = await embedBlind(
      { width: imageData.width, height: imageData.height, data: imageData.data },
      blindText,
      params.blindStrength,
      {
        signal: controller.signal,
        onProgress: (value) => {
          progress.value = value
        },
      },
    )

    const { canvas: outputCanvas, context: outputContext } = createCanvas(
      output.width,
      output.height,
    )
    outputContext.putImageData(new ImageData(output.data, output.width, output.height), 0, 0)
    const blob = await canvasToBlob(outputCanvas, 'png', params.quality)
    downloadBlob(blob, exportFileName(loaded.name, 'png'))
    pushToast('已导出图片（含盲水印）', 'success')
  } catch (error) {
    if (isAbortError(error)) pushToast('已取消导出', 'info')
    else pushToast(errorMessage(error), 'error')
  } finally {
    busy.value = false
    controller = null
    releaseTask()
  }
}

function cancel(): void {
  controller?.abort()
}

onBeforeUnmount(() => {
  if (renderTimer) clearTimeout(renderTimer)
  controller?.abort()
})
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col" aria-label="单图模式">
    <div
      class="relative min-h-0 flex-1 overflow-auto p-3 transition-colors sm:p-5"
      :class="dragging ? 'bg-accent-soft' : ''"
      @dragenter="onDragEnter"
      @dragover="onDragOver"
      @dragleave="onDragLeave"
      @drop="onDrop"
    >
      <div class="flex h-full min-h-0 items-center justify-center">
        <canvas
          v-show="image"
          ref="canvasRef"
          class="block max-h-full max-w-full rounded-lg shadow-2xl ring-1 ring-black/20"
        />

        <button
          v-if="!image"
          type="button"
          class="flex w-full max-w-xl flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-line-strong bg-surface/40 px-6 py-14 text-center text-muted transition-colors hover:border-accent hover:text-accent"
          @click="openPicker"
        >
          <span class="grid h-14 w-14 place-items-center rounded-2xl bg-surface-2 text-current">
            <AppIcon name="image" :size="28" :stroke-width="1.5" />
          </span>
          <span class="text-base font-medium">点击选择图片，或拖拽到此处</span>
          <span class="text-xs leading-relaxed text-faint">
            支持 JPG / PNG / WebP · 所有处理均在本地完成，不会上传服务器
          </span>
        </button>
      </div>

      <div
        v-if="dragging"
        class="pointer-events-none absolute inset-3 grid place-items-center rounded-xl border-2 border-dashed border-accent bg-app/60 text-sm font-medium text-accent backdrop-blur-sm"
      >
        松开以载入图片
      </div>

      <div
        v-if="loading"
        class="absolute inset-0 grid place-items-center bg-app/60 text-sm text-muted backdrop-blur-sm"
      >
        正在加载图片…
      </div>
    </div>

    <footer class="shrink-0 border-t border-line bg-surface">
      <div v-if="busy" class="h-0.5 w-full bg-surface-3">
        <div
          class="h-full bg-accent transition-[width] duration-150"
          :style="{ width: `${percentage}%` }"
        />
      </div>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:px-4">
        <div class="min-w-0 flex-1">
          <p v-if="image" class="truncate text-sm text-ink" :title="image.name">
            {{ image.name }}
          </p>
          <p v-else class="text-sm text-muted">未选择图片</p>
          <p v-if="image" class="mt-0.5 font-mono text-[11px] text-faint">
            {{ formatDimensions(image.width, image.height) }} · {{ formatBytes(image.size) }}
            <span v-if="blindWillEmbed"> · 导出时嵌入盲水印</span>
          </p>
        </div>

        <button v-if="busy" type="button" class="btn btn-ghost" @click="cancel">取消</button>
        <button
          type="button"
          class="btn btn-ghost"
          :disabled="!image || busy"
          @click="openPicker"
        >
          更换图片
        </button>
        <button
          type="button"
          class="btn btn-primary"
          :disabled="!image || busy || loading || appBusy"
          @click="download"
        >
          <AppIcon name="download" :size="16" />
          {{ busy ? `嵌入中 ${percentage}%` : '下载图片' }}
        </button>
      </div>
    </footer>

    <input
      ref="fileInputRef"
      type="file"
      accept="image/*"
      class="hidden"
      @change="onInputChange"
    />
  </section>
</template>
