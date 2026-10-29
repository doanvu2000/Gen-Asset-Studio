import { create } from 'zustand'
import type { AddResult, FolderNode, OpResult, ProjectView, SkippedFile, WorkspaceSnapshot } from '@shared/workspace'
import type { StyleGroup } from '@shared/style'
import i18n from '@renderer/i18n'
import { useApp } from './app'
import { toast } from './toast'

export type WsDialog =
  | { kind: 'newProject'; parent: string }
  | { kind: 'newFolder'; parent: string }
  | { kind: 'trash'; rel: string; name: string; project: boolean; count: number }
  | null

export type SortKey = 'recent' | 'name' | 'images'

interface WsStore {
  snap: WorkspaceSnapshot | null
  curFolder: string
  curProject: string | null
  project: ProjectView | null
  loading: boolean
  step: number
  stepDir: 1 | -1
  expanded: Record<string, boolean>
  renaming: string | null
  dialog: WsDialog
  search: string
  sort: SortKey
  busy: boolean
  sampleBusy: boolean
  createSample: () => Promise<void>
  skipped: SkippedFile[]
  inputSel: string[]
  activeGroup: string | null
  setInputSel: (ids: string[]) => void
  setActiveGroup: (id: string | null) => void
  updateGroups: (fn: (groups: StyleGroup[]) => StyleGroup[], immediate?: boolean) => void
  flushGroups: () => Promise<void>
  clearSkipped: () => void
  init: () => () => void
  openFolder: (rel: string) => void
  openProject: (rel: string) => Promise<void>
  closeProject: () => void
  reloadProject: () => Promise<void>
  setProject: (view: ProjectView | null) => void
  setStep: (step: number) => void
  toggle: (rel: string, open?: boolean) => void
  setRenaming: (rel: string | null) => void
  setDialog: (d: WsDialog) => void
  setSearch: (q: string) => void
  setSort: (s: SortKey) => void
  createFolder: (parent: string, name: string) => Promise<OpResult>
  createProject: (parent: string, name: string) => Promise<OpResult>
  rename: (rel: string, name: string) => Promise<void>
  move: (rel: string, dest: string) => Promise<void>
  trash: (rel: string, name: string) => Promise<void>
  addResult: (r: AddResult) => void
  runAdd: (fn: () => Promise<AddResult>) => Promise<void>
  applyMove: (from: string, to: string) => void
}

export function errorText(r: OpResult): string {
  const key = r.error ?? 'io'
  return i18n.t(`errors.${key}`) + (key === 'io' && r.detail ? ` (${r.detail})` : '')
}

export function findNode(node: FolderNode | null, rel: string): FolderNode | null {
  if (!node) return null
  if (node.rel === rel) return node
  for (const c of node.children) {
    const r = findNode(c, rel)
    if (r) return r
  }
  return null
}

function remap(rel: string, from: string, to: string): string {
  if (rel === from) return to
  if (rel.startsWith(`${from}/`)) return to + rel.slice(from.length)
  return rel
}

function baseName(rel: string): string {
  return rel.split('/').pop() ?? rel
}

function parentsOf(rel: string): string[] {
  const parts = rel.split('/')
  return parts.slice(0, -1).map((_, i) => parts.slice(0, i + 1).join('/'))
}

let groupTimer: ReturnType<typeof setTimeout> | null = null
let groupPending: { rel: string; groups: StyleGroup[] } | null = null

async function persistGroups(): Promise<void> {
  if (groupTimer) {
    clearTimeout(groupTimer)
    groupTimer = null
  }
  const job = groupPending
  groupPending = null
  if (!job) return
  const saved = await window.gas.project.setGroups(job.rel, job.groups).catch(() => null)
  if (!saved) toast(i18n.t('style.saveFailed'), 'err')
}

