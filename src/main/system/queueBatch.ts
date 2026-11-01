import type { JobStatus } from '@shared/queue'

type Mark = 'active' | 'done' | 'failed'

export interface BatchJobView {
  id: string
  status: JobStatus
}

export interface BatchState {
  total: number
  done: number
  failed: number
  active: number
}

export interface BatchUpdate {
  state: BatchState | null
  ended: { done: number; failed: number } | null
}

const ACTIVE: readonly JobStatus[] = ['queued', 'running', 'processing']

export class BatchTracker {
  private marks = new Map<string, Mark>()

  update(jobs: readonly BatchJobView[]): BatchUpdate {
    const byId = new Map(jobs.map((j) => [j.id, j.status]))
    for (const [id, mark] of this.marks) {
      const s = byId.get(id)
      if (s === undefined || s === 'canceled' || s === 'paused') this.marks.delete(id)
      else if (s === 'done' || s === 'qaWarn') this.marks.set(id, 'done')
      else if (s === 'error') this.marks.set(id, 'failed')
      else if (mark !== 'active' && ACTIVE.includes(s)) this.marks.set(id, 'active')
    }
    for (const j of jobs) {
      if (ACTIVE.includes(j.status)) this.marks.set(j.id, 'active')
    }
    if (this.marks.size === 0) return { state: null, ended: null }
    const state: BatchState = { total: this.marks.size, done: 0, failed: 0, active: 0 }
    for (const m of this.marks.values()) state[m === 'active' ? 'active' : m]++
    if (state.active > 0) return { state, ended: null }
    this.marks.clear()
    return { state: null, ended: { done: state.done, failed: state.failed } }
  }
}
