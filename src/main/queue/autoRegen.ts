import type { QaCheckSummary, QueueJob } from '@shared/queue'

const FIXES: Record<string, string> = {
  missing: 'Every cell must contain a frame; do not leave cells empty.',
  overflow: 'Keep the character fully inside its frame; shrink it slightly so no limb or weapon extends past the frame.'
}

function failedChecks(job: Pick<QueueJob, 'result'>): QaCheckSummary[] {
  return job.result?.qa.checks.filter((c) => c.status === 'fail') ?? []
}

export function needsAutoRegen(job: Pick<QueueJob, 'status' | 'result' | 'autoRegenOf'>, enabled: boolean): boolean {
  if (!enabled || job.autoRegenOf || job.status !== 'qaWarn') return false
  return failedChecks(job).length > 0
}

export function buildRegenNote(checks: QaCheckSummary[], oldNote?: string): string {
  const fixes = new Set<string>()
  for (const c of checks) {
    if (c.status !== 'fail') continue
    const text = FIXES[c.id] ?? c.message
    if (text) fixes.add(text)
  }
  return [oldNote?.trim(), ...fixes].filter(Boolean).join(' ')
}

export function regenSpecFor(job: QueueJob): QueueJob {
  return { ...job, note: buildRegenNote(failedChecks(job), job.note), autoRegenOf: job.id }
}
