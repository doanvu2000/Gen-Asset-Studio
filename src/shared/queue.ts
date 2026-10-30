import type { RateLimits } from './types'

export type JobStatus = 'queued' | 'running' | 'processing' | 'done' | 'qaWarn' | 'error' | 'paused' | 'canceled'

export type JobStep = 'waiting' | 'chroma' | 'prompt' | 'codex' | 'image' | 'background' | 'fit' | 'qa' | 'save'

export type JobErrorCode =
  | 'sourceMissing'
  | 'imageGenFailed'
  | 'noImage'
  | 'quota'
  | 'rateLimited'
  | 'timeout'
  | 'canceled'
  | 'pipeline'
  | 'codex'
  | 'io'
  | 'unknown'

export interface JobError {
  code: JobErrorCode
  message: string
}

export type NineSliceMode = 'auto' | boolean

export type EdgeSide = 'left' | 'right' | 'top' | 'bottom'

export interface QaCheckSummary {
  id: string
  status: 'pass' | 'warn' | 'fail'
  value: number
  threshold: number
  message: string
}

export interface QaSummary {
  pass: boolean
  checks: QaCheckSummary[]
}

export interface JobResult {
  version: number
  versionPath: string
  rawPath: string
  metaPath: string
  qa: QaSummary
}

export interface JobSpec {
  projectPath: string
  assetRelPath: string
  sourcePath: string
  groupId: string
  stylePrompt: string
  styleImages: string[]
  refImages?: string[]
  note?: string
  nineSlice?: NineSliceMode
  edgeAnchored?: EdgeSide[] | 'auto'
  model?: string
  effort?: string
}

export interface QueueJob extends JobSpec {
  id: string
  attempt: number
  status: JobStatus
  step: JobStep
  progress: string
  error: JobError | null
  result: JobResult | null
  createdAt: number
  startedAt: number | null
  finishedAt: number | null
  notBefore: number | null
}

export type QueuePauseReason = 'user' | 'quota' | 'noImage' | null

export interface QuotaPause {
  resumeAt: number | null
  reason: string
  remainingMs: number | null
}

export interface QueueSnapshot {
  jobs: QueueJob[]
  paused: boolean
  pauseReason: QueuePauseReason
  pauseDetail: string | null
  quota: QuotaPause | null
  concurrency: number
  running: number
  queued: number
  rateLimits: RateLimits | null
  updatedAt: number
}

export interface QueueJobEvent {
  type: 'started' | 'progress' | 'finished'
  job: QueueJob
}

export const QUEUE_MIN_CONCURRENCY = 1
export const QUEUE_MAX_CONCURRENCY = 6
export const QUEUE_DEFAULT_CONCURRENCY = 3

export const QUEUE_IPC = {
  snapshot: 'queue:snapshot',
  enqueue: 'queue:enqueue',
  pause: 'queue:pause',
  resume: 'queue:resume',
  pauseJob: 'queue:pause-job',
  resumeJob: 'queue:resume-job',
  pauseProject: 'queue:pause-project',
  resumeProject: 'queue:resume-project',
  cancel: 'queue:cancel',
  cancelAll: 'queue:cancel-all',
  retry: 'queue:retry',
  retryFailed: 'queue:retry-failed',
  remove: 'queue:remove',
  move: 'queue:move',
  clearFinished: 'queue:clear-finished',
  setConcurrency: 'queue:set-concurrency',
  changed: 'queue:changed',
  job: 'queue:job',
  quota: 'queue:quota'
} as const

export interface QueueApi {
  snapshot: () => Promise<QueueSnapshot>
  enqueue: (specs: JobSpec[]) => Promise<string[]>
  pause: () => Promise<void>
  resume: () => Promise<void>
  pauseJob: (id: string) => Promise<void>
  resumeJob: (id: string) => Promise<void>
  pauseProject: (projectPath: string) => Promise<void>
  resumeProject: (projectPath: string) => Promise<void>
  cancel: (id: string) => Promise<void>
  cancelAll: (projectPath?: string) => Promise<void>
  retry: (id: string) => Promise<void>
  retryFailed: (projectPath: string) => Promise<number>
  remove: (id: string) => Promise<void>
  move: (id: string, toIndex: number) => Promise<void>
  clearFinished: (projectPath?: string) => Promise<void>
  setConcurrency: (n: number) => Promise<number>
  onChange: (cb: (snapshot: QueueSnapshot) => void) => () => void
  onJob: (cb: (event: QueueJobEvent) => void) => () => void
  onQuota: (cb: (quota: QuotaPause | null) => void) => () => void
}
