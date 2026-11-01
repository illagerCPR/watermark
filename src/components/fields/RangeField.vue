<script setup lang="ts">
import { computed, useId } from 'vue'

import type { NumberLimit } from '@/core/constants'
import { clampNumber } from '@/core/params'

const props = defineProps<{
  modelValue: number
  limit: NumberLimit
  label: string
  format?: (value: number) => string
}>()

const emit = defineEmits<{ 'update:modelValue': [value: number] }>()
const id = useId()

const display = computed(() =>
  props.format ? props.format(props.modelValue) : String(props.modelValue),
)

function commit(raw: string): void {
  const numeric = Number.parseFloat(raw)
  if (!Number.isFinite(numeric)) return
  emit('update:modelValue', clampNumber(numeric, props.limit))
}

function resetDisplay(event: FocusEvent): void {
  const input = event.target as HTMLInputElement
  input.value = String(props.modelValue)
}
</script>

<template>
  <div>
    <div class="mb-1.5 flex items-baseline justify-between gap-2">
      <label :for="id" class="text-xs font-medium tracking-wide text-muted">{{ label }}</label>
      <span class="font-mono text-[11px] text-faint">{{ display }}</span>
    </div>
    <div class="flex items-center gap-2.5">
      <input
        :id="id"
        type="range"
        class="h-1.5 min-w-0 flex-1 cursor-pointer"
        :min="limit.min"
        :max="limit.max"
        :step="limit.step"
        :value="modelValue"
        @input="commit(($event.target as HTMLInputElement).value)"
      />
      <input
        type="number"
        class="field w-[76px] shrink-0 px-2 py-1 text-right font-mono text-xs"
        :min="limit.min"
        :max="limit.max"
        :step="limit.step"
        :value="modelValue"
        :aria-label="`${label}数值`"
        @change="commit(($event.target as HTMLInputElement).value)"
        @blur="resetDisplay"
      />
    </div>
  </div>
</template>
