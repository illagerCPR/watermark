<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import ViewTabs from '@/components/layout/ViewTabs.vue'
import { appBusy } from '@/composables/useAppLock'
import type { ThemeName } from '@/core/storage'
import type { ViewName } from '@/core/view'

defineProps<{
  view: ViewName
  theme: ThemeName
}>()

const emit = defineEmits<{
  'update:view': [value: ViewName]
  'toggle-theme': []
  'open-extract': []
  'open-panel': []
}>()
</script>

<template>
  <header class="shrink-0 border-b border-line bg-surface">
    <div class="flex h-14 items-center gap-3 px-3 sm:px-4">
      <div class="flex min-w-0 items-center gap-2.5">
        <span
          class="grid h-9 w-9 place-items-center rounded-xl bg-accent-soft text-accent ring-1 ring-inset ring-accent/25"
        >
          <AppIcon name="sparkles" :size="18" />
        </span>
        <div class="min-w-0">
          <h1 class="truncate text-[15px] leading-tight font-semibold">图片水印工具</h1>
          <p class="hidden truncate text-[11px] text-faint sm:block">
            可见平铺水印 + 频域盲水印 · 本地处理
          </p>
        </div>
      </div>

      <div class="hidden flex-1 justify-center lg:flex">
        <ViewTabs
          :model-value="view"
          @update:model-value="emit('update:view', $event)"
        />
      </div>

      <div class="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          class="btn btn-ghost btn-icon"
          :aria-label="theme === 'dark' ? '切换到浅色主题' : '切换到深色主题'"
          :title="theme === 'dark' ? '浅色主题' : '深色主题'"
          @click="emit('toggle-theme')"
        >
          <AppIcon :name="theme === 'dark' ? 'sun' : 'moon'" :size="17" />
        </button>

        <button
          type="button"
          class="btn btn-ghost"
          aria-label="提取盲水印"
          :disabled="appBusy"
          @click="emit('open-extract')"
        >
          <AppIcon name="eye" :size="16" />
          <span class="hidden sm:inline">提取盲水印</span>
        </button>

        <button
          type="button"
          class="btn btn-ghost btn-icon lg:hidden"
          aria-label="打开参数面板"
          @click="emit('open-panel')"
        >
          <AppIcon name="sliders" :size="17" />
        </button>
      </div>
    </div>

    <div class="px-3 pb-2 lg:hidden">
      <ViewTabs
        class="w-full"
        :model-value="view"
        @update:model-value="emit('update:view', $event)"
      />
    </div>
  </header>
</template>
