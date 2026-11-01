<script setup lang="ts">
import { useId } from 'vue'

defineProps<{
  label: string
  hint?: string
}>()

const id = useId()
</script>

<template>
  <div>
    <div class="mb-1.5 flex items-center justify-between gap-2">
      <label :for="id" class="text-xs font-medium tracking-wide text-muted">{{ label }}</label>
      <slot name="aside" />
    </div>
    <slot :id="id" />
    <p v-if="hint" class="mt-1 text-[11px] leading-relaxed text-faint">{{ hint }}</p>
  </div>
</template>
