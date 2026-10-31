import { app } from 'electron'
import { randomBytes } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Lang } from '@shared/types'
import type { InputType } from '@shared/workspace'
import type { LocalizedText, StyleGroup, StyleTemplate } from '@shared/style'
import { absOf, addCollected, collect, emptyProject, ensureThumb, PROJECT_FILE, sanitizeGroups, writeProject, type ProjectFile } from '../workspace/project'
import { TemplateStore } from '../style/templates'

export const SAMPLE_DIR_NAME = 'sample-project'
export const SAMPLE_MANIFEST = 'sample.json'

export interface SampleAsset {
  path: string
  type?: InputType
}

export interface SampleManifest {
  version: number
  name: LocalizedText
  assetsDir: string
  sourceDir: string
  group: {
    templateId: string
    name: LocalizedText
    notes: LocalizedText
  }
  assets: SampleAsset[]
}

export type SampleTemplate = Pick<StyleTemplate, 'id' | 'name' | 'promptEn' | 'palette'>

export interface SampleDeps {
  sampleDir?: string
  getTemplate?: (id: string) => Promise<SampleTemplate | null>
  log?: (message: string) => void
}

export interface SampleResult {
  dir: string
  rel: string
  name: string
  added: number
  groupId: string | null
  templateFound: boolean
}

const TYPES: readonly InputType[] = ['normal', 'nine']

export function sampleDirCandidates(): string[] {
  const out: string[] = []
  const rp = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath
  if (app?.isPackaged && rp) {
    out.push(join(rp, SAMPLE_DIR_NAME))
    out.push(join(rp, 'resources', SAMPLE_DIR_NAME))
    out.push(join(rp, 'app.asar.unpacked', 'resources', SAMPLE_DIR_NAME))
  }
  const appPath = app?.getAppPath?.()
  if (appPath) out.push(join(appPath, 'resources', SAMPLE_DIR_NAME))
  out.push(resolve(__dirname, '..', '..', 'resources', SAMPLE_DIR_NAME))
  out.push(resolve(__dirname, '..', '..', '..', 'resources', SAMPLE_DIR_NAME))
  out.push(join(process.cwd(), 'resources', SAMPLE_DIR_NAME))
  return out
}

export function resolveSampleDir(override?: string): string | null {
  if (override) return existsSync(join(override, SAMPLE_MANIFEST)) ? override : null
  return sampleDirCandidates().find((d) => existsSync(join(d, SAMPLE_MANIFEST))) ?? null
}

function text(v: unknown, fallback: string): LocalizedText {
  if (typeof v === 'string') return { vi: v, en: v }
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const vi = typeof o.vi === 'string' ? o.vi : ''
  const en = typeof o.en === 'string' ? o.en : ''
  return { vi: vi || en || fallback, en: en || vi || fallback }
}

function safeRel(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null
  const clean = v.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!clean.toLowerCase().endsWith('.png')) return null
  if (clean.split('/').some((p) => !p || p === '.' || p === '..')) return null
  return clean
}

function safeSeg(v: unknown, fallback: string): string {
  return typeof v === 'string' && /^[a-z0-9_-]{1,64}$/i.test(v) ? v : fallback
}

export async function readSampleManifest(sampleDir: string): Promise<SampleManifest> {
  const raw = JSON.parse(await fs.readFile(join(sampleDir, SAMPLE_MANIFEST), 'utf8')) as Record<string, unknown>
  const g = (raw.group && typeof raw.group === 'object' ? raw.group : {}) as Record<string, unknown>
  const assets: SampleAsset[] = []
  const seen = new Set<string>()
  for (const a of Array.isArray(raw.assets) ? raw.assets : []) {
    const o = (a && typeof a === 'object' ? a : { path: a }) as Record<string, unknown>
    const path = safeRel(o.path)
    if (!path || seen.has(path.toLowerCase())) continue
    seen.add(path.toLowerCase())
    const type = TYPES.includes(o.type as InputType) ? (o.type as InputType) : undefined
    assets.push(type ? { path, type } : { path })
  }
  return {
    version: typeof raw.version === 'number' ? raw.version : 1,
    name: text(raw.name, 'Sample project'),
    assetsDir: safeSeg(raw.assetsDir, 'assets'),
    sourceDir: safeSeg(raw.sourceDir, 'source'),
    group: {
      templateId: typeof g.templateId === 'string' ? g.templateId : '',
      name: text(g.name, 'Style'),
      notes: text(g.notes, '')
    },
    assets
  }
}

