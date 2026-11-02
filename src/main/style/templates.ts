import { app } from 'electron'
import { existsSync, promises as fs } from 'node:fs'
import { basename, isAbsolute, join, relative, resolve } from 'node:path'
import {
  GASSTYLE_VERSION,
  STYLE_IMAGE_MAX_BYTES,
  STYLE_REF_MAX,
  templateCategory,
  type ApplyTemplateRefsRequest,
  type LocalizedText,
  type SaveStyleRequest,
  type SaveTemplateRequest,
  type StyleTemplate,
  type TemplateCategory
} from '@shared/style'
import { appDataDir } from '../paths'
import { cleanPalette, cleanStr, newId, readJson, safeId, writeJsonAtomic } from './common'

export const userTemplatesDir = join(appDataDir, 'templates')

interface TemplateFile {
  id?: string
  name?: Partial<LocalizedText> | string
  description?: Partial<LocalizedText> | string
  category?: TemplateCategory | string
  promptEn?: string
  palette?: string[]
  chroma?: string
  createdAt?: number
  notes?: string
  refs?: string[]
  source?: { project?: string; at?: number }
}

interface PackImage {
  b64: string
}

interface GasStylePack {
  format: 'gasstyle'
  version: number
  template: {
    name: LocalizedText
    description?: LocalizedText
    category: TemplateCategory
    promptEn: string
    palette?: string[]
    notes?: string
    source?: { project?: string; at?: number }
  }
  preview?: PackImage
  refs: PackImage[]
}

interface ImageData {
  buf: Buffer
  ext: string
}

interface UserTemplateInput {
  name: LocalizedText
  description: LocalizedText
  category: TemplateCategory
  promptEn: string
  palette: string[]
  notes: string
  refs: ImageData[]
  preview: ImageData | null
  source: { project: string; at: number } | null
}

const REF_FILE = /^ref-\d{1,2}\.(png|jpg|webp)$/
const PACK_MAX_BYTES = 160 * 1024 * 1024
const ABS_PATH = /^[a-zA-Z]:[\\/]|^[\\/]/

