import { ref } from 'vue'

export type ToastVariant = 'info' | 'success' | 'error'

export interface ToastItem {
  id: number
  message: string
  variant: ToastVariant
}

const MAX_TOASTS = 4

const toasts = ref<ToastItem[]>([])
const timers = new Map<number, ReturnType<typeof setTimeout>>()
let nextId = 0

export function dismissToast(id: number): void {
  const timer = timers.get(id)
  if (timer) {
    clearTimeout(timer)
    timers.delete(id)
  }
  toasts.value = toasts.value.filter((toast) => toast.id !== id)
}

export function pushToast(message: string, variant: ToastVariant = 'info', duration = 4200): number {
  const id = ++nextId
  toasts.value = [...toasts.value.slice(-(MAX_TOASTS - 1)), { id, message, variant }]
  if (duration > 0) {
    timers.set(
      id,
      setTimeout(() => dismissToast(id), duration),
    )
  }
  return id
}

export function useToasts(): {
  toasts: typeof toasts
  pushToast: typeof pushToast
  dismissToast: typeof dismissToast
} {
  return { toasts, pushToast, dismissToast }
}
