import type { QueueJob } from '@shared/queue'
import type { SheetView, SpriteProjectView, SpriteSettings, StripView } from '@shared/sprite'
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

export type StripFilter = 'all' | 'pending' | 'approved' | 'rejected' | 'qa'

export function stripMatches(view: SpriteProjectView, strip: StripView, f: StripFilter): boolean {
  if (f === 'all') return true
  if (strip.mirrorOf) return f === 'approved' ? sourceOf(view, strip).decision === 'approved' : false
  if (f === 'pending') return !!strip.url && !strip.decision
  if (f === 'approved') return strip.decision === 'approved'
  if (f === 'rejected') return strip.decision === 'rejected'
  return qaFail(strip)
}

export function animRow(name: string): string {
  return name.replace(/[\s_.-]+(s|sw|w|nw|n|ne|e|se|south|north|east|west|down|up|left|right)$/i, '') || name
}

export function needsGridEdit(sheet: SheetView, settings: SpriteSettings): boolean {
  if (sheet.origin === 'new' || sheet.status === 'missing') return false
  return sheet.format === 'grid' || !sheet.anims.length || (settings.dirSet !== 0 && !sheet.anims.some((a) => a.dir))
}

export function firstOpenStep(view: SpriteProjectView): number {
  if (!view.sheets.length) return 1
  const targets = genTargets(view)
  if (!targets.length) return 1
  if (!view.style.locked) return 2
  return targets.some((s) => s.decision !== 'approved') ? 3 : 4
}
