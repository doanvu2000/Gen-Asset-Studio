import { create } from 'zustand'
import type { SpineAssets, SpineImportResult, SpineProjectView, SpineRegionPatch, SpineRig } from '@shared/spine'
import type { SpriteStyle } from '@shared/sprite'
import i18n from '@renderer/i18n'
import { toast } from './toast'

interface SpineStore {
  rel: string | null
  view: SpineProjectView | null
  loading: boolean
  busy: boolean
  importError: string | null
  step: number
  stepDir: 1 | -1
  orig: SpineAssets | null
  next: SpineAssets | null
  nextSig: string
  load: (rel: string) => Promise<void>
  reset: () => void
  refresh: () => Promise<void>
  setStep: (n: number) => void
  importFrom: (paths: string[] | null) => Promise<boolean>
  clear: () => Promise<void>
  loadAssets: (force?: boolean) => Promise<void>
  setStyle: (patch: Partial<SpriteStyle>) => Promise<boolean>
  addRefs: () => Promise<void>
  enqueue: (keys: string[], note?: string) => Promise<number>
  review: (patch: Record<string, SpineRegionPatch>) => Promise<void>
  setRig: (rig: SpineRig) => void
  flushRig: () => Promise<void>
}

export function regionSig(view: SpineProjectView | null): string {
  if (!view) return ''
  return view.regions.map((r) => `${r.key}:${r.selected}`).join('|')
}

let rigTimer: ReturnType<typeof setTimeout> | null = null
let rigPending: { rel: string; rig: SpineRig } | null = null

async function persistRig(): Promise<void> {
  if (rigTimer) clearTimeout(rigTimer)
  rigTimer = null
  const job = rigPending
  rigPending = null
  if (!job) return
  const view = await window.gas.spine.setRig(job.rel, job.rig).catch(() => null)
  if (!view) toast(i18n.t('spineProject.toast.saveFailed'), 'err')
}

export function importErrorText(code: string | null): string {
  if (!code) return ''
  const [k, ...rest] = code.split(':')
  const detail = rest.join(':')
  const known = ['skel', 'version', 'noAtlas', 'noPage', 'parse', 'noSkeleton'] as const
  type K = (typeof known)[number]
  return (known as readonly string[]).includes(k) ? i18n.t(`spineProject.import.err.${k as K}`, { detail }) : code
}

export const useSpine = create<SpineStore>()((set, get) => ({
  rel: null,
  view: null,
  loading: false,
  busy: false,
  importError: null,
  step: 1,
  stepDir: 1,
  orig: null,
  next: null,
  nextSig: '',
  load: async (rel) => {
    const same = get().rel === rel && get().view
    set({ rel, loading: !same, ...(same ? {} : { view: null, step: 1, orig: null, next: null, nextSig: '', importError: null }) })
    const view = await window.gas.spine.open(rel)
    if (get().rel !== rel) return
    set({ view, loading: false })
    if (view?.loaded) void get().loadAssets()
  },
  reset: () => {
    void persistRig()
    set({ rel: null, view: null, step: 1, loading: false, orig: null, next: null, nextSig: '', importError: null })
  },
  refresh: async () => {
    const rel = get().rel
    if (!rel) return
    const view = await window.gas.spine.open(rel)
    if (!view || get().rel !== rel) return
    set({ view })
    if (view.loaded) void get().loadAssets()
  },
  setStep: (step) => set({ step, stepDir: step >= get().step ? 1 : -1 }),
  importFrom: async (paths) => {
    const rel = get().rel
    if (!rel || get().busy) return false
    set({ busy: true, importError: null })
    try {
      const r: SpineImportResult = paths ? await window.gas.spine.importPaths(rel, paths) : await window.gas.spine.importDialog(rel)
      if (r.canceled || get().rel !== rel) return false
      if (r.error || !r.view) {
        set({ importError: r.error ?? 'parse' })
        return false
      }
      set({ view: r.view, orig: null, next: null, nextSig: '' })
      toast(i18n.t('spineProject.toast.imported', { name: r.view.skeletonName ?? '' }))
      void get().loadAssets(true)
      return true
    } catch {
      toast(i18n.t('toast.failed'), 'err')
      return false
    } finally {
      set({ busy: false })
    }
  },
  clear: async () => {
    const rel = get().rel
    if (!rel) return
    const view = await window.gas.spine.clear(rel)
    if (view && get().rel === rel) set({ view, orig: null, next: null, nextSig: '', step: 1 })
  },
  loadAssets: async (force) => {
    const rel = get().rel
    const view = get().view
    if (!rel || !view?.loaded) return
    const sig = regionSig(view)
    const needOrig = force || !get().orig
    const needNext = force || !get().next || sig !== get().nextSig
    if (!needOrig && !needNext) return
    const [orig, next] = await Promise.all([needOrig ? window.gas.spine.assets(rel, 'orig') : Promise.resolve(get().orig), needNext ? window.gas.spine.assets(rel, 'new') : Promise.resolve(get().next)])
    if (get().rel !== rel) return
    set({ orig, next, nextSig: sig })
  },
  setStyle: async (patch) => {
    const rel = get().rel
    const cur = get().view
    if (!rel || !cur) return false
    set({ view: { ...cur, style: { ...cur.style, ...patch } } })
    const view = await window.gas.spine.setStyle(rel, patch)
    if (!view) {
      toast(i18n.t('spineProject.toast.saveFailed'), 'err')
      return false
    }
    if (get().rel === rel) set({ view })
    return true
  },
  addRefs: async () => {
    const rel = get().rel
    if (!rel) return
    const view = await window.gas.spine.addRefs(rel)
    if (view && get().rel === rel) set({ view })
  },
  enqueue: async (keys, note) => {
    const rel = get().rel
    if (!rel || !keys.length) return 0
    const n = await window.gas.spine.enqueue(rel, keys, note)
    if (n < 0) toast(i18n.t('spineProject.toast.styleFirst'), 'warn')
    else if (n === 0) toast(i18n.t('spineProject.toast.nothingQueued'), 'info')
    else toast(i18n.t('spineProject.toast.queued', { count: n }))
    return n
  },
  review: async (patch) => {
    const rel = get().rel
    const cur = get().view
    if (!rel || !cur) return
    set({
      view: {
        ...cur,
        regions: cur.regions.map((r) => {
          const p = patch[r.key]
          if (!p) return r
          return { ...r, ...(p.decision !== undefined ? { decision: p.decision } : {}), ...(p.selected ? { selected: p.selected } : {}) }
        })
      }
    })
    const view = await window.gas.spine.review(rel, patch)
    if (!view || get().rel !== rel) return
    set({ view })
    void get().loadAssets()
  },
  setRig: (rig) => {
    const rel = get().rel
    const cur = get().view
    if (!rel || !cur) return
    set({ view: { ...cur, rig } })
    rigPending = { rel, rig }
    if (rigTimer) clearTimeout(rigTimer)
    rigTimer = setTimeout(() => void persistRig(), 400)
  },
  flushRig: () => persistRig()
}))
