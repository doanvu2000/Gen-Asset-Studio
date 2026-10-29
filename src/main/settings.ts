import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_GEN,
  DEFAULT_SETTINGS,
  DEFAULT_SETUP,
  type AppSettings,
  type ExportScale,
  type GenPrefs,
  type Lang,
  type SetupPersist,
  type ThemePref
} from '@shared/types'

const THEMES: readonly ThemePref[] = ['light', 'dark', 'system']
const LANGS: readonly Lang[] = ['vi', 'en']

function sanitizeSetup(input: unknown, base: SetupPersist): SetupPersist {
  const out: SetupPersist = { ...base }
  if (!input || typeof input !== 'object') return out
  const raw = input as Record<string, unknown>
  if (typeof raw.completed === 'boolean') out.completed = raw.completed
  if (raw.pathChoice === 'added' || raw.pathChoice === 'skipped' || raw.pathChoice === null) out.pathChoice = raw.pathChoice
  if (typeof raw.longPathSkipped === 'boolean') out.longPathSkipped = raw.longPathSkipped
  if (typeof raw.testGenOk === 'boolean') out.testGenOk = raw.testGenOk
  return out
}

function clampInt(v: unknown, min: number, max: number, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(min, Math.min(max, Math.round(v))) : d
}

function sanitizeGen(input: unknown, base: GenPrefs): GenPrefs {
  const out: GenPrefs = { ...DEFAULT_GEN, ...base }
  if (!input || typeof input !== 'object') return out
  const raw = input as Record<string, unknown>
  out.concurrency = clampInt(raw.concurrency, 1, 6, out.concurrency)
  out.styleCount = clampInt(raw.styleCount, 1, 6, out.styleCount)
  if (raw.scale === 1 || raw.scale === 2 || raw.scale === 4) out.scale = raw.scale as ExportScale
  return out
}

function sanitize(input: unknown, base: AppSettings, internal: boolean): AppSettings {
  const out: AppSettings = { ...base, setup: { ...base.setup }, gen: { ...DEFAULT_GEN, ...base.gen } }
  if (input && typeof input === 'object') {
    const raw = input as Record<string, unknown>
    if (typeof raw.theme === 'string' && (THEMES as readonly string[]).includes(raw.theme)) {
      out.theme = raw.theme as ThemePref
    }
    if (typeof raw.lang === 'string' && (LANGS as readonly string[]).includes(raw.lang)) {
      out.lang = raw.lang as Lang
    }
    if ('gen' in raw) out.gen = sanitizeGen(raw.gen, out.gen)
    if (internal) {
      if (typeof raw.workspace === 'string' || raw.workspace === null) out.workspace = raw.workspace
      if ('setup' in raw) out.setup = sanitizeSetup(raw.setup, out.setup)
    }
  }
  return out
}

export class SettingsStore {
  private current: AppSettings = { ...DEFAULT_SETTINGS, setup: { ...DEFAULT_SETUP }, gen: { ...DEFAULT_GEN } }
  private writing: Promise<void> = Promise.resolve()
  private readonly file = join(app.getPath('userData'), 'settings.json')

  get(): AppSettings {
    return { ...this.current, setup: { ...this.current.setup }, gen: { ...this.current.gen } }
  }

  async load(): Promise<AppSettings> {
    try {
      const text = await fs.readFile(this.file, 'utf8')
      this.current = sanitize(JSON.parse(text), DEFAULT_SETTINGS, true)
    } catch {
      this.current = { ...DEFAULT_SETTINGS, setup: { ...DEFAULT_SETUP }, gen: { ...DEFAULT_GEN } }
    }
    return this.get()
  }

  async set(patch: unknown): Promise<AppSettings> {
    return this.commit(sanitize(patch, this.current, false))
  }

  async update(patch: Partial<Omit<AppSettings, 'setup'>> & { setup?: Partial<SetupPersist> }): Promise<AppSettings> {
    const merged = { ...patch, setup: { ...this.current.setup, ...(patch.setup ?? {}) } }
    return this.commit(sanitize(merged, this.current, true))
  }

  private async commit(next: AppSettings): Promise<AppSettings> {
    this.current = next
    const snapshot = JSON.stringify(this.current, null, 2)
    this.writing = this.writing.then(() => this.persist(snapshot)).catch(() => this.persist(snapshot))
    await this.writing
    return this.get()
  }

  private async persist(text: string): Promise<void> {
    await fs.mkdir(app.getPath('userData'), { recursive: true })
    const tmp = `${this.file}.tmp`
    await fs.writeFile(tmp, text, 'utf8')
    await fs.rename(tmp, this.file)
  }
}
