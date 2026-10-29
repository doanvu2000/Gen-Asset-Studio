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
    const activeByProject = new Map<string, number>()
    const track = (snap: QueueSnapshot, notify: boolean): void => {
      const counts = new Map<string, number>()
      const done = new Map<string, number>()
      for (const j of snap.jobs) {
        const k = j.projectPath.toLowerCase()
        if (isActive(j)) counts.set(k, (counts.get(k) ?? 0) + 1)
        else if (j.status === 'done' || j.status === 'qaWarn') done.set(k, (done.get(k) ?? 0) + 1)
      }
      if (notify) {
        for (const [k, prev] of activeByProject) {
          if (prev > 0 && !counts.get(k)) {
            const job = snap.jobs.find((j) => j.projectPath.toLowerCase() === k)
            const n = done.get(k) ?? 0
            if (job && n > 0) toast(i18n.t('gen.toastDone', { count: n, name: projectName(job.projectPath) }), 'ok', 5000)
            if (job) scheduleReload(job.projectPath)
          }
        }
      }
      activeByProject.clear()
      for (const [k, v] of counts) activeByProject.set(k, v)
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
