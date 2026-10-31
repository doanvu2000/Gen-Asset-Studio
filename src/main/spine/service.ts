import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve } from 'node:path'
import sharp from 'sharp'
import type { BrowserWindow, IpcMain } from 'electron'
import type { JobSpec } from '@shared/queue'
import type { StyleTemplate } from '@shared/style'
import { EMPTY_SPRITE_STYLE, type SpriteStyle } from '@shared/sprite'
import {
  EMPTY_RIG,
  SPINE_IPC,
  type SpineAssets,
  type SpineAtlasData,
  type SpineAttachmentRef,
  type SpineDecision,
  type SpineExportResult,
  type SpineImportResult,
  type SpineProjectView,
  type SpineRegionPatch,
  type SpineRegionView,
  type SpineRig,
  type SpineSkeletonFormat,
  type SpineSkeletonInfo,
  skeletonFormatOf
} from '@shared/spine'
import type { ProjectFile } from '../workspace/project'
import { PROJECT_FILE, pathKey } from '../workspace/project'
import { hashFile } from '../workspace/analyze'
import { fileUrl } from '../workspace/protocol'
import { readVersionQa } from '../workspace/review'
import { versionsDir } from '../queue/GenJob'
import { decode, encodePng, rawSharp } from '../pipeline/image'
import type { RawImage } from '../pipeline/types'
import { savePng } from '../sprite/strip'
import { decisionAt } from '../sprite/strips'
import { AtlasError, parseSpineAtlas } from './atlas'
import { applyRig, parseSkeleton, rigIsEmpty, sanitizeRig, SkeletonError } from './skeleton'
import { applyRigBinary, parseSkeletonBinary } from './binary'
import { extractRegion, partsBoard, writeRegion } from './regions'

export interface SpineDeps {
  projectDir: (rel: string) => string
  run: <T>(fn: () => Promise<T>) => Promise<T>
  allow: (abs: string) => void
  log: (message: string) => void
  readProject: (dir: string) => Promise<ProjectFile>
  writeProject: (dir: string, data: ProjectFile) => Promise<void>
  enqueue?: () => ((specs: JobSpec[]) => string[]) | null
  template?: (id: string) => Promise<StyleTemplate | null>
}

interface FileRef {
  path: string
  hash: string
  mtime?: number
  size?: number
}

interface SpineData {
  skeleton: FileRef | null
  atlas: FileRef | null
  pages: Record<string, FileRef>
  style: SpriteStyle
  review: Record<string, { decision: SpineDecision | null; selected: number; version?: number; seen?: number }>
  dims: Record<string, number[]>
  assets: Record<string, string>
  rig: SpineRig
  exportDir: string
  lastExport: { at: number; pages: number; regions: number } | null
}

interface Loaded {
  dir: string
  data: ProjectFile
  spine: SpineData
}

interface Parsed {
  format: SpineSkeletonFormat
  data: Buffer
  atlasText: string
  atlas: SpineAtlasData
  info: SpineSkeletonInfo
}

function readSkeleton(data: Buffer, format: SpineSkeletonFormat): SpineSkeletonInfo {
  return format === 'binary' ? parseSkeletonBinary(data).info : parseSkeleton(data.toString('utf8')).info
}

function riggedSkeleton(p: Parsed, rig: SpineRig): Buffer {
  if (p.format === 'binary') return Buffer.from(applyRigBinary(p.data, rig))
  return Buffer.from(applyRig(p.data.toString('utf8'), rig), 'utf8')
}

function o(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}

function num(v: unknown, d = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}

function fileRef(v: unknown): FileRef | null {
  const r = o(v)
  if (typeof r.path !== 'string' || !r.path) return null
  const f: FileRef = { path: r.path, hash: typeof r.hash === 'string' ? r.hash : '' }
  if (typeof r.mtime === 'number' && typeof r.size === 'number') {
    f.mtime = r.mtime
    f.size = r.size
  }
  return f
}

function relRef(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null
  const c = v.replace(/\\/g, '/')
  return c.split('/').some((p) => p === '..') || /^[a-z]:/i.test(c) || c.startsWith('/') ? null : c
}

function sanitizeStyle(raw: unknown): SpriteStyle {
  const r = o(raw)
  return {
    promptEn: typeof r.promptEn === 'string' ? r.promptEn.slice(0, 6000) : '',
    templateId: typeof r.templateId === 'string' && r.templateId ? r.templateId.slice(0, 120) : null,
    refImages: (Array.isArray(r.refImages) ? r.refImages : []).map(relRef).filter((x): x is string => !!x).slice(0, 8),
    notes: typeof r.notes === 'string' ? r.notes.slice(0, 4000) : '',
    locked: r.locked === true,
    lockedAt: num(r.lockedAt)
  }
}

