import { create } from 'zustand'
import type { SheetPatch, SpriteAddResult, SpriteProjectView, SpriteSettings, SpriteStripPatch, SpriteStyle } from '@shared/sprite'
import i18n from '@renderer/i18n'
import { toast } from './toast'

interface SpriteStore {
  rel: string | null
  view: SpriteProjectView | null
  loading: boolean
  busy: boolean
  detecting: boolean
  sheetId: string | null
  step: number
  stepDir: 1 | -1
  load: (rel: string) => Promise<void>
  reset: () => void
  setStep: (n: number) => void
  pickSheet: (id: string | null) => void
  add: (paths: string[] | null) => Promise<void>
  remove: (id: string) => Promise<void>
  update: (id: string, patch: SheetPatch) => Promise<void>
  detect: (id: string) => Promise<void>
  setSettings: (patch: Partial<SpriteSettings>) => Promise<void>
  refresh: () => Promise<void>
  setStyle: (patch: Partial<SpriteStyle>) => Promise<boolean>
  addRefs: () => Promise<void>
  setLock: (key: string | null) => Promise<void>
  enqueue: (keys: string[], note?: string) => Promise<number>
  review: (patch: Record<string, SpriteStripPatch>) => Promise<void>
}

function names(list: SpriteAddResult['skipped']): string {
  return (
    list
      .slice(0, 3)
      .map((s) => s.name)
      .join(', ') + (list.length > 3 ? '…' : '')
  )
}

let animTimer: ReturnType<typeof setTimeout> | null = null
let animPending: { rel: string; id: string; patch: SheetPatch } | null = null

async function flushAnims(): Promise<SpriteProjectView | null> {
  if (animTimer) clearTimeout(animTimer)
  animTimer = null
  const job = animPending
  animPending = null
  if (!job) return null
  return window.gas.sprite.updateSheet(job.rel, job.id, job.patch)
}

