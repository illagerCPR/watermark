import { reactive, watch } from 'vue'

import { DEFAULT_PARAMS } from '@/core/params'
import { loadStoredParams, saveStoredParams } from '@/core/storage'
import type { WatermarkParams } from '@/core/types'

const stored = loadStoredParams()
const params = reactive<WatermarkParams>(stored ? { ...stored } : { ...DEFAULT_PARAMS })

// 开启盲水印时导出格式锁定 PNG（与旧版行为一致，参数面板里也会禁用格式选择）。
watch(
  () => params.blindEnabled,
  (enabled) => {
    if (enabled) params.format = 'png'
  },
)

let saveTimer: ReturnType<typeof setTimeout> | undefined
watch(
  params,
  () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => saveStoredParams({ ...params }), 250)
  },
  { deep: true },
)

function resetParams(): void {
  Object.assign(params, DEFAULT_PARAMS)
}

export function useParams(): { params: WatermarkParams; resetParams: () => void } {
  return { params, resetParams }
}