function readData(data: ProjectFile): SpineData {
  const raw = o(data.spine)
  const pages: Record<string, FileRef> = {}
  for (const [k, v] of Object.entries(o(raw.pages))) {
    const f = fileRef(v)
    if (f) pages[k] = f
  }
  const review: SpineData['review'] = {}
  for (const [k, v] of Object.entries(o(raw.review))) {
    const e = o(v)
    review[k] = {
      decision: e.decision === 'approved' || e.decision === 'rejected' ? e.decision : null,
      selected: Math.max(0, Math.round(num(e.selected))),
      version: Math.max(0, Math.round(num(e.version))),
      seen: Math.max(0, Math.round(num(e.seen)))
    }
  }
  const dims: SpineData['dims'] = {}
  for (const [k, v] of Object.entries(o(raw.dims))) if (Array.isArray(v) && v.length === 4 && v.every((x) => typeof x === 'number')) dims[k] = v as number[]
  const assets: SpineData['assets'] = {}
  for (const [k, v] of Object.entries(o(raw.assets))) if (typeof v === 'string' && v.startsWith('spine/') && !v.split('/').includes('..')) assets[k] = v
  const last = o(raw.lastExport)
  return {
    skeleton: fileRef(raw.skeleton),
    atlas: fileRef(raw.atlas),
    pages,
    style: raw.style ? sanitizeStyle(raw.style) : { ...EMPTY_SPRITE_STYLE },
    review,
    dims,
    assets,
    rig: sanitizeRig(raw.rig),
    exportDir: typeof raw.exportDir === 'string' ? raw.exportDir : '',
    lastExport: raw.lastExport ? { at: num(last.at), pages: num(last.pages), regions: num(last.regions) } : null
  }
}

export function regionAsset(name: string): string {
  const safe = name.replace(/[^a-zA-Z0-9_/-]+/g, '_').replace(/\/+/g, '/').replace(/^\/|\/$/g, '') || 'region'
  return `spine/${safe}`
}

