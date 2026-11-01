<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'

import AppIcon from '@/components/ui/AppIcon.vue'
import { extractBlind } from '@/core/blind/client'
import { BLIND_MIN_SIZE } from '@/core/constants'
import { isImageFile, loadImageFile, toImageData } from '@/core/image'
import { errorMessage, isAbortError } from '@/core/utils'
import { appBusy, beginAppTask } from '@/composables/useAppLock'
import { pushToast } from '@/composables/useToasts'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{ close: [] }>()

type Stage = 'idle' | 'processing' | 'success' | 'not-found' | 'error'

const stage = ref<Stage>('idle')
const message = ref('')
const result = ref('')
const progress = ref(0)
const elapsed = ref(0)
const dragging = ref(false)

const dialogRef = ref<HTMLElement | null>(null)
const fileInputRef = ref<HTMLInputElement | null>(null)

let abortController: AbortController | null = null
let elapsedTimer: ReturnType<typeof setInterval> | undefined
let lastFocused: HTMLElement | null = null
let dragDepth = 0

const percentage = computed(() => Math.round(progress.value * 100))

function reset(): void {
  stage.value = 'idle'
  message.value = ''
  result.value = ''
  progress.value = 0
  elapsed.value = 0
  dragging.value = false
  dragDepth = 0
}

function startTimer(): void {
  stopTimer()
  elapsed.value = 0
  elapsedTimer = setInterval(() => {
    elapsed.value += 0.1
  }, 100)
}

function stopTimer(): void {
  if (elapsedTimer) {
    clearInterval(elapsedTimer)
    elapsedTimer = undefined
  }
}

function openPicker(): void {
  if (stage.value === 'processing') return
  fileInputRef.value?.click()
}

function onInputChange(event: Event): void {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  void handleFile(file)
}

async function handleFile(file: File | null | undefined): Promise<void> {
  if (!file) return
  if (!isImageFile(file)) {
    pushToast('请选择图片文件', 'error')
    return
  }
  if (appBusy.value) {
    pushToast('已有处理任务在进行，请稍候', 'info')
    return
  }

  reset()
  stage.value = 'processing'
  startTimer()

  const controller = new AbortController()
  abortController = controller
  const releaseTask = beginAppTask()

  try {
    const image = await loadImageFile(file)
    if (image.width < BLIND_MIN_SIZE || image.height < BLIND_MIN_SIZE) {
      stage.value = 'error'
      message.value = `图片尺寸过小（任一边小于 ${BLIND_MIN_SIZE} 像素），无法提取盲水印。`
      return
    }

    const imageData = toImageData(image.source, image.width, image.height)
    const text = await extractBlind(
      { width: imageData.width, height: imageData.height, data: imageData.data },
      {
        signal: controller.signal,
        onProgress: (value) => {
          progress.value = value
        },
      },
    )

    if (text === null) {
      stage.value = 'not-found'
      message.value = '未检测到盲水印：图片可能没有嵌入，或已被裁剪、强压缩破坏。'
    } else {
      stage.value = 'success'
      result.value = text
    }
  } catch (error) {
    if (isAbortError(error)) {
      stage.value = 'idle'
      message.value = '已取消提取'
    } else {
      stage.value = 'error'
      message.value = errorMessage(error)
    }
  } finally {
    stopTimer()
    abortController = null
    releaseTask()
  }
}

function cancel(): void {
  abortController?.abort()
}

async function copyResult(): Promise<void> {
  try {
    await navigator.clipboard.writeText(result.value)
    pushToast('已复制到剪贴板', 'success')
  } catch {
    pushToast('复制失败，请手动选择文本复制', 'error')
  }
}

function requestClose(): void {
  abortController?.abort()
  emit('close')
}

function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.stopPropagation()
    requestClose()
    return
  }
  if (event.key !== 'Tab') return

  const nodes = dialogRef.value?.querySelectorAll<HTMLElement>(
    'button:not([disabled]), input:not([disabled]), select, textarea, [tabindex]:not([tabindex="-1"])',
  )
  if (!nodes || nodes.length === 0) return

  const first = nodes[0]
  const last = nodes[nodes.length - 1]
  if (!first || !last) return

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault()
    last.focus()
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault()
    first.focus()
  }
}

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
  void handleFile(event.dataTransfer?.files?.[0])
}

watch(
  () => props.open,
  async (open) => {
    if (open) {
      reset()
      lastFocused = document.activeElement as HTMLElement | null
      await nextTick()
      dialogRef.value?.focus()
    } else {
      stopTimer()
      abortController?.abort()
      lastFocused?.focus()
      lastFocused = null
    }
  },
)

onBeforeUnmount(() => {
  stopTimer()
  abortController?.abort()
})
</script>

