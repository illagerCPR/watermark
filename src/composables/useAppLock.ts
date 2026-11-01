import { computed, ref } from 'vue'

/**
 * 全局任务锁：盲水印的 Worker 同一时刻只应执行一个任务。
 * 单图导出、批量导出、提取三处共享这一把锁，避免并发任务在取消时互相终止。
 */
const holders = ref(0)

export const appBusy = computed(() => holders.value > 0)

export function beginAppTask(): () => void {
  holders.value += 1
  let released = false
  return () => {
    if (released) return
    released = true
    holders.value = Math.max(0, holders.value - 1)
  }
}