const flatKey = (asset: string): string => asset.replace(/\//g, '__').toLowerCase()

export function assignAssets(names: string[], known: Record<string, string>): Record<string, string> {
  const out = { ...known }
  const used = new Set(Object.values(out).map(flatKey))
  for (const n of names) {
    if (out[n]) continue
    const plain = regionAsset(n)
    const hashed = `${plain}-${createHash('sha1').update(n).digest('hex').slice(0, 6)}`
    let a = used.has(flatKey(plain)) ? hashed : plain
    for (let i = 2; used.has(flatKey(a)); i++) a = `${hashed}-${i}`
    out[n] = a
    used.add(flatKey(a))
  }
  return out
}

export function refersTo(a: SpineAttachmentRef, name: string): boolean {
  const base = name.replace(/#\d+$/, '')
  if (a.region === name || a.region === base) return true
  const sq = a.sequence
  if (!sq || !base.startsWith(a.region)) return false
  const tail = base.slice(a.region.length)
  if (!/^\d+$/.test(tail)) return false
  const n = Number(tail)
  return n >= sq.start && n < sq.start + sq.count && tail === String(n).padStart(sq.digits, '0')
}

function regionDims(atlas: SpineAtlasData): Record<string, number[]> {
  const out: Record<string, number[]> = {}
  for (const r of atlas.regions) out[r.name] = [r.w, r.h, r.origW, r.origH]
  return out
}

async function statRef(path: string): Promise<FileRef> {
  const st = await fs.stat(path)
  return { path: resolve(path), hash: await hashFile(path), mtime: st.mtimeMs, size: st.size }
}

function pageTarget(outDir: string, name: string): string | null {
  const t = resolve(outDir, name)
  const rel = relative(outDir, t)
  return !rel || isAbsolute(rel) || rel.split(/[\\/]/)[0] === '..' ? null : t
}

async function savePage(img: RawImage, path: string): Promise<void> {
  const ext = extname(path).toLowerCase()
  if (ext === '.jpg' || ext === '.jpeg') await rawSharp(img).flatten({ background: '#000000' }).jpeg({ quality: 95 }).toFile(path)
  else if (ext === '.webp') await rawSharp(img).webp({ lossless: true }).toFile(path)
  else await savePng(img, path)
}

const IMG = new Set(['.png', '.jpg', '.jpeg', '.webp'])

export class SpineService {
  private readonly hashMemo = new Map<string, { mtime: number; size: number; hash: string }>()

  constructor(private readonly deps: SpineDeps) {}

  private async load(rel: string): Promise<Loaded> {
    const dir = this.deps.projectDir(rel)
    const data = await this.deps.readProject(dir)
    return { dir, data, spine: readData(data) }
  }

  private async save(l: Loaded): Promise<void> {
    l.data.spine = { ...l.spine }
    await this.deps.writeProject(l.dir, l.data)
  }

  private async parse(spine: SpineData): Promise<Parsed | null> {
    if (!spine.skeleton || !spine.atlas || !existsSync(spine.skeleton.path) || !existsSync(spine.atlas.path)) return null
    const format = skeletonFormatOf(spine.skeleton.path)
    const data = await fs.readFile(spine.skeleton.path)
    const atlasText = await fs.readFile(spine.atlas.path, 'utf8')
    return { format, data, atlasText, atlas: parseSpineAtlas(atlasText), info: readSkeleton(data, format) }
  }

  private async sourceChanges(l: Loaded): Promise<string[]> {
    const refs = [l.spine.skeleton, l.spine.atlas, ...Object.values(l.spine.pages)].filter((r): r is FileRef => !!r)
    const changed: string[] = []
    let dirty = false
    for (const ref of refs) {
      const st = await fs.stat(ref.path).catch(() => null)
      if (!st || !st.isFile() || (ref.mtime === st.mtimeMs && ref.size === st.size)) continue
      const memo = this.hashMemo.get(ref.path)
      const hash = memo && memo.mtime === st.mtimeMs && memo.size === st.size ? memo.hash : await hashFile(ref.path)
      this.hashMemo.set(ref.path, { mtime: st.mtimeMs, size: st.size, hash })
      if (ref.hash && ref.hash !== hash) {
        changed.push(ref.path)
        continue
      }
      ref.hash = hash
      ref.mtime = st.mtimeMs
      ref.size = st.size
      dirty = true
    }
    if (dirty) await this.saveQuiet(l)
    return changed
  }

  private async saveQuiet(l: Loaded): Promise<void> {
    l.data.spine = { ...l.spine }
    const file = join(l.dir, PROJECT_FILE)
    const tmp = `${file}.${process.pid}.tmp`
    const prev = await fs.stat(file).catch(() => null)
    await fs.writeFile(tmp, JSON.stringify(l.data, null, 2), 'utf8')
    await fs.rename(tmp, file)
    if (prev) await fs.utimes(file, prev.atimeMs / 1000, prev.mtimeMs / 1000)
  }

  private async assetsFor(l: Loaded, atlas: SpineAtlasData): Promise<Map<string, string>> {
    const names = atlas.regions.map((r) => r.name)
    if (names.some((n) => !l.spine.assets[n])) {
      l.spine.assets = assignAssets(names, l.spine.assets)
      await this.saveQuiet(l)
    }
    return new Map(names.map((n) => [n, l.spine.assets[n]]))
  }

  private cacheDir(dir: string, spine: SpineData): string {
    const sig = createHash('sha1')
      .update(['pma1', spine.atlas?.hash ?? '', ...Object.values(spine.pages).map((p) => p.hash)].join('|'))
      .digest('hex')
      .slice(0, 10)
    return join(dir, '.cache', 'spine', sig)
  }

  private async ensureSources(dir: string, spine: SpineData, atlas: SpineAtlasData, assets: Map<string, string>): Promise<Map<string, string>> {
    const cache = this.cacheDir(dir, spine)
    const out = new Map<string, string>()
    const pages = new Map<string, RawImage>()
    const parts: RawImage[] = []
    let made = false
    for (const r of atlas.regions) {
      const file = join(cache, 'src', `${(assets.get(r.name) ?? regionAsset(r.name)).slice(6).replace(/\//g, '__')}.png`)
      out.set(r.name, file)
      if (existsSync(file)) continue
      const pageRef = spine.pages[r.page]
      if (!pageRef || !existsSync(pageRef.path)) continue
      let page = pages.get(r.page)
      if (!page) {
        page = await decode(pageRef.path)
        pages.set(r.page, page)
      }
      const img = await extractRegion(page, r, atlas.pages.find((p) => p.name === r.page)?.pma === true)
      await fs.mkdir(dirname(file), { recursive: true })
      await savePng(img, file)
      made = true
    }
    const board = join(cache, 'parts-board.png')
    if (made || !existsSync(board)) {
      for (const r of atlas.regions) {
        const f = out.get(r.name)
        if (f && existsSync(f)) parts.push(await decode(f))
      }
      if (parts.length) await savePng(await partsBoard(parts), board)
    }
    return out
  }

  private async coverBoard(dir: string, spine: SpineData, regions: SpineRegionView[], sources: Map<string, string>): Promise<void> {
    const cache = this.cacheDir(dir, spine)
    const board = join(cache, 'board.png')
    const keyFile = join(cache, 'board.key')
    const key = createHash('sha1')
      .update(regions.map((r) => `${r.name}:${r.selected}`).join('|'))
      .digest('hex')
    try {
      if (existsSync(board) && (await fs.readFile(keyFile, 'utf8').catch(() => '')) === key) return
      const parts: RawImage[] = []
      for (const r of regions) {
        const src = sources.get(r.name)
        const files = [r.selected ? join(versionsDir(dir, r.assetRel), `v${r.selected}.png`) : null, src].filter((f): f is string => !!f && existsSync(f))
        for (const f of files) {
          const img = await decode(f).catch(() => null)
          if (img) {
            parts.push(img)
            break
          }
        }
      }
      if (!parts.length) return
      await fs.mkdir(cache, { recursive: true })
      await savePng(await partsBoard(parts), board)
      await fs.writeFile(keyFile, key, 'utf8')
    } catch (e) {
      this.deps.log(`spine cover board failed: ${(e as Error).message}`)
    }
  }

  private async versionsOf(dir: string, asset: string): Promise<number[]> {
    try {
      return (await fs.readdir(versionsDir(dir, asset)))
        .map((n) => /^v(\d+)\.png$/i.exec(n))
        .filter((m): m is RegExpExecArray => !!m)
        .map((m) => Number(m[1]))
        .sort((a, b) => a - b)
    } catch {
      return []
    }
  }

  private selectedOf(spine: SpineData, name: string, versions: number[]): number {
    const e = spine.review[name]
    const latest = versions[versions.length - 1] ?? 0
    const sel = e?.selected
    if (!sel || !versions.includes(sel)) return latest
    return e.seen && latest > e.seen ? latest : sel
  }

  private async view(rel: string, l: Loaded, error: string | null = null): Promise<SpineProjectView> {
    const { dir, data, spine } = l
    const base: SpineProjectView = {
      rel,
      name: basename(dir),
      dir,
      kind: 'spine',
      loaded: false,
      skeletonPath: spine.skeleton?.path ?? null,
      atlasPath: spine.atlas?.path ?? null,
      skeletonName: spine.skeleton ? basename(spine.skeleton.path) : null,
      skeletonFormat: spine.skeleton ? skeletonFormatOf(spine.skeleton.path) : null,
      status: spine.skeleton ? 'ok' : 'none',
      error,
      skeleton: null,
      pages: [],
      regions: [],
      style: spine.style,
      rig: spine.rig,
      export: { outDir: spine.exportDir, lastAt: spine.lastExport?.at ?? 0, lastPages: spine.lastExport?.pages ?? 0, lastRegions: spine.lastExport?.regions ?? 0 },
      updatedAt: Date.parse(data.updatedAt) || 0
    }
    if (!spine.skeleton) return base
    const changedFiles = await this.sourceChanges(l)
    const changed = changedFiles.length ? { changedFiles } : {}
    let parsed: Parsed | null = null
    try {
      parsed = await this.parse(spine)
    } catch (e) {
      const parseError = e instanceof SkeletonError || e instanceof AtlasError ? `${e.code}:${e.message}` : `parse:${(e as Error).message}`
      return { ...base, status: 'changed', error: changedFiles.length ? (error ?? parseError) : parseError, ...changed }
    }
    if (changedFiles.length) return { ...base, status: 'changed', error: error ?? 'sourceChanged', changedFiles }
    if (!parsed) return { ...base, status: 'missing' }
    const assets = await this.assetsFor(l, parsed.atlas)
    const sources = await this.ensureSources(dir, spine, parsed.atlas, assets)
    const regions: SpineRegionView[] = []
    for (const r of parsed.atlas.regions) {
      const refs = parsed.info.attachments.filter((a) => refersTo(a, r.name))
      const assetRel = assets.get(r.name) ?? regionAsset(r.name)
      const versions = await this.versionsOf(dir, assetRel)
      const selected = this.selectedOf(spine, r.name, versions)
      const src = sources.get(r.name)
      if (src) this.deps.allow(src)
      const vdir = versionsDir(dir, assetRel)
      regions.push({
        ...r,
        key: r.name,
        assetRel,
        sourceUrl: src && existsSync(src) ? fileUrl(src, basename(src)) : null,
        slots: [...new Set(refs.map((a) => a.slot))],
        skins: [...new Set(refs.map((a) => a.skin))],
        kinds: [...new Set(refs.map((a) => a.kind))],
        versions,
        selected,
        url: selected ? fileUrl(join(vdir, `v${selected}.png`), `${selected}`) : null,
        decision: decisionAt(spine.review[r.name], selected),
        qa: selected ? await readVersionQa(vdir, selected) : null,
        used: refs.length > 0
      })
    }
    await this.coverBoard(dir, spine, regions, sources)
    const pages = parsed.atlas.pages.map((p) => {
      const ref = spine.pages[p.name]
      const ok = !!ref && existsSync(ref.path)
      if (ok) this.deps.allow(ref.path)
      return { ...p, path: ok ? ref.path : null, url: ok ? fileUrl(ref.path, ref.hash) : null }
    })
    return { ...base, loaded: pages.every((p) => !!p.path), status: pages.every((p) => !!p.path) ? 'ok' : 'missing', skeleton: parsed.info, pages, regions }
  }

  private mutate(rel: string, fn: (l: Loaded) => Promise<void> | void, what: string): Promise<SpineProjectView | null> {
    return this.deps.run(async () => {
      try {
        const l = await this.load(rel)
        await fn(l)
        await this.save(l)
        return await this.view(rel, l)
      } catch (e) {
        this.deps.log(`spine ${what} failed: ${(e as Error).message}`)
        return null
      }
    })
  }

  open(rel: string): Promise<SpineProjectView | null> {
    return this.deps.run(async () => {
      try {
        return await this.view(rel, await this.load(rel))
      } catch (e) {
        this.deps.log(`spine open failed: ${(e as Error).message}`)
        return null
      }
    })
  }

  async importDialog(rel: string, win: BrowserWindow | null): Promise<SpineImportResult> {
    const { dialog } = await import('electron')
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
      filters: [
        { name: 'Spine 4.2 (.json, .skel, .atlas, .png)', extensions: ['json', 'atlas', 'txt', 'png', 'skel'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths.length) return { view: null, error: null, canceled: true }
    return this.importPaths(rel, r.filePaths)
  }

  importPaths(rel: string, paths: string[]): Promise<SpineImportResult> {
    return this.deps.run(async () => {
      const l = await this.load(rel)
      const fail = async (error: string): Promise<SpineImportResult> => ({ view: await this.view(rel, l, error), error, canceled: false })
      try {
        const files: string[] = []
        for (const p of paths) {
          if (!p || !existsSync(p)) continue
          const st = await fs.stat(p)
          if (st.isDirectory()) for (const n of await fs.readdir(p)) files.push(join(p, n))
          else files.push(p)
        }
        let skeleton =
          files.find((f) => extname(f).toLowerCase() === '.json' && !f.toLowerCase().endsWith('.atlas.json')) ?? files.find((f) => extname(f).toLowerCase() === '.skel')
        let atlas = files.find((f) => /\.atlas(\.txt)?$/i.test(f))
        if (!skeleton && atlas) {
          const stem = join(dirname(atlas), basename(atlas).replace(/\.atlas(\.txt)?$/i, ''))
          skeleton = [`${stem}.json`, `${stem}.skel`].find((p) => existsSync(p))
        }
        if (!skeleton) return fail('noSkeleton')
        if (!atlas) {
          const stem = join(dirname(skeleton), basename(skeleton, extname(skeleton)))
          atlas = [`${stem}.atlas`, `${stem}.atlas.txt`].find((p) => existsSync(p))
          if (!atlas) {
            const any = (await fs.readdir(dirname(skeleton))).find((n) => /\.atlas(\.txt)?$/i.test(n))
            if (any) atlas = join(dirname(skeleton), any)
          }
        }
        if (!atlas) return fail('noAtlas')
        try {
          readSkeleton(await fs.readFile(skeleton), skeletonFormatOf(skeleton))
        } catch (e) {
          return fail(e instanceof SkeletonError ? `${e.code}:${e.message}` : 'parse')
        }
        let parsed: SpineAtlasData
        try {
          parsed = parseSpineAtlas(await fs.readFile(atlas, 'utf8'))
        } catch (e) {
          return fail(e instanceof AtlasError ? `${e.code}:${e.message}` : `parse:${(e as Error).message}`)
        }
        const pages: Record<string, FileRef> = {}
        for (const p of parsed.pages) {
          const cands = [join(dirname(atlas), p.name), ...files.filter((f) => basename(f) === basename(p.name))]
          const found = cands.find((c) => existsSync(c) && IMG.has(extname(c).toLowerCase()))
          if (!found) return fail(`noPage:${p.name}`)
          pages[p.name] = await statRef(found)
        }
        const sameSkel = l.spine.skeleton && pathKey(l.spine.skeleton.path) === pathKey(skeleton)
        const dims = regionDims(parsed)
        if (sameSkel) {
          let old = l.spine.dims
          if (!Object.keys(old).length && l.spine.atlas && existsSync(l.spine.atlas.path)) {
            old = await fs
              .readFile(l.spine.atlas.path, 'utf8')
              .then((t) => regionDims(parseSpineAtlas(t)))
              .catch(() => ({}))
          }
          for (const k of Object.keys(l.spine.review)) if (old[k] && dims[k] && old[k].join() !== dims[k].join()) delete l.spine.review[k]
        }
        l.spine.skeleton = await statRef(skeleton)
        l.spine.atlas = await statRef(atlas)
        l.spine.pages = pages
        l.spine.dims = dims
        l.spine.assets = assignAssets(parsed.regions.map((r) => r.name), l.spine.assets)
        if (!sameSkel) {
          l.spine.rig = { ...EMPTY_RIG, bones: {}, attachments: {} }
          l.spine.review = {}
        }
        await this.save(l)
        this.deps.log(`spine ${rel}: imported ${basename(skeleton)} (${parsed.regions.length} regions, ${parsed.pages.length} pages)`)
        return { view: await this.view(rel, l), error: null, canceled: false }
      } catch (e) {
        this.deps.log(`spine import failed: ${(e as Error).message}`)
        return fail(`parse:${(e as Error).message}`)
      }
    })
  }

  clear(rel: string): Promise<SpineProjectView | null> {
    return this.mutate(
      rel,
      (l) => {
        l.spine.skeleton = null
        l.spine.atlas = null
        l.spine.pages = {}
        l.spine.review = {}
        l.spine.dims = {}
        l.spine.rig = { bones: {}, attachments: {} }
      },
      'clear'
    )
  }

  private async composedPages(l: Loaded, parsed: Parsed, mode: 'preview' | 'export'): Promise<Map<string, { image: RawImage; regions: number; pma: boolean }>> {
    const out = new Map<string, { image: RawImage; regions: number; pma: boolean }>()
    for (const p of parsed.atlas.pages) {
      const ref = l.spine.pages[p.name]
      if (!ref || !existsSync(ref.path)) continue
      out.set(p.name, { image: await decode(ref.path), regions: 0, pma: p.pma })
    }
    const assets = await this.assetsFor(l, parsed.atlas)
    for (const r of parsed.atlas.regions) {
      const page = out.get(r.page)
      if (!page) continue
      const asset = assets.get(r.name) ?? regionAsset(r.name)
      const versions = await this.versionsOf(l.dir, asset)
      const v = this.selectedOf(l.spine, r.name, versions)
      if (!v) continue
      const decision = decisionAt(l.spine.review[r.name], v)
      if (mode === 'export' ? decision !== 'approved' : decision === 'rejected') continue
      const file = join(versionsDir(l.dir, asset), `v${v}.png`)
      if (!existsSync(file)) continue
      await writeRegion(page.image, r, await decode(file), page.pma)
      page.regions++
    }
    return out
  }

  assets(rel: string, which: 'orig' | 'new'): Promise<SpineAssets | null> {
    return this.deps.run(async () => {
      try {
        const l = await this.load(rel)
        const parsed = await this.parse(l.spine)
        if (!parsed || !l.spine.skeleton || !l.spine.atlas) return null
        if ((await this.sourceChanges(l)).length) return null
        const pages: Record<string, string> = {}
        if (which === 'orig') {
          for (const p of parsed.atlas.pages) {
            const ref = l.spine.pages[p.name]
            if (ref && existsSync(ref.path)) pages[p.name] = `data:image/png;base64,${(await sharp(ref.path).png().toBuffer()).toString('base64')}`
          }
        } else {
          for (const [name, p] of await this.composedPages(l, parsed, 'preview')) pages[name] = `data:image/png;base64,${Buffer.from(await encodePng(p.image)).toString('base64')}`
        }
        const skel = which === 'new' ? riggedSkeleton(parsed, l.spine.rig) : parsed.data
        return {
          skeletonName: basename(l.spine.skeleton.path),
          atlasName: basename(l.spine.atlas.path),
          format: parsed.format,
          json: parsed.format === 'json' ? skel.toString('utf8') : '',
          skelBase64: parsed.format === 'binary' ? skel.toString('base64') : null,
          atlas: parsed.atlasText,
          pages
        }
      } catch (e) {
        this.deps.log(`spine assets failed: ${(e as Error).message}`)
        return null
      }
    })
  }

  setStyle(rel: string, patch: Partial<SpriteStyle>): Promise<SpineProjectView | null> {
    return this.mutate(
      rel,
      (l) => {
        const p = patch && typeof patch === 'object' ? patch : {}
        const next = sanitizeStyle({ ...l.spine.style, ...p })
        if (p.locked === true && !l.spine.style.locked) next.lockedAt = Date.now()
        if (p.locked === false) next.lockedAt = 0
        l.spine.style = next
      },
      'set style'
    )
  }

  async addRefs(rel: string, win: BrowserWindow | null): Promise<SpineProjectView | null> {
    const { dialog } = await import('electron')
    const opts: Electron.OpenDialogOptions = { properties: ['openFile', 'multiSelections', 'dontAddToRecent'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths.length) return null
    return this.mutate(
      rel,
      async (l) => {
        const refDir = join(l.dir, 'styles', 'spine', 'refs')
        await fs.mkdir(refDir, { recursive: true })
        for (const src of r.filePaths.slice(0, 8)) {
          if (l.spine.style.refImages.length >= 8) break
          const base = (basename(src).replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40) || 'ref').toLowerCase()
          let name = `${base}.png`
          for (let n = 2; existsSync(join(refDir, name)); n++) name = `${base}-${n}.png`
          await sharp(src).png().toFile(join(refDir, name))
          l.spine.style.refImages.push(`styles/spine/refs/${name}`)
        }
      },
      'add refs'
    )
  }

  enqueue(rel: string, keys: string[], note?: string): Promise<number> {
    return this.deps.run(async () => {
      const push = this.deps.enqueue?.()
      if (!push) return 0
      const l = await this.load(rel)
      if (!l.spine.style.locked) return -1
      if ((await this.sourceChanges(l)).length) return 0
      const parsed = await this.parse(l.spine)
      if (!parsed) return 0
      const assets = await this.assetsFor(l, parsed.atlas)
      const sources = await this.ensureSources(l.dir, l.spine, parsed.atlas, assets)
      const board = join(this.cacheDir(l.dir, l.spine), 'parts-board.png')
      let styleImages: string[] = []
      let prompt = l.spine.style.promptEn
      if (l.spine.style.templateId && this.deps.template) {
        const tpl = await this.deps.template(l.spine.style.templateId).catch(() => null)
        const preview = tpl ? (tpl.previewSmPath ?? tpl.previewPath) : null
        if (preview) styleImages = [preview]
        if (!prompt.trim() && tpl) prompt = tpl.promptEn
      }
      const refs = [...(existsSync(board) ? [board] : []), ...l.spine.style.refImages.map((r) => join(l.dir, r)).filter((p) => existsSync(p))]
      const specs: JobSpec[] = []
      for (const key of keys) {
        const r = parsed.atlas.regions.find((x) => x.name === key)
        const src = r ? sources.get(r.name) : undefined
        if (!r || !src || !existsSync(src)) continue
        const notes = [
          `This image is the "${r.name.replace(/#\d+$/, '')}" region (one body part or piece) of a 2D Spine skeletal character. Keep its exact outline, size, orientation and attachment point so it still fits the rig; draw only this part on its own.`,
          existsSync(board) ? 'The first extra reference image is a board with every part of the same character: keep all parts consistent with each other.' : '',
          l.spine.style.notes.trim(),
          (note ?? '').trim()
        ]
          .filter(Boolean)
          .join('\n')
        specs.push({
          projectPath: l.dir,
          assetRelPath: assets.get(r.name) ?? regionAsset(r.name),
          sourcePath: src,
          groupId: 'spine',
          stylePrompt: prompt,
          styleImages,
          refImages: refs,
          note: notes,
          nineSlice: false,
          edgeAnchored: []
        })
      }
      if (!specs.length) return 0
      push(specs)
      this.deps.log(`spine ${rel}: enqueued ${specs.length} region(s)`)
      return specs.length
    })
  }

  review(rel: string, patch: Record<string, SpineRegionPatch>): Promise<SpineProjectView | null> {
    return this.mutate(
      rel,
      async (l) => {
        for (const [k, v] of Object.entries(patch && typeof patch === 'object' ? patch : {}).slice(0, 5000)) {
          if (!v || typeof v !== 'object') continue
          const asset = l.spine.assets[k]
          const versions = asset ? await this.versionsOf(l.dir, asset) : null
          const cur = l.spine.review[k] ?? { decision: null, selected: 0 }
          if (versions) {
            if (cur.selected && cur.selected !== this.selectedOf(l.spine, k, versions)) cur.selected = 0
            cur.seen = versions[versions.length - 1] ?? 0
          }
          if (v.decision !== undefined) cur.decision = v.decision === 'approved' || v.decision === 'rejected' ? v.decision : null
          if (v.selected !== undefined) {
            cur.selected = Math.max(0, Math.round(num(v.selected)))
            if (v.decision === undefined) cur.decision = null
          }
          if (versions) cur.version = this.selectedOf({ ...l.spine, review: { [k]: cur } }, k, versions)
          l.spine.review[k] = cur
        }
      },
      'review'
    )
  }

  setRig(rel: string, rig: SpineRig): Promise<SpineProjectView | null> {
    return this.mutate(
      rel,
      (l) => {
        l.spine.rig = sanitizeRig(rig)
      },
      'set rig'
    )
  }

  async pickExportDir(rel: string, win: BrowserWindow | null): Promise<string | null> {
    const { dialog } = await import('electron')
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths.length) return null
    await this.mutate(
      rel,
      (l) => {
        l.spine.exportDir = r.filePaths[0]
      },
      'export dir'
    )
    return r.filePaths[0]
  }

  exportRun(rel: string, outDirRaw: string): Promise<SpineExportResult> {
    return this.deps.run(async () => {
      const fail = (error: string, outDir = ''): SpineExportResult => ({ ok: false, outDir, pages: [], skeleton: null, rigChanged: false, backupDir: null, error })
      try {
        const l = await this.load(rel)
        const parsed = await this.parse(l.spine)
        if (!parsed || !l.spine.skeleton || !l.spine.atlas) return fail('noSkeleton')
        if ((await this.sourceChanges(l)).length) return fail('sourceChanged')
        const outDir = resolve(l.dir, outDirRaw.trim() || l.spine.exportDir || 'output')
        const srcDirs = [dirname(l.spine.skeleton.path), dirname(l.spine.atlas.path), ...Object.values(l.spine.pages).map((p) => dirname(p.path))]
        if (srcDirs.some((d) => pathKey(d) === pathKey(outDir))) return fail('outIsSource', outDir)
        const targets = new Map<string, string>()
        for (const p of parsed.atlas.pages) {
          const t = pageTarget(outDir, p.name)
          if (!t) return fail(`pagePath:${p.name}`, outDir)
          targets.set(p.name, t)
        }
        const composed = await this.composedPages(l, parsed, 'export')
        const total = [...composed.values()].reduce((n, p) => n + p.regions, 0)
        if (!total && rigIsEmpty(l.spine.rig)) return fail('nothingApproved', outDir)
        await fs.mkdir(outDir, { recursive: true })
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
        let backupDir: string | null = null
        const backup = async (f: string): Promise<void> => {
          if (!existsSync(f)) return
          backupDir = backupDir ?? join(outDir, '_backup', stamp)
          const dst = join(backupDir, relative(outDir, f))
          await fs.mkdir(dirname(dst), { recursive: true })
          await fs.copyFile(f, dst)
        }
        const pages: SpineExportResult['pages'] = []
        for (const p of parsed.atlas.pages) {
          const c = composed.get(p.name)
          if (!c) continue
          const target = targets.get(p.name)
          if (!target) continue
          await fs.mkdir(dirname(target), { recursive: true })
          await backup(target)
          await savePage(c.image, target)
          pages.push({ name: relative(outDir, target).replace(/\\/g, '/'), regions: c.regions, kept: parsed.atlas.regions.filter((r) => r.page === p.name).length - c.regions })
        }
        const atlasOut = join(outDir, basename(l.spine.atlas.path))
        await backup(atlasOut)
        await fs.copyFile(l.spine.atlas.path, atlasOut)
        const skelName = basename(l.spine.skeleton.path)
        const skelOut = join(outDir, skelName)
        await backup(skelOut)
        const rigChanged = !rigIsEmpty(l.spine.rig)
        if (rigChanged) {
          await fs.writeFile(skelOut, riggedSkeleton(parsed, l.spine.rig))
          const ext = extname(skelName)
          const origOut = join(outDir, `${skelName.slice(0, skelName.length - ext.length)}.original${ext}`)
          await backup(origOut)
          await fs.copyFile(l.spine.skeleton.path, origOut)
        } else await fs.copyFile(l.spine.skeleton.path, skelOut)
        l.spine.exportDir = outDirRaw.trim() || l.spine.exportDir
        l.spine.lastExport = { at: Date.now(), pages: pages.length, regions: total }
        await this.save(l)
        this.deps.log(`spine export ${rel}: ${pages.length} page(s), ${total} region(s), rig ${rigChanged ? 'changed' : 'unchanged'}`)
        return { ok: true, outDir, pages, skeleton: skelName, rigChanged, backupDir, error: null }
      } catch (e) {
        this.deps.log(`spine export failed: ${(e as Error).message}`)
        return fail((e as Error).message)
      }
    })
  }
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '')
const ss = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

export function registerSpineIpc(ipcMain: IpcMain, getWindow: () => BrowserWindow | null, service: SpineService): void {
  ipcMain.handle(SPINE_IPC.open, (_e, rel: unknown) => service.open(s(rel)))
  ipcMain.handle(SPINE_IPC.importDialog, (_e, rel: unknown) => service.importDialog(s(rel), getWindow()))
  ipcMain.handle(SPINE_IPC.importPaths, (_e, rel: unknown, paths: unknown) => service.importPaths(s(rel), ss(paths)))
  ipcMain.handle(SPINE_IPC.clear, (_e, rel: unknown) => service.clear(s(rel)))
  ipcMain.handle(SPINE_IPC.assets, (_e, rel: unknown, which: unknown) => service.assets(s(rel), which === 'new' ? 'new' : 'orig'))
  ipcMain.handle(SPINE_IPC.setStyle, (_e, rel: unknown, patch: unknown) => service.setStyle(s(rel), o(patch) as Partial<SpriteStyle>))
  ipcMain.handle(SPINE_IPC.addRefs, (_e, rel: unknown) => service.addRefs(s(rel), getWindow()))
  ipcMain.handle(SPINE_IPC.enqueue, (_e, rel: unknown, keys: unknown, note: unknown) => service.enqueue(s(rel), ss(keys), typeof note === 'string' ? note : undefined))
  ipcMain.handle(SPINE_IPC.review, (_e, rel: unknown, patch: unknown) => service.review(s(rel), o(patch) as Record<string, SpineRegionPatch>))
  ipcMain.handle(SPINE_IPC.setRig, (_e, rel: unknown, rig: unknown) => service.setRig(s(rel), o(rig) as unknown as SpineRig))
  ipcMain.handle(SPINE_IPC.exportRun, (_e, rel: unknown, outDir: unknown) => service.exportRun(s(rel), s(outDir)))
  ipcMain.handle(SPINE_IPC.exportDir, (_e, rel: unknown) => service.pickExportDir(s(rel), getWindow()))
}
