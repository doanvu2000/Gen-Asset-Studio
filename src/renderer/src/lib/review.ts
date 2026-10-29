import type { QueueJob } from '@shared/queue'
import type { ReviewDecision, ReviewPatch } from '@shared/review'
import type { StyleGroup } from '@shared/style'
import type { InputView, ProjectView } from '@shared/workspace'
import i18n from '@renderer/i18n'
import { useWs } from '@renderer/store/workspace'
import { toast } from '@renderer/store/toast'
import { isActive, samePath } from '@renderer/store/queue'
import { groupOf } from './project'

export type RvStatus = 'pending' | 'approved' | 'rejected' | 'qa' | 'err' | 'regen'
export type RvFilter = 'all' | RvStatus

export const RV_FILTERS: RvFilter[] = ['all', 'pending', 'approved', 'rejected', 'qa', 'err', 'regen']

export const RV_CHIP: Record<RvStatus, string> = {
  pending: 'c-gray',
  approved: 'c-green',
  rejected: 'c-purple',
  qa: 'c-orange',
  err: 'c-red',
  regen: 'c-blue'
}

export interface RvItem {
  input: InputView
  status: RvStatus
  job: QueueJob | null
  group: StyleGroup | null
}

export function reviewItems(p: ProjectView, jobs: QueueJob[]): RvItem[] {
  const latest = new Map<string, QueueJob>()
  for (const j of jobs) {
    if (!samePath(j.projectPath, p.dir) || j.status === 'canceled') continue
    const prev = latest.get(j.assetRelPath)
    if (!prev || j.createdAt >= prev.createdAt) latest.set(j.assetRelPath, j)
  }
  const owner = groupOf(p)
  const out: RvItem[] = []
  for (const input of p.inputs) {
    const job = latest.get(input.outRel) ?? null
    if (!input.versions.length && !job) continue
    let status: RvStatus
    if (job && isActive(job)) status = 'regen'
    else if (job && job.status === 'error') status = 'err'
    else if (!input.selected) continue
    else if (input.decision === 'approved') status = 'approved'
    else if (input.decision === 'rejected') status = 'rejected'
    else if (input.qa && !input.qa.pass) status = 'qa'
    else status = 'pending'
    out.push({ input, status, job, group: owner.get(input.id) ?? null })
  }
  return out
}

export function approvedCount(p: ProjectView): number {
  return p.inputs.filter((i) => i.selected > 0 && i.decision === 'approved').length
}

function patchLocal(ids: string[], fn: (i: InputView) => InputView): void {
  const { project } = useWs.getState()
  if (!project) return
  const set = new Set(ids)
  useWs.setState({ project: { ...project, inputs: project.inputs.map((i) => (set.has(i.id) ? fn(i) : i)) } })
}

async function persist(patch: ReviewPatch): Promise<void> {
  const rel = useWs.getState().curProject
  if (!rel) return
  const ok = await window.gas.review.set(rel, patch).catch(() => false)
  if (!ok) toast(i18n.t('review.saveFailed'), 'err')
}

export function setDecision(ids: string[], decision: ReviewDecision | null): Promise<void> {
  if (!ids.length) return Promise.resolve()
  patchLocal(ids, (i) => ({ ...i, decision }))
  const patch: ReviewPatch = {}
  for (const id of ids) patch[id] = { decision }
  return persist(patch)
}

export function selectVersion(input: InputView, v: number): Promise<void> {
  const latest = input.versions[input.versions.length - 1] ?? 0
  patchLocal([input.id], (i) => ({ ...i, selected: v }))
  return persist({ [input.id]: { selected: v === latest ? null : v } }).then(() => useWs.getState().reloadProject())
}

export function resetReview(id: string): Promise<void> {
  patchLocal([id], (i) => ({ ...i, decision: null }))
  return persist({ [id]: null })
}