export const useSprite = create<SpriteStore>()((set, get) => ({
  rel: null,
  view: null,
  loading: false,
  busy: false,
  detecting: false,
  sheetId: null,
  step: 1,
  stepDir: 1,
  load: async (rel) => {
    const same = get().rel === rel && get().view
    set({ rel, loading: !same, ...(same ? {} : { view: null, sheetId: null, step: 1 }) })
    const view = await window.gas.sprite.open(rel)
    if (get().rel !== rel) return
    const keep = view?.sheets.some((s) => s.id === get().sheetId)
    set({ view, loading: false, sheetId: keep ? get().sheetId : (view?.sheets[0]?.id ?? null) })
  },
  reset: () => {
    void flushAnims()
    set({ rel: null, view: null, sheetId: null, step: 1, loading: false })
  },
  setStep: (step) => set({ step, stepDir: step >= get().step ? 1 : -1 }),
  pickSheet: (sheetId) => set({ sheetId }),
  add: async (paths) => {
    const rel = get().rel
    if (!rel || get().busy) return
    set({ busy: true })
    try {
      const r = paths ? await window.gas.sprite.addPaths(rel, paths) : await window.gas.sprite.addDialog(rel)
      if (r.canceled || get().rel !== rel) return
      const before = new Set(get().view?.sheets.map((s) => s.id) ?? [])
      if (r.view) {
        const fresh = r.view.sheets.find((s) => !before.has(s.id))
        set({ view: r.view, sheetId: fresh?.id ?? get().sheetId ?? r.view.sheets[0]?.id ?? null })
      }
      const dup = r.skipped.filter((s) => s.reason === 'duplicate')
      const bad = r.skipped.filter((s) => s.reason !== 'duplicate')
      if (r.added) toast(i18n.t('spriteProject.toast.added', { count: r.added }))
      else if (!bad.length) toast(dup.length ? i18n.t('spriteProject.toast.dup', { count: dup.length }) : i18n.t('spriteProject.toast.none'), 'info')
      if (bad.length) toast(i18n.t('spriteProject.toast.skipped', { count: bad.length, names: names(bad) }), 'warn')
    } catch {
      toast(i18n.t('toast.failed'), 'err')
    } finally {
      set({ busy: false })
    }
  },
  remove: async (id) => {
    const rel = get().rel
    if (!rel) return
    const view = await window.gas.sprite.remove(rel, id)
    if (!view || get().rel !== rel) return
    set({ view, sheetId: get().sheetId === id ? (view.sheets[0]?.id ?? null) : get().sheetId })
  },
  update: async (id, patch) => {
    const rel = get().rel
    const cur = get().view
    if (!rel || !cur) return
    if (patch.anims && !patch.grid && !patch.autoAnims) {
      set({ view: { ...cur, sheets: cur.sheets.map((s) => (s.id === id ? { ...s, anims: patch.anims ?? s.anims } : s)) } })
      if (animPending && (animPending.rel !== rel || animPending.id !== id)) await flushAnims()
      animPending = { rel, id, patch }
      if (animTimer) clearTimeout(animTimer)
      animTimer = setTimeout(() => void flushAnims(), 400)
      return
    }
    await flushAnims()
    const view = await window.gas.sprite.updateSheet(rel, id, patch)
    if (view && get().rel === rel) set({ view })
  },
  detect: async (id) => {
    const rel = get().rel
    if (!rel || get().detecting) return
    set({ detecting: true })
    try {
      const grid = await window.gas.sprite.detectGrid(rel, id)
      if (!grid) {
        toast(i18n.t('spriteProject.toast.noGrid'), 'warn')
        return
      }
      await get().update(id, { grid, autoAnims: true })
      toast(i18n.t('spriteProject.toast.grid', { cols: grid.cols, rows: grid.rows, w: grid.cellW, h: grid.cellH }))
    } finally {
      set({ detecting: false })
    }
  },
  setSettings: async (patch) => {
    const rel = get().rel
    const cur = get().view
    if (!rel || !cur) return
    set({ view: { ...cur, settings: { ...cur.settings, ...patch } } })
    const view = await window.gas.sprite.setSettings(rel, patch)
    if (view && get().rel === rel) set({ view })
  },
  refresh: async () => {
    const rel = get().rel
    if (!rel) return
    const view = await window.gas.sprite.open(rel)
    if (view && get().rel === rel) set({ view })
  },
  setStyle: async (patch) => {
    const rel = get().rel
    const cur = get().view
    if (!rel || !cur) return false
    set({ view: { ...cur, style: { ...cur.style, ...patch } } })
    const view = await window.gas.spriteGen.setStyle(rel, patch)
    if (!view) {
      toast(i18n.t('spriteProject.toast.saveFailed'), 'err')
      return false
    }
    if (get().rel === rel) set({ view })
    return true
  },
  addRefs: async () => {
    const rel = get().rel
    if (!rel) return
    const view = await window.gas.spriteGen.addRefs(rel)
    if (view && get().rel === rel) set({ view })
  },
  setLock: async (key) => {
    const rel = get().rel
    if (!rel) return
    const view = await window.gas.spriteGen.setLock(rel, key)
    if (view && get().rel === rel) set({ view })
  },
  enqueue: async (keys, note) => {
    const rel = get().rel
    if (!rel || !keys.length) return 0
    const n = await window.gas.spriteGen.enqueue(rel, keys, note)
    if (n < 0) toast(i18n.t('spriteProject.toast.styleFirst'), 'warn')
    else if (n === 0) toast(i18n.t('spriteProject.toast.nothingQueued'), 'info')
    else toast(i18n.t('spriteProject.toast.queued', { count: n }))
    return n
  },
  review: async (patch) => {
    const rel = get().rel
    const cur = get().view
    if (!rel || !cur) return
    set({
      view: {
        ...cur,
        strips: cur.strips.map((st) => {
          const p = patch[st.key]
          if (!p) return st
          return { ...st, ...(p.decision !== undefined ? { decision: p.decision } : {}), ...(p.selected ? { selected: p.selected } : {}) }
        })
      }
    })
    const view = await window.gas.spriteGen.review(rel, patch)
    if (view && get().rel === rel) set({ view })
  }
}))
