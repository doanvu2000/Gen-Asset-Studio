import type { QueueJob } from '@shared/queue'
import type { SpriteProjectView, StripView } from '@shared/sprite'
import { isActive, samePath } from '@renderer/store/queue'

export type StripState = 'mirror' | 'none' | 'queued' | 'running' | 'error' | 'done'

export function jobOf(view: SpriteProjectView, strip: StripView, jobs: QueueJob[]): QueueJob | null {
  let best: QueueJob | null = null
  for (const j of jobs) {
    if (j.assetRelPath !== strip.assetRel || !samePath(j.projectPath, view.dir)) continue
    if (!best || j.createdAt > best.createdAt) best = j
  }
  return best
}

export function stripState(strip: StripView, job: QueueJob | null): StripState {
  if (strip.mirrorOf) return 'mirror'
  if (job && isActive(job)) return job.status === 'queued' || job.status === 'paused' ? 'queued' : 'running'
  if (strip.versions.length) return 'done'
  if (job && job.status === 'error') return 'error'
  return 'none'
}

export function qaFail(strip: StripView): boolean {
  return !!strip.qa && strip.qa.checks.some((c) => c.status !== 'pass')
}

export function stripLabel(strip: StripView): string {
  return strip.dir ? `${strip.anim} · ${strip.dir}` : strip.anim
}

export function sourceOf(view: SpriteProjectView, strip: StripView): StripView {
  if (!strip.mirrorOf) return strip
  return view.strips.find((s) => s.key === strip.mirrorOf) ?? strip
}

export function effectiveUrl(view: SpriteProjectView, strip: StripView): string | null {
  return sourceOf(view, strip).url
}

export function isApproved(view: SpriteProjectView, strip: StripView): boolean {
  const src = sourceOf(view, strip)
  return src.decision === 'approved' && !!src.url
}

export function genTargets(view: SpriteProjectView): StripView[] {
  return view.strips.filter((s) => !s.mirrorOf)
}
