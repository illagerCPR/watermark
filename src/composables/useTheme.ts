import { ref, watchEffect } from 'vue'

import { loadStoredTheme, saveStoredTheme, type ThemeName } from '@/core/storage'

const theme = ref<ThemeName>(loadStoredTheme() ?? 'dark')

const THEME_COLOR: Record<ThemeName, string> = {
  dark: '#0f1115',
  light: '#f2f5fa',
}

watchEffect(() => {
  document.documentElement.dataset.theme = theme.value
  saveStoredTheme(theme.value)
  const meta = document.querySelector('meta[name="theme-color"]')
  if (meta) meta.setAttribute('content', THEME_COLOR[theme.value])
})

function toggleTheme(): void {
  theme.value = theme.value === 'dark' ? 'light' : 'dark'
}

export function useTheme(): {
  theme: typeof theme
  toggleTheme: () => void
} {
  return { theme, toggleTheme }
}
