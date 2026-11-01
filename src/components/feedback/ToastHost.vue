<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import { dismissToast, useToasts, type ToastVariant } from '@/composables/useToasts'

const { toasts } = useToasts()

const ICON: Record<ToastVariant, 'check' | 'alert' | 'eye'> = {
  success: 'check',
  error: 'alert',
  info: 'eye',
}

const ICON_CLASS: Record<ToastVariant, string> = {
  success: 'text-success',
  error: 'text-danger',
  info: 'text-accent',
}
</script>

<template>
  <div
    class="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:px-6"
    role="status"
    aria-live="polite"
  >
    <TransitionGroup name="toast">
      <div
        v-for="toast in toasts"
        :key="toast.id"
        class="pointer-events-auto flex w-full max-w-sm items-start gap-2.5 rounded-xl border border-line bg-surface/95 p-3 text-sm text-ink shadow-lg backdrop-blur"
      >
        <AppIcon
          :name="ICON[toast.variant]"
          :size="16"
          class="mt-0.5 shrink-0"
          :class="ICON_CLASS[toast.variant]"
        />
        <p class="min-w-0 flex-1 leading-snug">{{ toast.message }}</p>
        <button
          type="button"
          class="shrink-0 rounded-md p-0.5 text-faint transition-colors hover:text-ink"
          aria-label="关闭提示"
          @click="dismissToast(toast.id)"
        >
          <AppIcon name="close" :size="14" />
        </button>
      </div>
    </TransitionGroup>
  </div>
</template>
