import { create } from 'zustand'
import type { QueueJob, QueueSnapshot, QuotaPause } from '@shared/queue'
import i18n from '@renderer/i18n'
import { toast } from './toast'
import { useWs } from './workspace'

interface QueueStore {
  snap: QueueSnapshot | null
  quota: QuotaPause | null
  quotaAt: number
  drawer: boolean
  init: () => () => void
  setDrawer: (open: boolean) => void
}

export const ACTIVE_STATUSES: QueueJob['status'][] = ['queued', 'running', 'processing', 'paused']

export function isActive(j: QueueJob): boolean {
  return ACTIVE_STATUSES.includes(j.status)
}

export function samePath(a: string, b: string): boolean {
  return a.replace(/[\\/]+$/, '').toLowerCase() === b.replace(/[\\/]+$/, '').toLowerCase()
}

export function projectName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path
}

let reloadTimer: ReturnType<typeof setTimeout> | null = null

function scheduleReload(projectPath: string): void {
  const p = useWs.getState().project
  if (!p || !samePath(p.dir, projectPath)) return
  if (reloadTimer) clearTimeout(reloadTimer)
  reloadTimer = setTimeout(() => {
    reloadTimer = null
    void useWs.getState().reloadProject()
  }, 500)
}

export const useQueue = create<QueueStore>()((set) => ({
  snap: null,
  quota: null,
  quotaAt: 0,
  drawer: false,
  init: () => {
    const g = window.gas
    const runs = new Map<string, Set<string>>()
    const track = (snap: QueueSnapshot, notify: boolean): void => {
      const active = new Set<string>()
      for (const j of snap.jobs) {
        if (!isActive(j)) continue
        const k = j.projectPath.toLowerCase()
        active.add(k)
        const run = runs.get(k)
        if (run) run.add(j.id)
        else runs.set(k, new Set([j.id]))
      }
      for (const [k, ids] of runs) {
        if (active.has(k)) continue
        runs.delete(k)
        if (!notify) continue
        const jobs = snap.jobs.filter((j) => ids.has(j.id))
        const job = jobs[0] ?? snap.jobs.find((j) => j.projectPath.toLowerCase() === k)
        const n = jobs.filter((j) => j.status === 'done' || j.status === 'qaWarn').length
        if (job && n > 0) toast(i18n.t('gen.toastDone', { count: n, name: projectName(job.projectPath) }), 'ok', 5000)
        if (job) scheduleReload(job.projectPath)
      }
    }
    void g.queue.snapshot().then((snap) => {
      track(snap, false)
      set({ snap, quota: snap.quota, quotaAt: Date.now() })
    })
    const offs = [
      g.queue.onChange((snap) => {
        track(snap, true)
        set({ snap, quota: snap.quota, quotaAt: Date.now() })
      }),
      g.queue.onQuota((quota) => set({ quota, quotaAt: Date.now() })),
      g.queue.onJob((e) => {
        if (e.type === 'finished') scheduleReload(e.job.projectPath)
      })
    ]
    return () => offs.forEach((off) => off())
  },
  setDrawer: (drawer) => set({ drawer })
}))