export const useWs = create<WsStore>()((set, get) => ({
  snap: null,
  curFolder: '',
  curProject: null,
  project: null,
  loading: false,
  step: 1,
  stepDir: 1,
  expanded: {},
  renaming: null,
  dialog: null,
  search: '',
  sort: 'recent',
  busy: false,
  sampleBusy: false,
  skipped: [],
  inputSel: [],
  activeGroup: null,
  setInputSel: (inputSel) => set({ inputSel }),
  setActiveGroup: (activeGroup) => set({ activeGroup }),
  updateGroups: (fn, immediate) => {
    const { project, curProject } = get()
    if (!project || !curProject) return
    const groups = fn(project.groups)
    set({ project: { ...project, groups, groupCount: groups.length } })
    groupPending = { rel: curProject, groups }
    if (groupTimer) clearTimeout(groupTimer)
    if (immediate) void persistGroups()
    else groupTimer = setTimeout(() => void persistGroups(), 450)
  },
  flushGroups: () => persistGroups(),
  clearSkipped: () => set({ skipped: [] }),
  init: () => {
    void window.gas.workspace.get().then((snap) => set({ snap }))
    const off = window.gas.workspace.onChange((snap) => {
      const { curFolder, curProject } = get()
      const patch: Partial<WsStore> = { snap }
      if (curFolder && !findNode(snap.tree, curFolder)) patch.curFolder = ''
      set(patch)
      if (curProject && !snap.projects.some((p) => p.rel === curProject) && useApp.getState().route === 'project') {
        get().closeProject()
      }
    })
    return off
  },
  openFolder: (rel) => {
    const expanded = { ...get().expanded }
    for (const p of parentsOf(rel)) expanded[p] = true
    set({ curFolder: rel, expanded, search: '' })
    if (useApp.getState().route !== 'workspace') useApp.getState().navigate('workspace')
  },
  openProject: async (rel) => {
    const expanded = { ...get().expanded }
    for (const p of parentsOf(rel)) expanded[p] = true
    const same = get().curProject === rel && get().project
    await persistGroups()
    set({ curProject: rel, expanded, loading: !same, ...(same ? {} : { project: null, step: 1, skipped: [], inputSel: [], activeGroup: null }) })
    useApp.getState().navigate('project')
    const view = await window.gas.project.open(rel)
    if (get().curProject !== rel) return
    set({ project: view, loading: false })
  },
  closeProject: () => {
    void persistGroups()
    set({ curProject: null, project: null })
    useApp.getState().navigate('workspace')
  },
  reloadProject: async () => {
    const rel = get().curProject
    if (!rel) return
    await persistGroups()
    const view = await window.gas.project.open(rel)
    if (get().curProject === rel) set({ project: view })
  },
  setProject: (project) =>
    set({ project: project && groupPending && groupPending.rel === get().curProject ? { ...project, groups: groupPending.groups } : project }),
  setStep: (step) => set({ step, stepDir: step >= get().step ? 1 : -1 }),
  toggle: (rel, open) => set({ expanded: { ...get().expanded, [rel]: open ?? !get().expanded[rel] } }),
  setRenaming: (renaming) => set({ renaming }),
  setDialog: (dialog) => set({ dialog }),
  setSearch: (search) => set({ search }),
  setSort: (sort) => set({ sort }),
  createFolder: async (parent, name) => {
    const r = await window.gas.workspace.createFolder(parent, name)
    if (r.ok && r.rel) {
      if (parent) get().toggle(parent, true)
      toast(i18n.t('toast.created', { name: baseName(r.rel) }))
    }
    return r
  },
  createSample: async () => {
    if (get().sampleBusy) return
    set({ sampleBusy: true })
    try {
      const r = await window.gas.workspace.createSample()
      if (r.ok && r.rel) {
        toast(i18n.t('coach.ui.sampleCreated', { name: r.name ?? baseName(r.rel), count: r.added }))
        await get().openProject(r.rel)
      } else {
        toast(i18n.t('coach.ui.sampleFailed', { error: r.error === 'noWorkspace' ? i18n.t('errors.noWorkspace') : (r.error ?? '') }), 'err')
      }
    } finally {
      set({ sampleBusy: false })
    }
  },
  createProject: async (parent, name) => {
    const r = await window.gas.workspace.createProject(parent, name)
    if (r.ok && r.rel) {
      toast(i18n.t('toast.created', { name: baseName(r.rel) }))
      await get().openProject(r.rel)
    }
    return r
  },
  rename: async (rel, name) => {
    set({ renaming: null })
    if (!name.trim() || name.trim() === baseName(rel)) return
    const r = await window.gas.workspace.rename(rel, name)
    if (!r.ok || !r.rel) {
      toast(errorText(r), 'err')
      return
    }
    get().applyMove(rel, r.rel)
    toast(i18n.t('toast.renamed', { name: baseName(r.rel) }))
  },
  move: async (rel, dest) => {
    const r = await window.gas.workspace.move(rel, dest)
    if (!r.ok || !r.rel) {
      toast(errorText(r), 'err')
      return
    }
    if (r.rel === rel) return
    get().applyMove(rel, r.rel)
    if (dest) get().toggle(dest, true)
    toast(i18n.t('toast.moved', { name: baseName(r.rel) }))
  },
  trash: async (rel, name) => {
    const r = await window.gas.workspace.trash(rel)
    if (!r.ok) {
      toast(errorText(r), 'err')
      return
    }
    const { curFolder, curProject } = get()
    if (curFolder === rel || curFolder.startsWith(`${rel}/`)) set({ curFolder: '' })
    if (curProject && (curProject === rel || curProject.startsWith(`${rel}/`))) get().closeProject()
    toast(i18n.t('toast.trashed', { name }))
  },
  addResult: (r) => {
    if (r.canceled) return
    const notPng = r.skipped.filter((s) => s.reason === 'notPng')
    set({ ...(r.view ? { project: r.view } : {}), skipped: notPng })
    const dup = r.skipped.filter((s) => s.reason === 'duplicate')
    const bad = r.skipped.filter((s) => s.reason === 'unreadable')
    const names = (list: typeof r.skipped): string =>
      list
        .slice(0, 3)
        .map((s) => s.name)
        .join(', ') + (list.length > 3 ? '…' : '')
    if (r.added) toast(i18n.t('toast.added', { count: r.added }))
    else if (!notPng.length && !bad.length) toast(dup.length ? i18n.t('toast.dup', { count: dup.length }) : i18n.t('toast.none'), 'info')
    if (notPng.length) toast(i18n.t('toast.skipped', { count: notPng.length, names: names(notPng) }), 'warn')
    if (bad.length) toast(i18n.t('toast.unreadable', { count: bad.length, names: names(bad) }), 'warn')
    if (r.added && dup.length) toast(i18n.t('toast.dup', { count: dup.length }), 'info')
  },
  runAdd: async (fn) => {
    if (get().busy) return
    set({ busy: true })
    try {
      get().addResult(await fn())
    } catch {
      toast(i18n.t('toast.failed'), 'err')
    } finally {
      set({ busy: false })
    }
  },
  applyMove: (from: string, to: string) => {
    const { curFolder, curProject, expanded } = get()
    const nextExpanded: Record<string, boolean> = {}
    for (const [k, v] of Object.entries(expanded)) nextExpanded[remap(k, from, to)] = v
    const nextProject = curProject ? remap(curProject, from, to) : null
    set({ curFolder: remap(curFolder, from, to), curProject: nextProject, expanded: nextExpanded })
    if (nextProject && nextProject !== curProject && useApp.getState().route === 'project') void get().reloadProject()
  }
}))
