<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'

defineProps<{
  title: string
}>()
</script>

<template>
  <details open class="group border-b border-line last:border-b-0">
    <summary
      class="flex cursor-pointer list-none items-center justify-between gap-2 py-3 text-[13px] font-semibold text-ink [&::-webkit-details-marker]:hidden"
    >
      {{ title }}
      <AppIcon
        name="chevron"
        :size="16"
        class="text-faint transition-transform duration-200 group-open:rotate-180"
      />
    </summary>
    <div class="space-y-4 pb-4">
      <slot />
    </div>
  </details>
</template>
