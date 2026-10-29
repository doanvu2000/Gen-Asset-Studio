import type { EdgeSide, QaSummary } from './queue'

export type ReviewDecision = 'approved' | 'rejected'

export interface ReviewEntry {
  decision: ReviewDecision | null
  selected: number | null
  updatedAt: number
}

export type ReviewPatch = Record<string, { decision?: ReviewDecision | null; selected?: number | null } | null>

export interface VersionInfo {
  v: number
  url: string
  createdAt: string | null
  note: string | null
  qa: QaSummary | null
  model: string | null
  effort: string | null
  reprocessOf: number | null
  nineSlice: boolean | null
  edgeAnchored: EdgeSide[]
  hasRaw: boolean
}

export interface ReprocessOptions {
  nineSlice: boolean | 'auto'
  edgeAnchored: EdgeSide[] | 'auto'
}

export interface ReprocessResult {
  ok: boolean
  version: number | null
  qa: QaSummary | null
  error: string | null
}

export const REVIEW_IPC = {
  set: 'review:set',
  versions: 'review:versions',
  reprocess: 'review:reprocess'
} as const

export interface ReviewApi {
  set: (rel: string, patch: ReviewPatch) => Promise<boolean>
  versions: (rel: string, inputId: string) => Promise<VersionInfo[]>
  reprocess: (rel: string, inputId: string, version: number, options: ReprocessOptions) => Promise<ReprocessResult>
}
