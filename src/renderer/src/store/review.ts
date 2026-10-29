import { create } from 'zustand'
import type { RvFilter } from '@renderer/lib/review'

export type CompareMode = 'side' | 'slider' | 'toggle'
export type ZoomMode = 'fit' | 'one' | 'two'

interface ReviewStore {
  project: string | null
  filter: RvFilter
  group: string
  sel: string[]
  detail: string | null
  mode: CompareMode
  zoom: ZoomMode
  dark: boolean
  slider: number
  bind: (projectDir: string) => void
  setFilter: (f: RvFilter) => void
  setGroup: (g: string) => void
  setSel: (ids: string[]) => void
  toggleSel: (id: string) => void
  open: (id: string | null) => void
  setMode: (m: CompareMode) => void
  setZoom: (z: ZoomMode) => void
  setDark: (d: boolean) => void
  setSlider: (v: number) => void
}

export const useRv = create<ReviewStore>()((set, get) => ({
  project: null,
  filter: 'all',
  group: 'all',
  sel: [],
  detail: null,
  mode: 'slider',
  zoom: 'fit',
  dark: false,
  slider: 50,
  bind: (projectDir) => {
    if (get().project !== projectDir) set({ project: projectDir, filter: 'all', group: 'all', sel: [], detail: null })
  },
  setFilter: (filter) => set({ filter }),
  setGroup: (group) => set({ group }),
  setSel: (sel) => set({ sel }),
  toggleSel: (id) => {
    const sel = get().sel
    set({ sel: sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id] })
  },
  open: (detail) => set({ detail }),
  setMode: (mode) => set({ mode }),
  setZoom: (zoom) => set({ zoom }),
  setDark: (dark) => set({ dark }),
  setSlider: (slider) => set({ slider })
}))