<template>
  <Teleport to="body">
    <Transition name="fade">
      <div
        v-if="open"
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 backdrop-blur-sm sm:p-4"
        @click.self="requestClose"
      >
        <div
          ref="dialogRef"
          role="dialog"
          aria-modal="true"
          aria-labelledby="extract-title"
          tabindex="-1"
          class="flex max-h-[90dvh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl outline-none"
          @keydown="onKeydown"
        >
          <header class="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <h2 id="extract-title" class="flex items-center gap-2 text-sm font-semibold text-ink">
              <AppIcon name="eye" :size="16" class="text-accent" />
              提取盲水印
            </h2>
            <button
              type="button"
              class="btn btn-ghost btn-icon"
              aria-label="关闭对话框"
              @click="requestClose"
            >
              <AppIcon name="close" :size="16" />
            </button>
          </header>

          <div class="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            <input
              ref="fileInputRef"
              type="file"
              accept="image/*"
              class="hidden"
              @change="onInputChange"
            />

            <div
              v-if="stage === 'idle'"
              class="flex cursor-pointer flex-col items-center gap-3 rounded-xl border-2 border-dashed border-line-strong px-5 py-10 text-center transition-colors"
              :class="dragging ? 'border-accent bg-accent-soft text-accent' : 'text-muted'"
              @click="openPicker"
              @dragenter="onDragEnter"
              @dragover="onDragOver"
              @dragleave="onDragLeave"
              @drop="onDrop"
            >
              <span class="grid h-12 w-12 place-items-center rounded-xl bg-surface-2">
                <AppIcon name="upload" :size="22" />
              </span>
              <p class="text-sm font-medium">选择或拖入含水印的图片</p>
              <p class="text-xs leading-relaxed text-faint">
                支持 PNG / JPG，图片任一边需不小于 {{ BLIND_MIN_SIZE }} 像素。<br />
                盲水印由频域嵌入，正常预览下不可见。
              </p>
              <button type="button" class="btn btn-primary mt-1" @click.stop="openPicker">
                选择图片
              </button>
            </div>

            <div v-else-if="stage === 'processing'" class="space-y-4 py-2">
              <div class="flex items-center justify-between text-xs text-muted">
                <span class="flex items-center gap-2">
                  <span class="inline-block h-2 w-2 animate-pulse rounded-full bg-accent" />
                  正在扫描频域水印…
                </span>
                <span class="font-mono">
                  {{ percentage }}% · {{ elapsed.toFixed(1) }}s
                </span>
              </div>
              <div class="h-1.5 overflow-hidden rounded-full bg-surface-3">
                <div
                  class="h-full bg-accent transition-[width] duration-150"
                  :style="{ width: `${percentage}%` }"
                />
              </div>
              <p class="text-xs leading-relaxed text-faint">
                图片未嵌入水印时需要扫描全部窗口，可能耗时较久；可随时取消。
              </p>
              <div class="flex justify-end">
                <button type="button" class="btn btn-ghost" @click="cancel">取消</button>
              </div>
            </div>

            <div v-else-if="stage === 'success'" class="space-y-3">
              <div class="flex items-center gap-2 text-sm font-medium text-success">
                <AppIcon name="check" :size="16" />
                提取成功
              </div>
              <textarea
                :value="result"
                readonly
                rows="3"
                spellcheck="false"
                class="field resize-y font-mono text-[13px]"
              />
              <div class="flex justify-end gap-2">
                <button type="button" class="btn btn-ghost" @click="copyResult">
                  <AppIcon name="copy" :size="15" />
                  复制文本
                </button>
                <button type="button" class="btn btn-primary" @click="openPicker">
                  提取另一张
                </button>
              </div>
            </div>

            <div v-else class="space-y-3 py-2">
              <div
                class="flex items-start gap-2 rounded-xl border px-3 py-2.5 text-sm"
                :class="
                  stage === 'not-found'
                    ? 'border-warning/30 bg-warning/10 text-warning'
                    : 'border-danger/30 bg-danger/10 text-danger'
                "
              >
                <AppIcon name="alert" :size="16" class="mt-0.5 shrink-0" />
                <p class="leading-relaxed">{{ message }}</p>
              </div>
              <div class="flex justify-end">
                <button type="button" class="btn btn-primary" @click="openPicker">
                  换一张图片
                </button>
              </div>
            </div>
          </div>

          <footer class="flex items-center justify-between gap-2 border-t border-line px-4 py-3">
            <p class="text-[11px] text-faint">全部在本地解析，图片不会上传</p>
            <button type="button" class="btn btn-ghost" @click="requestClose">关闭</button>
          </footer>
        </div>
      </div>
    </Transition>
  </Teleport>
</template>
