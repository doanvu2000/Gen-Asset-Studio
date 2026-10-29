import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { JobStatus, JobStep, QueueJob } from '@shared/queue'
import { Icon } from './Icon'

export const STAGES = ['prepare', 'send', 'receive', 'cutout', 'qa'] as const
export type Stage = (typeof STAGES)[number]

export function stageOf(j: QueueJob): number {
  if (j.status === 'done' || j.status === 'qaWarn') return STAGES.length
  const map: Record<JobStep, number> = { waiting: -1, chroma: 0, prompt: 0, codex: 1, image: 1, save: j.status === 'processing' ? 4 : 2, background: 3, fit: 3, qa: 4 }
  return map[j.step] ?? -1
}

export function jobPct(j: QueueJob): number {
  if (j.status === 'done' || j.status === 'qaWarn') return 100
  if (j.status === 'queued' || j.status === 'paused' || j.status === 'canceled') return 0
  const pct: Record<JobStep, number> = { waiting: 0, chroma: 6, prompt: 12, codex: 22, image: 40, save: j.status === 'processing' ? 96 : 76, background: 84, fit: 90, qa: 94 }
  return pct[j.step] ?? 0
}

const CHIP: Record<JobStatus, string> = {
  queued: 'c-gray',
  paused: 'c-gray',
  running: 'c-blue',
  processing: 'c-blue',
  done: 'c-green',
  qaWarn: 'c-orange',
  error: 'c-red',
  canceled: 'c-gray'
}

export function StatusChip({ status }: { status: JobStatus }): ReactElement {
  const { t } = useTranslation()
  return (
    <span className={`chip ${CHIP[status]}`}>
      {(status === 'running' || status === 'processing') && <span className="spin xs" />}
      {status === 'done' && <Icon name="check" size={10} />}
      {(status === 'error' || status === 'qaWarn') && <Icon name="alert" size={10} />}
      {status === 'paused' && <Icon name="pause" size={10} />}
      {t(`gen.status.${status}`)}
    </span>
  )
}

export function StageDots({ job }: { job: QueueJob }): ReactElement {
  const { t } = useTranslation()
  const cur = stageOf(job)
  const failed = job.status === 'error'
  return (
    <span className="jdots" aria-hidden="true">
      {STAGES.map((s, i) => {
        const cls = i < cur ? 'on' : i === cur ? (failed ? 'fail' : 'cur') : ''
        return <i key={s} className={cls} title={t(`gen.stage.${s}`)} />
      })}
    </span>
  )
}

export function stageText(job: QueueJob, t: (k: string) => string): string {
  if (job.status === 'queued') return t('gen.waiting')
  if (job.status === 'paused') return t('gen.status.paused')
  if (job.status === 'canceled') return t('gen.status.canceled')
  if (job.status === 'done') return t('gen.doneReview')
  const i = stageOf(job)
  return i >= 0 && i < STAGES.length ? t(`gen.stage.${STAGES[i]}`) : t('gen.waiting')
}
