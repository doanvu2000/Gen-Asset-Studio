import { app } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import type { LocalizedText, SaveTemplateRequest, StyleTemplate } from '@shared/style'
import { appDataDir } from '../paths'
import { cleanPalette, cleanStr, newId, readJson, safeId, writeJsonAtomic } from './common'

export const userTemplatesDir = join(appDataDir, 'templates')

interface TemplateFile {
  id?: string
  name?: Partial<LocalizedText> | string
  description?: Partial<LocalizedText> | string
  promptEn?: string
  palette?: string[]
  chroma?: string
  createdAt?: number
}

export function builtinTemplatesCandidates(): string[] {
  const out: string[] = []
  const rp = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (app?.isPackaged && rp) {
    out.push(join(rp, 'app.asar.unpacked', 'resources', 'style-templates'))
    out.push(join(rp, 'resources', 'style-templates'))
    out.push(join(rp, 'style-templates'))
  }
  const appPath = app?.getAppPath?.()
  if (appPath) out.push(join(appPath, 'resources', 'style-templates'))
  out.push(resolve(__dirname, '..', '..', 'resources', 'style-templates'))
  out.push(resolve(__dirname, '..', '..', '..', 'resources', 'style-templates'))
  out.push(join(process.cwd(), 'resources', 'style-templates'))
  return out
}

export function resolveBuiltinTemplatesDir(override?: string): string | null {
  if (override) return existsSync(override) ? override : null
  return builtinTemplatesCandidates().find((d) => existsSync(d)) ?? null
}

function loc(v: TemplateFile['name'], fallback: string): LocalizedText {
  if (typeof v === 'string') return { vi: v, en: v }
  const vi = cleanStr(v?.vi, 200)
  const en = cleanStr(v?.en, 200)
  return { vi: vi || en || fallback, en: en || vi || fallback }
}

async function readTemplate(dir: string, builtin: boolean): Promise<StyleTemplate | null> {
  const raw = await readJson<TemplateFile>(join(dir, 'template.json'))
  if (!raw) return null
  const id = cleanStr(raw.id, 80) || dir.split(/[\\/]/).pop() || ''
  const promptEn = cleanStr(raw.promptEn, 6000)
  if (!id || !promptEn) return null
  const preview = join(dir, 'preview.png')
  const previewSm = join(dir, 'preview-sm.png')
  return {
    id,
    name: loc(raw.name, id),
    description: loc(raw.description, ''),
    promptEn,
    palette: cleanPalette(raw.palette),
    chroma: typeof raw.chroma === 'string' ? raw.chroma : null,
    builtin,
    dir,
    previewPath: existsSync(preview) ? preview : null,
    previewSmPath: existsSync(previewSm) ? previewSm : existsSync(preview) ? preview : null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : null
  }
}

async function readDirTemplates(root: string, builtin: boolean): Promise<StyleTemplate[]> {
  let entries: string[] = []
  try {
    entries = (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name)
  } catch {
    return []
  }
  const out: StyleTemplate[] = []
  for (const name of entries.sort()) {
    const t = await readTemplate(join(root, name), builtin)
    if (t) out.push(t)
  }
  return out
}

export class TemplateStore {
  constructor(
    private readonly builtinDirOverride?: string,
    private readonly userDir: string = userTemplatesDir
  ) {}

  get builtinDir(): string | null {
    return resolveBuiltinTemplatesDir(this.builtinDirOverride)
  }

  async listBuiltin(): Promise<StyleTemplate[]> {
    const dir = this.builtinDir
    return dir ? readDirTemplates(dir, true) : []
  }

  async listUser(): Promise<StyleTemplate[]> {
    const list = await readDirTemplates(this.userDir, false)
    return list.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
  }

  async list(): Promise<StyleTemplate[]> {
    const [b, u] = await Promise.all([this.listBuiltin(), this.listUser()])
    return [...b, ...u]
  }

  async get(id: string): Promise<StyleTemplate | null> {
    return (await this.list()).find((t) => t.id === id) ?? null
  }

  async saveFromGroup(req: SaveTemplateRequest): Promise<StyleTemplate> {
    const g = req.group
    const promptEn = cleanStr(g.promptEn, 6000)
    if (!promptEn) throw new Error('Style group has no English prompt to save as a template')
    const name = loc(req.name, g.name || 'Template')
    const builtinIds = new Set((await this.listBuiltin()).map((t) => t.id))
    let id = `user-${safeId(name.en || name.vi) || 'style'}`
    if (builtinIds.has(id) || existsSync(join(this.userDir, id))) id = `${id}-${newId()}`
    const dir = join(this.userDir, id)
    await fs.mkdir(dir, { recursive: true })
    const lock = g.lockImage ? (/^[a-zA-Z]:[\\/]|^[\\/]/.test(g.lockImage) ? g.lockImage : join(req.projectPath, g.lockImage)) : null
    if (lock && existsSync(lock)) {
      await fs.copyFile(lock, join(dir, 'preview.png'))
      await fs.copyFile(lock, join(dir, 'preview-sm.png'))
    }
    const file: TemplateFile = {
      id,
      name,
      description: req.description ?? { vi: '', en: '' },
      promptEn,
      palette: cleanPalette(req.palette ?? []),
      createdAt: Date.now()
    }
    await writeJsonAtomic(join(dir, 'template.json'), file)
    const t = await readTemplate(dir, false)
    if (!t) throw new Error(`Failed to read back saved template ${id}`)
    return t
  }

  async deleteUser(id: string): Promise<boolean> {
    if (!id || /[\\/]|\.\./.test(id)) throw new Error('Invalid template id')
    const dir = join(this.userDir, id)
    if (!existsSync(join(dir, 'template.json'))) return false
    await fs.rm(dir, { recursive: true, force: true })
    return true
  }
}
