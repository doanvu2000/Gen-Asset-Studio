import type { JobErrorCode, JobStatus } from './queue'

export type StatsKind = 'asset' | 'sprite' | 'spine'

export interface StatsRecord {
  ts: number
  id: string
  project: string
  asset: string
  kind: StatsKind
  style: string
  status: JobStatus
  attempt: number
  regen: boolean
  qaPass: boolean | null
  err: JobErrorCode | null
  ms: number
}

export interface StatsQuery {
  from: number
  to: number
  project?: string
}

export interface StatsGroup {
  key: string
  name: string
  count: number
  firstTry: number
  firstTryPass: number
  regen: number
  errors: number
}

export interface StatsDay {
  day: string
  count: number
  errors: number
}

export interface StatsSummary {
  from: number
  to: number
  total: number
  done: number
  qaWarn: number
  errors: number
  canceled: number
  firstTry: number
  firstTryPass: number
  regen: number
  byDay: StatsDay[]
  byProject: StatsGroup[]
  byKind: StatsGroup[]
  byStyle: StatsGroup[]
  errorCodes: Array<{ code: string; count: number }>
}

export const STATS_IPC = { summary: 'stats:summary' } as const

export interface StatsApi {
  summary: (q: StatsQuery) => Promise<StatsSummary>
}
