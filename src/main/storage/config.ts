import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

export interface StorageConfig {
  dataRoot: string | null
  autoClean: boolean
  bannerDismissed: boolean
  cleanupOld: string | null
}

const DEFAULTS: StorageConfig = { dataRoot: null, autoClean: true, bannerDismissed: false, cleanupOld: null }

function configFile(): string {
  return join(app.getPath('userData'), 'storage.json')
}

function absOrNull(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' && isAbsolute(v) ? v : null
}

function read(): StorageConfig {
  try {
    const raw = JSON.parse(readFileSync(configFile(), 'utf8')) as Record<string, unknown>
    return {
      dataRoot: absOrNull(raw.dataRoot),
      autoClean: typeof raw.autoClean === 'boolean' ? raw.autoClean : DEFAULTS.autoClean,
      bannerDismissed: raw.bannerDismissed === true,
      cleanupOld: absOrNull(raw.cleanupOld)
    }
  } catch {
    return { ...DEFAULTS }
  }
}

let current: StorageConfig = read()

export function storageConfig(): StorageConfig {
  return { ...current }
}

export function saveStorageConfig(patch: Partial<StorageConfig>): StorageConfig {
  current = { ...current, ...patch }
  const file = configFile()
  mkdirSync(app.getPath('userData'), { recursive: true })
  const tmp = `${file}.tmp`
  writeFileSync(tmp, JSON.stringify(current, null, 2), 'utf8')
  renameSync(tmp, file)
  return { ...current }
}