function uniqueDir(root: string, base: string): { dir: string; name: string } {
  let name = base
  for (let n = 2; existsSync(join(root, name)); n++) name = `${base} ${n}`
  return { dir: join(root, name), name }
}

function groupId(): string {
  return `g${Date.now().toString(36)}${randomBytes(2).toString('hex')}`
}

async function defaultTemplate(id: string): Promise<SampleTemplate | null> {
  try {
    return await new TemplateStore().get(id)
  } catch {
    return null
  }
}

export async function createSampleProject(workspaceRoot: string, lang: Lang, deps: SampleDeps = {}): Promise<SampleResult> {
  const log = deps.log ?? (() => undefined)
  const root = resolve(workspaceRoot)
  if (!existsSync(root)) throw new Error(`Workspace not found: ${root}`)
  const sampleDir = resolveSampleDir(deps.sampleDir)
  if (!sampleDir) throw new Error('Sample project resources not found')
  const manifest = await readSampleManifest(sampleDir)
  const assetsRoot = join(sampleDir, manifest.assetsDir)
  const files = manifest.assets.filter((a) => existsSync(join(assetsRoot, ...a.path.split('/'))))
  if (!files.length) throw new Error('Sample project has no assets')

  const { dir, name } = uniqueDir(root, manifest.name[lang] || manifest.name.vi)
  const sourceDir = join(dir, manifest.sourceDir)
  await fs.mkdir(dir, { recursive: false })
  try {
    for (const a of files) {
      const dest = join(sourceDir, ...a.path.split('/'))
      await fs.mkdir(dirname(dest), { recursive: true })
      await fs.copyFile(join(assetsRoot, ...a.path.split('/')), dest)
    }

    const data: ProjectFile = emptyProject(name)
    const collected = await collect([sourceDir])
    const { added } = await addCollected(data, collected)

    const wanted = new Map(files.filter((a) => a.type).map((a) => [a.path.toLowerCase(), a.type as InputType]))
    for (const input of data.inputs) {
      const type = wanted.get(input.rel.toLowerCase())
      if (type && type !== input.type) {
        input.type = type
        input.typeAuto = false
      }
    }

    const tpl = manifest.group.templateId ? await (deps.getTemplate ?? defaultTemplate)(manifest.group.templateId) : null
    let gid: string | null = null
    if (data.inputs.length) {
      gid = groupId()
      const group: StyleGroup = {
        id: gid,
        name: manifest.group.name[lang] || (tpl ? tpl.name[lang] : '') || 'Style',
        promptEn: tpl?.promptEn ?? '',
        notes: manifest.group.notes[lang],
        refImages: [],
        assetIds: data.inputs.map((i) => i.id),
        nineSliceOverrides: {}
      }
      if (tpl) {
        group.templateId = tpl.id
        if (tpl.palette.length) group.palette = [...tpl.palette]
      }
      data.groups = sanitizeGroups([group], new Set(data.inputs.map((i) => i.id)))
    }
    data.sample = { version: manifest.version, lang }

    await writeProject(dir, data)
    for (const input of data.inputs) await ensureThumb(dir, absOf(data, input), input.hash)
    if (!tpl && manifest.group.templateId) log(`sample project: template ${manifest.group.templateId} not found, group left without prompt`)
    log(`sample project created: ${dir} (${added} image(s))`)
    return { dir, rel: name, name, added, groupId: gid, templateFound: !!tpl }
  } catch (e) {
    if (!existsSync(join(dir, PROJECT_FILE))) await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined)
    throw e
  }
}
