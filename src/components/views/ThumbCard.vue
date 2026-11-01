<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'

import AppIcon from '@/components/ui/AppIcon.vue'
import { BLIND_MIN_SIZE } from '@/core/constants'
import { visibleSignature } from '@/core/params'
import { renderWatermark } from '@/core/render/watermark'
import type { BatchItem, WatermarkParams } from '@/core/types'

const props = defineProps<{
  item: BatchItem
  params: WatermarkParams
  result?: 'done' | 'skipped' | 'failed'
}>()

const emit = defineEmits<{ remove: [] }>()

const canvasRef = ref<HTMLCanvasElement | null>(null)
let timer: ReturnType<typeof setTimeout> | undefined

const THUMB_WIDTH = 320
const THUMB_HEIGHT = 240

const blindWillSkip = computed(
  () =>
    props.params.blindEnabled &&
    (props.item.width < BLIND_MIN_SIZE || props.item.height < BLIND_MIN_SIZE),
)

function draw(): void {
  const canvas = canvasRef.value
  if (!canvas) return
  const context = canvas.getContext('2d')
  if (!context) return

  const { width, height } = props.item
  const scale = Math.min(THUMB_WIDTH / width, THUMB_HEIGHT / height)
  const targetWidth = Math.max(1, Math.round(width * scale))
  const targetHeight = Math.max(1, Math.round(height * scale))

  renderWatermark(
    context,
    { source: props.item.source, width, height },
    props.params,
    { width: targetWidth, height: targetHeight, scale },
  )
}

function scheduleDraw(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(draw, 120)
}

watch(() => visibleSignature(props.params), scheduleDraw)
onMounted(draw)
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>

<template>
  <div
    class="group relative overflow-hidden rounded-xl border border-line bg-surface-2 transition-colors hover:border-line-strong"
  >
    <div class="grid aspect-[4/3] place-items-center overflow-hidden bg-canvas p-1.5">
      <canvas ref="canvasRef" class="block max-h-full max-w-full rounded-[4px]" />
    </div>

    <div class="flex items-center gap-2 px-2.5 py-2">
      <div class="min-w-0 flex-1">
        <p class="truncate text-xs text-ink" :title="item.name">{{ item.name }}</p>
        <p class="mt-0.5 font-mono text-[10px] text-faint">
          {{ item.width }}×{{ item.height }}
        </p>
      </div>

      <span v-if="result === 'done'" class="badge shrink-0 bg-success/15 text-success">
        <AppIcon name="check" :size="11" />
        完成
      </span>
      <span v-else-if="result === 'skipped'" class="badge shrink-0 bg-warning/15 text-warning">
        跳过
      </span>
      <span v-else-if="result === 'failed'" class="badge shrink-0 bg-danger/15 text-danger">
        失败
      </span>
    </div>

    <span
      v-if="blindWillSkip"
      class="badge absolute top-1.5 left-1.5 bg-warning/90 text-black"
      title="盲水印要求任一边不小于 256 像素"
    >
      尺寸过小
    </span>

    <button
      type="button"
      class="absolute top-1.5 right-1.5 grid h-6 w-6 place-items-center rounded-full bg-black/55 text-white opacity-100 transition-opacity hover:bg-danger sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100"
      :aria-label="`移除 ${item.name}`"
      @click="emit('remove')"
    >
      <AppIcon name="close" :size="13" />
    </button>
  </div>
</template>