export function sniffImageExt(b: Buffer): string | null {
  if (b.length > 12 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png'
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpg'
  if (b.length > 12 && b.toString('latin1', 0, 4) === 'RIFF' && b.toString('latin1', 8, 12) === 'WEBP') return 'webp'
  return null
}

function inside(root: string, p: string): boolean {
  const r = relative(resolve(root), resolve(p))
  return !!r && !r.startsWith('..') && !isAbsolute(r)
}

async function readImage(file: string): Promise<ImageData | null> {
  try {
    const st = await fs.stat(file)
    if (!st.isFile() || st.size > STYLE_IMAGE_MAX_BYTES) return null
    const buf = await fs.readFile(file)
    const ext = sniffImageExt(buf)
    return ext ? { buf, ext } : null
  } catch {
    return null
  }
}

function decodeImage(img: PackImage | undefined): ImageData | null {
  if (!img || typeof img.b64 !== 'string' || img.b64.length > Math.ceil((STYLE_IMAGE_MAX_BYTES * 4) / 3) + 8) return null
  const buf = Buffer.from(img.b64, 'base64')
  const ext = sniffImageExt(buf)
  return ext && buf.length <= STYLE_IMAGE_MAX_BYTES ? { buf, ext } : null
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
    category: templateCategory(raw.category),
    promptEn,
    palette: cleanPalette(raw.palette),
    chroma: typeof raw.chroma === 'string' ? raw.chroma : null,
    builtin,
    dir,
    previewPath: existsSync(preview) ? preview : null,
    previewSmPath: existsSync(previewSm) ? previewSm : existsSync(preview) ? preview : null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : null,
    notes: cleanStr(raw.notes, 4000),
    refPaths: (Array.isArray(raw.refs) ? raw.refs : [])
      .filter((r): r is string => typeof r === 'string' && REF_FILE.test(r) && existsSync(join(dir, 'refs', r)))
      .slice(0, STYLE_REF_MAX)
      .map((r) => join(dir, 'refs', r)),
    source: raw.source && typeof raw.source.at === 'number' ? { project: cleanStr(raw.source.project, 200), at: raw.source.at } : null
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
    const base = g.templateId ? await this.get(g.templateId) : null
    const category = req.category ? templateCategory(req.category) : (base?.category ?? 'ui')
    const lock = g.lockImage ? await readImage(ABS_PATH.test(g.lockImage) ? g.lockImage : join(req.projectPath, g.lockImage)) : null
    const refs = await readRefs(req.projectPath, g.refImages)
    return this.writeUser({
      name,
      description: req.description ?? { vi: '', en: '' },
      category,
      promptEn,
      palette: cleanPalette(req.palette ?? []),
      notes: cleanStr(g.notes, 4000),
      refs,
      preview: lock ?? refs[0] ?? null,
      source: { project: basename(req.projectPath), at: Date.now() }
    })
  }

  async saveFromStyle(req: SaveStyleRequest): Promise<StyleTemplate> {
    const promptEn = cleanStr(req.promptEn, 6000)
    const name = cleanStr(req.name, 200)
    if (!name) throw new Error('Style name is required')
    const refs = await readRefs(req.projectPath, req.refImages)
    if (!promptEn && !refs.length) throw new Error('Style has no prompt or reference image to save')
    let preview: ImageData | null = null
    if (req.previewRel) {
      const p = join(req.projectPath, req.previewRel)
      if (inside(req.projectPath, p)) preview = await readImage(p)
    }
    return this.writeUser({
      name: { vi: name, en: name },
      description: { vi: '', en: '' },
      category: templateCategory(req.category),
      promptEn,
      palette: cleanPalette(req.palette ?? []),
      notes: cleanStr(req.notes, 4000),
      refs,
      preview: preview ?? refs[0] ?? null,
      source: { project: cleanStr(req.sourceName, 200) || basename(req.projectPath), at: Date.now() }
    })
  }

  async rename(id: string, name: string): Promise<StyleTemplate | null> {
    const n = cleanStr(name, 200)
    const dir = this.userTemplateDir(id)
    const raw = await readJson<TemplateFile>(join(dir, 'template.json'))
    if (!raw || !n) return null
    await writeJsonAtomic(join(dir, 'template.json'), { ...raw, name: { vi: n, en: n } })
    return readTemplate(dir, false)
  }

  async exportPack(id: string, file: string): Promise<void> {
    const t = (await this.listUser()).find((x) => x.id === id)
    if (!t) throw new Error('Template not found in the team library')
    const enc = async (p: string): Promise<PackImage | null> => {
      const img = await readImage(p)
      return img ? { b64: img.buf.toString('base64') } : null
    }
    const refs = (await Promise.all(t.refPaths.map(enc))).filter((x): x is PackImage => !!x)
    const pack: GasStylePack = {
      format: 'gasstyle',
      version: GASSTYLE_VERSION,
      template: {
        name: t.name,
        description: t.description,
        category: t.category,
        promptEn: t.promptEn,
        palette: t.palette,
        notes: t.notes,
        source: t.source ?? undefined
      },
      preview: (t.previewPath ? await enc(t.previewPath) : null) ?? undefined,
      refs
    }
    await fs.writeFile(file, JSON.stringify(pack), 'utf8')
  }

  async importPack(file: string): Promise<StyleTemplate> {
    const st = await fs.stat(file)
    if (!st.isFile() || st.size > PACK_MAX_BYTES) throw new Error('Style file is too large')
    let pack: Partial<GasStylePack> | null
    try {
      pack = JSON.parse(await fs.readFile(file, 'utf8')) as Partial<GasStylePack> | null
    } catch {
      throw new Error('Style file is corrupted')
    }
    if (!pack || pack.format !== 'gasstyle' || !pack.template) throw new Error('Not a Gen Asset Studio style file')
    if (typeof pack.version !== 'number' || pack.version > GASSTYLE_VERSION) throw new Error('Style file was made by a newer version of the app')
    const tp = pack.template
    const promptEn = cleanStr(tp.promptEn, 6000)
    const refs = (Array.isArray(pack.refs) ? pack.refs : [])
      .slice(0, STYLE_REF_MAX)
      .map(decodeImage)
      .filter((x): x is ImageData => !!x)
    if (!promptEn && !refs.length) throw new Error('Style file has no prompt or reference image')
    return this.writeUser({
      name: loc(tp.name, 'Style'),
      description: loc(tp.description, ''),
      category: templateCategory(tp.category),
      promptEn,
      palette: cleanPalette(tp.palette),
      notes: cleanStr(tp.notes, 4000),
      refs,
      preview: decodeImage(pack.preview) ?? refs[0] ?? null,
      source: tp.source && typeof tp.source.at === 'number' ? { project: cleanStr(tp.source.project, 200), at: tp.source.at } : null
    })
  }

  async applyRefs(req: ApplyTemplateRefsRequest): Promise<string[]> {
    const t = await this.get(req.templateId)
    if (!t) return []
    const rel = req.refDir.replace(/\\/g, '/').replace(/\/+$/, '')
    const destDir = join(req.projectPath, rel)
    if (!rel || !inside(req.projectPath, destDir)) throw new Error('Invalid reference folder')
    await fs.mkdir(destDir, { recursive: true })
    const out: string[] = []
    for (const src of t.refPaths.slice(0, Math.max(0, req.max))) {
      const base = `lib-${basename(t.dir)}-${out.length + 1}`.replace(/[^a-z0-9_-]+/gi, '_')
      const ext = src.split('.').pop() ?? 'png'
      let name = `${base}.${ext}`
      for (let n = 2; existsSync(join(destDir, name)); n++) name = `${base}-${n}.${ext}`
      await fs.copyFile(src, join(destDir, name))
      out.push(`${rel}/${name}`)
    }
    return out
  }

  async deleteUser(id: string): Promise<boolean> {
    const dir = this.userTemplateDir(id)
    if (!existsSync(join(dir, 'template.json'))) return false
    await fs.rm(dir, { recursive: true, force: true })
    return true
  }

  private userTemplateDir(id: string): string {
    if (!id || /[\\/]|\.\./.test(id)) throw new Error('Invalid template id')
    return join(this.userDir, id)
  }

  private async writeUser(input: UserTemplateInput): Promise<StyleTemplate> {
    const builtinIds = new Set((await this.listBuiltin()).map((t) => t.id))
    let id = `user-${safeId(input.name.en || input.name.vi) || 'style'}`
    if (builtinIds.has(id) || existsSync(join(this.userDir, id))) id = `${id}-${newId()}`
    const dir = join(this.userDir, id)
    await fs.mkdir(dir, { recursive: true })
    try {
      if (input.preview) {
        await fs.writeFile(join(dir, 'preview.png'), input.preview.buf)
        await fs.writeFile(join(dir, 'preview-sm.png'), input.preview.buf)
      }
      const refNames: string[] = []
      if (input.refs.length) await fs.mkdir(join(dir, 'refs'), { recursive: true })
      for (const [i, r] of input.refs.entries()) {
        const name = `ref-${i + 1}.${r.ext}`
        await fs.writeFile(join(dir, 'refs', name), r.buf)
        refNames.push(name)
      }
      const file: TemplateFile = {
        id,
        name: input.name,
        description: input.description,
        category: input.category,
        promptEn: input.promptEn || input.name.en,
        palette: input.palette,
        createdAt: Date.now(),
        notes: input.notes,
        refs: refNames,
        source: input.source ?? undefined
      }
      await writeJsonAtomic(join(dir, 'template.json'), file)
      const t = await readTemplate(dir, false)
      if (!t) throw new Error(`Failed to read back saved template ${id}`)
      return t
    } catch (e) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
      throw e
    }
  }
}

async function readRefs(projectPath: string, rels: string[]): Promise<ImageData[]> {
  const out: ImageData[] = []
  for (const r of rels.slice(0, STYLE_REF_MAX)) {
    const img = await readImage(ABS_PATH.test(r) ? r : join(projectPath, r))
    if (img) out.push(img)
  }
  return out
}
