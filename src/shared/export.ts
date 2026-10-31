export type ExportScaleFactor = 1 | 2 | 4

export type ExportScaleLayout = 'folder' | 'suffix'

export type ExportConflictPolicy = 'backup' | 'skip'

export interface ExportOptions {
  outDir: string
  scales: ExportScaleFactor[]
  scaleLayout: ExportScaleLayout
  onlyApproved: boolean
  conflict: ExportConflictPolicy
  openFolderWhenDone: boolean
}

export const DEFAULT_EXPORT_OPTIONS: ExportOptions = {
  outDir: '',
  scales: [1],
  scaleLayout: 'folder',
  onlyApproved: true,
  conflict: 'backup',
  openFolderWhenDone: false
}

export const EXPORT_SCALES: readonly ExportScaleFactor[] = [1, 2, 4]

export const BACKUP_DIR = '_backup'

export const REPORT_FILE = 'export-report.json'

export type ExportSkipReason = 'notGrouped' | 'notApproved' | 'noVersion' | 'missingFile' | 'sizeMismatch'

export const EXPORT_SKIP_REASONS: readonly ExportSkipReason[] = ['notApproved', 'notGrouped', 'noVersion', 'missingFile', 'sizeMismatch']

export type ExportPlanError = 'noProject' | 'outInsideSource' | 'outIsFile' | 'noScale' | 'busy'

export interface ExportTarget {
  scale: ExportScaleFactor
  rel: string
  abs: string
  w: number
  h: number
  exists: boolean
}

export interface ExportPlanItem {
  id: string
  rel: string
  name: string
  dir: string
  version: number
  versionPath: string
  w: number
  h: number
  approved: boolean
  targets: ExportTarget[]
}

export interface ExportSkipped {
  id: string
  rel: string
  name: string
  reason: ExportSkipReason
  detail?: string
}

export interface ExportPlan {
  projectRel: string
  projectDir: string
  outDir: string
  options: ExportOptions
  items: ExportPlanItem[]
  skipped: ExportSkipped[]
  skippedCounts: Record<ExportSkipReason, number>
  totalFiles: number
  conflicts: number
  backupStamp: string
  backupDir: string
  error: ExportPlanError | null
}

export type ExportPhase = 'running' | 'done' | 'canceled' | 'error'

export interface ExportProgress {
  projectRel: string
  phase: ExportPhase
  done: number
  total: number
  current: string
}

export interface ExportError {
  rel: string
  message: string
}

export interface ExportResult {
  ok: boolean
  canceled: boolean
  projectRel: string
  outDir: string
  backupDir: string | null
  reportPath: string | null
  exportedAssets: number
  written: number
  backedUp: number
  keptExisting: number
  skipped: number
  errors: ExportError[]
  planError: ExportPlanError | null
  durationMs: number
}

export const EXPORT_IPC = {
  plan: 'export:plan',
  run: 'export:run',
  cancel: 'export:cancel',
  pickDir: 'export:pick-dir',
  openPath: 'export:open-path',
  saveDir: 'export:save-dir',
  progress: 'export:progress'
} as const

export interface ExportApi {
  plan: (projectRel: string, options?: Partial<ExportOptions>) => Promise<ExportPlan>
  run: (projectRel: string, options?: Partial<ExportOptions>) => Promise<ExportResult>
  cancel: (projectRel: string) => Promise<boolean>
  pickDir: (current?: string) => Promise<string | null>
  openPath: (path: string) => Promise<boolean>
  saveDir: (projectRel: string, outDir: string) => Promise<boolean>
  onProgress: (cb: (p: ExportProgress) => void) => () => void
}

export function normalizeExportOptions(raw: Partial<ExportOptions> | null | undefined): ExportOptions {
  const r = raw ?? {}
  const scales = Array.isArray(r.scales) ? EXPORT_SCALES.filter((s) => r.scales?.includes(s)) : DEFAULT_EXPORT_OPTIONS.scales
  return {
    outDir: typeof r.outDir === 'string' ? r.outDir.trim() : '',
    scales,
    scaleLayout: r.scaleLayout === 'suffix' ? 'suffix' : 'folder',
    onlyApproved: r.onlyApproved !== false,
    conflict: r.conflict === 'skip' ? 'skip' : 'backup',
    openFolderWhenDone: r.openFolderWhenDone === true
  }
}

export function scaledRel(rel: string, scale: ExportScaleFactor, layout: ExportScaleLayout): string {
  if (scale === 1) return rel
  if (layout === 'folder') return `@${scale}x/${rel}`
  const slash = rel.lastIndexOf('/')
  const dir = slash >= 0 ? rel.slice(0, slash + 1) : ''
  const file = rel.slice(slash + 1)
  const dot = file.lastIndexOf('.')
  const base = dot > 0 ? file.slice(0, dot) : file
  const ext = dot > 0 ? file.slice(dot) : '.png'
  return `${dir}${base}@${scale}x${ext}`
}

export function backupStamp(d: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, '0')
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
}
