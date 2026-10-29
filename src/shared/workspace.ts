import type { StyleGroup } from './style'
import type { QaSummary } from './queue'
import type { ReviewDecision } from './review'

export type ProjectStatus = 'new' | 'draft'

export interface FolderNode {
  rel: string
  name: string
  kind: 'folder' | 'project'
  children: FolderNode[]
  projectCount: number
  imageCount: number
}

export interface ProjectSummary {
  rel: string
  name: string
  parentRel: string
  imageCount: number
  groupCount: number
  approved: number
  status: ProjectStatus
  updatedAt: number
  thumbs: string[]
}

export interface WorkspaceSnapshot {
  root: string | null
  name: string | null
  exists: boolean
  tree: FolderNode | null
  projects: ProjectSummary[]
}

export type InputType = 'normal' | 'nine' | 'sprite'
export type InputKind = 'button' | 'panel' | 'icon' | 'bar' | 'character'
export type InputStatus = 'ok' | 'missing' | 'changed'

export interface InputView {
  id: string
  root: number
  rel: string
  abs: string
  name: string
  dir: string
  w: number
  h: number
  alpha: boolean
  size: number
  type: InputType
  typeAuto: boolean
  kind: InputKind
  status: InputStatus
  thumb: string | null
  url: string
  outRel: string
  versions: number[]
  latest: string | null
  selected: number
  selectedUrl: string | null
  decision: ReviewDecision | null
  qa: QaSummary | null
}

export interface RootView {
  index: number
  path: string
  label: string
  missing: boolean
  missingCount: number
}

export interface ProjectView {
  rel: string
  name: string
  dir: string
  roots: RootView[]
  commonRoot: string | null
  inputs: InputView[]
  groups: StyleGroup[]
  groupCount: number
  updatedAt: number
}

export interface SkippedFile {
  name: string
  reason: 'notPng' | 'unreadable' | 'duplicate'
}

export interface AddResult {
  view: ProjectView | null
  added: number
  skipped: SkippedFile[]
  canceled: boolean
}

export type WsError = 'invalidName' | 'exists' | 'notFound' | 'intoSelf' | 'noWorkspace' | 'busy' | 'io'

export interface OpResult {
  ok: boolean
  rel: string | null
  error: WsError | null
  detail: string | null
}

export const MAX_PER_RUN = 100
