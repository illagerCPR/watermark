import { fileURLToPath, URL } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import vue from '@vitejs/plugin-vue'
import { defineConfig } from 'vite'

// 生产构建与 preview 都部署在 GitHub Pages 的项目路径下（自定义域 + /watermark/），
// 开发服务器走根路径；preview 必须与服务端 base 一致，否则资源会被 SPA 回退成 HTML。
const BASE_PATH = '/watermark/'

export default defineConfig(({ command, isPreview }) => ({
  base: command === 'build' || isPreview ? BASE_PATH : '/',
  plugins: [vue(), tailwindcss()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  worker: {
    format: 'es',
  },
  build: {
    target: 'es2022',
  },
}))
