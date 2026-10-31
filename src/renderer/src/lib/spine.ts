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
  if (job && job.status === 'error') return 'error'
  return r.versions.length ? 'done' : 'none'
}

export function regionQaFail(r: SpineRegionView): boolean {
  return !!r.qa && r.qa.checks.some((c) => c.status !== 'pass')
}

export type RegionReviewState = Exclude<RegionState, 'done'> | 'pending' | 'approved' | 'rejected'

export function regionReviewState(r: SpineRegionView, job: QueueJob | null): RegionReviewState {
  const s = regionState(r, job)
  if (s !== 'done') return s
  return r.decision ?? 'pending'
}

export const SPINE_STEPS = ['import', 'style', 'gen', 'export'] as const
export type SpineStepKey = (typeof SPINE_STEPS)[number]
export type SpineLockKey = 'import' | 'style' | 'review'

export function rigEditCount(view: SpineProjectView): number {
  return Object.keys(view.rig.bones).length + Object.keys(view.rig.attachments).length
}

export function spineStepLock(view: SpineProjectView, n: number): SpineLockKey | null {
  if (n <= 1) return null
  if (!view.loaded) return 'import'
  if (n === 2) return null
  if (n === 3) return view.style.locked ? null : 'style'
  return view.regions.some((r) => r.decision === 'approved' && r.versions.length > 0) || rigEditCount(view) > 0 ? null : 'review'
}

export function firstOpenSpineStep(view: SpineProjectView): number {
  if (!view.loaded) return 1
  if (!view.style.locked) return 2
  const used = view.regions.filter((r) => r.used)
  const pool = used.length ? used : view.regions
  if (pool.some((r) => r.decision !== 'approved' || !r.versions.length)) return 3
  return spineStepLock(view, 4) ? 3 : 4
}
