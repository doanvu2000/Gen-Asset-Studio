import { create } from 'zustand'

export type ToastKind = 'ok' | 'info' | 'warn' | 'err'

export interface ToastItem {
  id: number
  text: string
  kind: ToastKind
}

interface ToastStore {
  items: ToastItem[]
  push: (text: string, kind?: ToastKind, ms?: number) => void
  dismiss: (id: number) => void
}

let seq = 0

export const useToast = create<ToastStore>()((set, get) => ({
  items: [],
  push: (text, kind = 'ok', ms) => {
    const id = ++seq
    set({ items: [...get().items.slice(-3), { id, text, kind }] })
    setTimeout(() => get().dismiss(id), ms ?? (kind === 'err' || kind === 'warn' ? 6000 : 3200))
  },
  dismiss: (id) => set({ items: get().items.filter((t) => t.id !== id) })
}))

export function toast(text: string, kind?: ToastKind, ms?: number): void {
  useToast.getState().push(text, kind, ms)
}
