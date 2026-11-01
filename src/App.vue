<script setup lang="ts">
import { ref } from 'vue'

import AppHeader from '@/components/layout/AppHeader.vue'
import ExtractDialog from '@/components/layout/ExtractDialog.vue'
import ParamPanel from '@/components/layout/ParamPanel.vue'
import ToastHost from '@/components/feedback/ToastHost.vue'
import BatchView from '@/components/views/BatchView.vue'
import SingleView from '@/components/views/SingleView.vue'
import { useTheme } from '@/composables/useTheme'
import type { ViewName } from '@/core/view'

const { theme, toggleTheme } = useTheme()

const view = ref<ViewName>('single')
const extractOpen = ref(false)
const panelOpen = ref(false)
</script>

<template>
  <div class="flex h-dvh flex-col overflow-hidden bg-app text-ink">
    <AppHeader
      :view="view"
      :theme="theme"
      @update:view="view = $event"
      @toggle-theme="toggleTheme"
      @open-extract="extractOpen = true"
      @open-panel="panelOpen = true"
    />

    <main class="flex min-h-0 flex-1">
      <div class="flex min-w-0 flex-1">
        <SingleView v-show="view === 'single'" />
        <BatchView v-show="view === 'batch'" />
      </div>
      <div class="hidden h-full lg:flex">
        <ParamPanel />
      </div>
    </main>

    <ExtractDialog :open="extractOpen" @close="extractOpen = false" />
    <ToastHost />

    <Teleport to="body">
      <Transition name="fade">
        <div
          v-if="panelOpen"
          class="fixed inset-0 z-40 flex flex-col bg-black/50 lg:hidden"
          @click.self="panelOpen = false"
        >
          <div class="mt-auto flex h-[86dvh] flex-col overflow-hidden rounded-t-2xl">
            <ParamPanel
              sheet
              dismissible
              class="rounded-t-2xl"
              @close="panelOpen = false"
            />
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>
