import { useEffect } from 'react'
import { create } from 'zustand'
import type { TodoArea, TodoItem, TodoTarget } from '@shared/workspace'
import { useApp } from './app'
import { useQueue } from './queue'
import { useSpine } from './spine'
import { useSprite } from './sprite'
import { useWs } from './workspace'

export type TodoFilter = TodoArea | 'all'

export interface TodoFocus {
  projectRel: string
  area: TodoArea
  target: TodoTarget
}

interface TodoStore {
  items: TodoItem[]
  loaded: boolean
  filter: TodoFilter
  focus: TodoFocus | null
  clearFocus: () => void
  setFilter: (f: TodoFilter) => void
  refresh: () => Promise<void>
  init: () => () => void
  open: (item: TodoItem) => Promise<void>
}

const REFRESH_MS = 600
const FOCUS_TTL_MS = 5000

function queueSig(): string {
  const jobs = useQueue.getState().snap?.jobs ?? []
  let done = 0
  let error = 0
  for (const j of jobs) {
    if (j.status === 'done' || j.status === 'qaWarn') done++
    else if (j.status === 'error') error++
  }
  return `${done}|${error}`
}

function whenLoaded(ready: () => boolean): Promise<boolean> {
  return new Promise((resolve) => {
    if (ready()) return resolve(true)
    const subs = [useSprite.subscribe(check), useSpine.subscribe(check)]
    const timer = setTimeout(() => finish(false), 4000)
    function check(): void {
      if (ready()) finish(true)
    }
    function finish(ok: boolean): void {
      clearTimeout(timer)
      subs.forEach((off) => off())
      resolve(ok)
    }
  })
}

const REVIEW_STEP = { reskin: 4, sprite: 3, spine: 3 } as const
const EXPORT_STEP = { reskin: 5, sprite: 4, spine: 4 } as const
const GEN_STEP = { reskin: 3, sprite: 3, spine: 3 } as const

async function gotoStep(item: TodoItem): Promise<void> {
  const { kind, area, target, projectRel } = item
  const step = area === 'export' ? EXPORT_STEP[kind] : area === 'queue' ? GEN_STEP[kind] : REVIEW_STEP[kind]
  if (kind === 'reskin') {
    useWs.getState().setStep(step)
    return
  }
  if (kind === 'sprite') {
    if (!(await whenLoaded(() => useSprite.getState().rel === projectRel && !!useSprite.getState().view && !useSprite.getState().loading))) return
    const sheetId = target.stripKey?.split(':')[0]
    if (sheetId && useSprite.getState().view?.sheets.some((s) => s.id === sheetId)) useSprite.getState().pickSheet(sheetId)
    useSprite.getState().setStep(step)
    return
  }
  if (!(await whenLoaded(() => useSpine.getState().rel === projectRel && !!useSpine.getState().view && !useSpine.getState().loading))) return
  const want = target.variantId ?? ''
  const view = useSpine.getState().view
  if (area !== 'queue' && view && view.variant !== want && (!want || view.variants.some((v) => v.id === want))) await useSpine.getState().setVariant(want)
  useSpine.getState().setStep(step)
}

let timer: ReturnType<typeof setTimeout> | null = null
let focusTimer: ReturnType<typeof setTimeout> | null = null

export const useTodo = create<TodoStore>()((set, get) => ({
  items: [],
  loaded: false,
  filter: 'all',
  focus: null,
  clearFocus: () => {
    if (focusTimer) clearTimeout(focusTimer)
    focusTimer = null
    set({ focus: null })
  },
  setFilter: (filter) => set({ filter }),
  refresh: async () => {
    try {
      const items = await window.gas.workspace.todo()
      set({ items, loaded: true })
    } catch {
      set({ loaded: true })
    }
  },
  init: () => {
    const later = (): void => {
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void get().refresh()
      }, REFRESH_MS)
    }
    void get().refresh()
    let sig = queueSig()
    const offs = [
      window.gas.workspace.onChange(later),
      useQueue.subscribe(() => {
        const next = queueSig()
        if (next === sig) return
        sig = next
        later()
      }),
      useApp.subscribe((s, prev) => {
        if (s.route === 'todo' && prev.route !== 'todo') void get().refresh()
      })
    ]
    return () => {
      offs.forEach((off) => off())
      if (timer) clearTimeout(timer)
      timer = null
    }
  },
  open: async (item) => {
    await useWs.getState().openProject(item.projectRel)
    await gotoStep(item)
    if (item.area !== 'review' && item.area !== 'qa') return
    get().clearFocus()
    set({ focus: { projectRel: item.projectRel, area: item.area, target: item.target } })
    focusTimer = setTimeout(() => get().clearFocus(), FOCUS_TTL_MS)
  }
}))

export function todoBadge(items: TodoItem[]): number {
  return items.filter((i) => i.area !== 'qa').length
}

export function useTodoFocus(rel: string | null | undefined, apply: (f: TodoFocus) => boolean): void {
  const focus = useTodo((s) => s.focus)
  const clear = useTodo((s) => s.clearFocus)
  useEffect(() => {
    if (!focus || !rel || focus.projectRel !== rel) return
    if (apply(focus)) clear()
  })
}
