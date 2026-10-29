import { app } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { DEFAULT_SETTINGS, type AppSettings, type Lang, type ThemePref } from '@shared/types'

const THEMES: readonly ThemePref[] = ['light', 'dark', 'system']
const LANGS: readonly Lang[] = ['vi', 'en']

function sanitize(input: unknown, base: AppSettings): AppSettings {
  const out: AppSettings = { ...base }
  if (input && typeof input === 'object') {
    const raw = input as Record<string, unknown>
    if (typeof raw.theme === 'string' && (THEMES as readonly string[]).includes(raw.theme)) {
      out.theme = raw.theme as ThemePref
    }
    if (typeof raw.lang === 'string' && (LANGS as readonly string[]).includes(raw.lang)) {
      out.lang = raw.lang as Lang
    }
  }
  return out
}

export class SettingsStore {
  private current: AppSettings = { ...DEFAULT_SETTINGS }
  private writing: Promise<void> = Promise.resolve()
  private readonly file = join(app.getPath('userData'), 'settings.json')

  get(): AppSettings {
    return { ...this.current }
  }

  async load(): Promise<AppSettings> {
    try {
      const text = await fs.readFile(this.file, 'utf8')
      this.current = sanitize(JSON.parse(text), DEFAULT_SETTINGS)
    } catch {
      this.current = { ...DEFAULT_SETTINGS }
    }
    return this.get()
  }

  async set(patch: unknown): Promise<AppSettings> {
    this.current = sanitize(patch, this.current)
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
