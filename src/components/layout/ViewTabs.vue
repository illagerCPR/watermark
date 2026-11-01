<script setup lang="ts">
import type { ViewName } from '@/core/view'

defineProps<{ modelValue: ViewName }>()
const emit = defineEmits<{ 'update:modelValue': [value: ViewName] }>()

const TABS: { value: ViewName; label: string }[] = [
  { value: 'single', label: '单图' },
  { value: 'batch', label: '批量' },
]
</script>

<template>
  <div
    class="inline-flex rounded-lg border border-line bg-surface-2 p-0.5"
    role="tablist"
    aria-label="视图切换"
  >
    <button
      v-for="tab in TABS"
      :key="tab.value"
      type="button"
      role="tab"
      :aria-selected="modelValue === tab.value"
      class="flex-1 rounded-[6px] px-4 py-1.5 text-xs font-medium transition-colors"
      :class="
        modelValue === tab.value
          ? 'bg-surface text-ink shadow-sm'
          : 'text-muted hover:text-ink'
      "
      @click="emit('update:modelValue', tab.value)"
    >
      {{ tab.label }}
    </button>
  </div>
</template>
