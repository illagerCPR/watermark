<script setup lang="ts">
import { useId } from 'vue'

const props = defineProps<{
  modelValue: boolean
  label: string
  hint?: string
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
const id = useId()
</script>

<template>
  <div class="flex items-start justify-between gap-4">
    <div class="min-w-0">
      <label :for="id" class="block text-sm font-medium text-ink">{{ label }}</label>
      <p v-if="hint" class="mt-0.5 text-[11px] leading-relaxed text-faint">{{ hint }}</p>
    </div>
    <button
      :id="id"
      type="button"
      role="switch"
      :aria-checked="modelValue"
      :aria-label="label"
      :disabled="disabled"
      class="relative mt-0.5 h-6 w-11 shrink-0 rounded-full border transition-colors disabled:opacity-40"
      :class="modelValue ? 'border-accent bg-accent' : 'border-line bg-surface-3'"
      @click="emit('update:modelValue', !props.modelValue)"
    >
      <span
        class="absolute top-0.5 left-0.5 h-4.5 w-4.5 rounded-full bg-white shadow transition-transform"
        :class="modelValue ? 'translate-x-5' : 'translate-x-0'"
      />
    </button>
  </div>
</template>
