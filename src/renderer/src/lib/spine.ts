import type { QueueJob } from '@shared/queue'
import type { SpineProjectView, SpineRegionView } from '@shared/spine'
import { isActive, samePath } from '@renderer/store/queue'

export type RegionState = 'none' | 'queued' | 'running' | 'error' | 'done'

export function regionJob(view: SpineProjectView, r: SpineRegionView, jobs: QueueJob[]): QueueJob | null {
  let best: QueueJob | null = null
  for (const j of jobs) {
    if (j.assetRelPath !== r.assetRel || !samePath(j.projectPath, view.dir)) continue
    if (!best || j.createdAt > best.createdAt) best = j
  }
  return best
}

export function regionState(r: SpineRegionView, job: QueueJob | null): RegionState {
  if (job && isActive(job)) return job.status === 'queued' || job.status === 'paused' ? 'queued' : 'running'
  if (r.versions.length) return 'done'
  if (job && job.status === 'error') return 'error'
  return 'none'
}

export function regionQaFail(r: SpineRegionView): boolean {
  return !!r.qa && r.qa.checks.some((c) => c.status !== 'pass')
}
