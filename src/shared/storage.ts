import type { Unsubscribe } from './types'

export type StorageItemId = 'codex' | 'codexImages' | 'codexSessions' | 'codexHome' | 'cache' | 'logs' | 'updater' | 'workspace' | 'install'

export interface StorageItem {
  id: StorageItemId
  path: string
  bytes: number
  files: number
  movable: boolean
}

export type DriveKind = 'fixed' | 'removable' | 'network' | 'other'

export interface DriveInfo {
  root: string
  label: string
  free: number
  total: number
  system: boolean
  kind: DriveKind
}

export type DiskWarn = 'none' | 'low' | 'critical'

export interface StorageSnapshot {
  dataRoot: string
  defaultRoot: string
  custom: boolean
  codexHomeOverridden: boolean
  autoClean: boolean
  systemDrive: string
  dataDrive: DriveInfo | null
  warn: DiskWarn
  banner: boolean
  appBytes: number
}

export interface StorageScan {
  items: StorageItem[]
  scannedAt: number
}

export type CleanId = 'codexImages' | 'codexSessions' | 'oldCodex' | 'cache' | 'updater'

export interface CleanEntry {
  id: CleanId
  bytes: number
  files: number
}

export interface CleanResult {
  freed: number
  files: number
  errors: number
}

export type MoveError = 'same' | 'nested' | 'network' | 'notWritable' | 'noSpace' | 'busy' | 'invalid'

export interface MoveCheck {
  ok: boolean
  target: string
  error: MoveError | null
  need: number
  free: number
  removable: boolean
}

export type MovePhase = 'idle' | 'stop' | 'copy' | 'verify' | 'path' | 'restart' | 'error'

export interface MoveProgress {
  phase: MovePhase
  copied: number
  total: number
  error: string | null
}

export const SESSION_KEEP_DAYS = 7
export const DISK_LOW_BYTES = 10 * 1024 * 1024 * 1024
export const DISK_CRITICAL_BYTES = 3 * 1024 * 1024 * 1024
export const GEN_MIN_FREE_BYTES = 300 * 1024 * 1024

export const STORAGE_IPC = {
  get: 'storage:get',
  scan: 'storage:scan',
  drives: 'storage:drives',
  cleanPlan: 'storage:clean-plan',
  clean: 'storage:clean',
  setAutoClean: 'storage:set-auto-clean',
  pickDir: 'storage:pick-dir',
  check: 'storage:check',
  move: 'storage:move',
  progress: 'storage:progress',
  open: 'storage:open',
  dismissBanner: 'storage:dismiss-banner',
  changed: 'storage:changed'
} as const

export interface StorageApi {
  get: () => Promise<StorageSnapshot>
  scan: () => Promise<StorageScan>
  drives: () => Promise<DriveInfo[]>
  cleanPlan: () => Promise<CleanEntry[]>
  clean: (ids: CleanId[]) => Promise<CleanResult>
  setAutoClean: (on: boolean) => Promise<StorageSnapshot>
  pickDir: () => Promise<string | null>
  check: (dir: string) => Promise<MoveCheck>
  move: (dir: string) => Promise<MoveProgress>
  open: (path: string) => Promise<void>
  dismissBanner: () => Promise<StorageSnapshot>
  onProgress: (cb: (p: MoveProgress) => void) => Unsubscribe
  onChange: (cb: (s: StorageSnapshot) => void) => Unsubscribe
}
