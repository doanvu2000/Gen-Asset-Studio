import { randomBytes } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import sharp from 'sharp'
import type { BrowserWindow, IpcMain } from 'electron'
import {
  DEFAULT_SPRITE_SETTINGS,
  DIRECTIONS,
  ROW_PRESETS,
  SPRITE_GEN_IPC,
  SPRITE_IPC,
  type AtlasFormat,
  type Direction,
  type DirSet,
  type FrameRect,
  type GridSpec,
  type LoopMode,
  type ParsedAtlas,
  type RowPreset,
  type SheetPatch,
  type SheetStatus,
  type SheetView,
  type SpriteAddResult,
  type SpriteAnim,
  type SpriteProjectView,
  type SpriteSettings,
  type SpriteSkipped,
  type SpriteExportResult,
  type CreateSheetResult,
  type NewSheetSpec,
  type PickedImage,
  type SheetOrigin,
  type SheetSnippets,
  NEW_MAX_FRAMES,
  type SpriteStripPatch,
  type SpriteStyle,
  type StripVersion,
  type StripView,
  type ViewAngle
} from '@shared/sprite'
import type { JobSpec } from '@shared/queue'
import type { StyleTemplate } from '@shared/style'
import { decisionAt, autoLockKey, buildStripDefs, composeSheet, frameSizes, listStripVersions, origStrip, readStripMeta, sheetOutName, stripVersions, versionPath, type ExportPiece, type StripDef, type StripReviewEntry } from './strips'
import { savePng } from './strip'
import { atlasJson, buildSnippets, snippetsMarkdown } from './snippets'
import { ensureThumb, pathKey, type ProjectFile } from '../workspace/project'
import { hashFile } from '../workspace/analyze'
import { fileUrl } from '../workspace/protocol'
import { atlasImageName, isAtlasFile, parseAtlas } from './atlas'
import { detectGrid, emptyCells, gridFrames, makeGrid } from './grid'
import { animId, animsFromGrid, animsFromNames, animsFromTags } from './anims'

export interface SheetRecord {
  id: string
  path: string
  w: number
  h: number
  size: number
  mtime: number
  hash: string
  atlasPath: string | null
  format: AtlasFormat
  grid: GridSpec | null
  frames: FrameRect[]
  empty: number[]
  anims: SpriteAnim[]
  warnings: string[]
  animsAuto: boolean
  origin: SheetOrigin
  character: string | null
  description: string
  cell: number
}

export interface SpriteData {
  settings: SpriteSettings
  sheets: SheetRecord[]
  style: SpriteStyle
  review: Record<string, StripReviewEntry>
  lockKey: string | null
  exportDir: string
  lastExport: { at: number; sheets: number; frames: number } | null
}

export interface SpriteDeps {
  projectDir: (rel: string) => string
  run: <T>(fn: () => Promise<T>) => Promise<T>
  allow: (abs: string) => void
  log: (message: string) => void
  readProject: (dir: string) => Promise<ProjectFile>
  writeProject: (dir: string, data: ProjectFile) => Promise<void>
  enqueue?: () => ((specs: JobSpec[]) => string[]) | null
  template?: (id: string) => Promise<StyleTemplate | null>
}

const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])
const FORMATS: readonly AtlasFormat[] = ['tp-hash', 'tp-array', 'aseprite', 'plist', 'unity', 'grid']
const ALL_DIRS: readonly Direction[] = DIRECTIONS[8]
const LOOPS: readonly LoopMode[] = ['loop', 'pingpong', 'once']
const VIEWS: readonly ViewAngle[] = ['topdown', 'iso', 'side']
const PRESETS: readonly RowPreset[] = ['flame', 'rpgmaker', 'custom']
const MAX_FRAMES = 4096

function num(v: unknown, d = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}

function int(v: unknown, d: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(num(v, d))))
}

function newId(): string {
  return `s_${randomBytes(5).toString('hex')}`
}

function isImage(p: string): boolean {
  return IMAGE_EXTS.has(extname(p).toLowerCase())
}

export function sanitizeSettings(raw: unknown, base: SpriteSettings = DEFAULT_SPRITE_SETTINGS): SpriteSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const dirSet: DirSet = r.dirSet === 0 || r.dirSet === 4 || r.dirSet === 6 || r.dirSet === 8 ? r.dirSet : base.dirSet
  const rowPreset: RowPreset = PRESETS.includes(r.rowPreset as RowPreset) ? (r.rowPreset as RowPreset) : base.rowPreset
  let rowOrder: Direction[] = base.rowOrder
  if (Array.isArray(r.rowOrder)) rowOrder = r.rowOrder.filter((d): d is Direction => ALL_DIRS.includes(d as Direction))
  if (dirSet) {
    const set = DIRECTIONS[dirSet]
    const valid = rowOrder.length === set.length && set.every((d) => rowOrder.includes(d))
    if (rowPreset !== 'custom') rowOrder = ROW_PRESETS[rowPreset][dirSet]
    else if (!valid) rowOrder = set
  } else rowOrder = []
  return {
    dirSet,
    rowPreset,
    rowOrder: [...rowOrder],
    view: VIEWS.includes(r.view as ViewAngle) ? (r.view as ViewAngle) : base.view,
    mirror: typeof r.mirror === 'boolean' ? r.mirror : base.mirror,
    cell: r.cell === 64 || r.cell === 128 || r.cell === 256 ? r.cell : base.cell
  }
}

function sanitizeGrid(raw: unknown, w: number, h: number): GridSpec | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const W = Math.max(1, w || 16384)
  const H = Math.max(1, h || 16384)
  const cellW = int(r.cellW, 0, 1, W)
  const cellH = int(r.cellH, 0, 1, H)
  if (!cellW || !cellH) return null
  const offsetX = int(r.offsetX, 0, 0, W - 1)
  const offsetY = int(r.offsetY, 0, 0, H - 1)
  const gapX = int(r.gapX, 0, 0, W)
  const gapY = int(r.gapY, 0, 0, H)
  const maxCols = Math.max(1, Math.floor((W - offsetX + gapX) / (cellW + gapX)))
  const maxRows = Math.max(1, Math.floor((H - offsetY + gapY) / (cellH + gapY)))
  const cols = int(r.cols, maxCols, 1, maxCols)
  const rows = int(r.rows, maxRows, 1, maxRows)
  if (cols * rows > MAX_FRAMES) return null
  return { cellW, cellH, cols, rows, offsetX, offsetY, gapX, gapY }
}

function sanitizeFrame(raw: unknown): FrameRect | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const w = num(r.w)
  const h = num(r.h)
  if (w <= 0 || h <= 0) return null
  return {
    name: typeof r.name === 'string' ? r.name.slice(0, 200) : '',
    x: num(r.x),
    y: num(r.y),
    w,
    h,
    rotated: r.rotated === true,
    trimmed: r.trimmed === true,
    srcX: num(r.srcX),
    srcY: num(r.srcY),
    srcW: num(r.srcW, w),
    srcH: num(r.srcH, h),
    pivotX: num(r.pivotX, 0.5),
    pivotY: num(r.pivotY, 1)
  }
}

export function sanitizeAnims(raw: unknown, frameCount: number): SpriteAnim[] {
  if (!Array.isArray(raw)) return []
  const taken = new Set<string>()
  const out: SpriteAnim[] = []
  for (const a of raw.slice(0, 512)) {
    if (!a || typeof a !== 'object') continue
    const r = a as Record<string, unknown>
    const name = typeof r.name === 'string' && r.name.trim() ? r.name.trim().slice(0, 60) : 'anim'
    const dir = ALL_DIRS.includes(r.dir as Direction) ? (r.dir as Direction) : null
    const frames = (Array.isArray(r.frames) ? r.frames : [])
      .filter((i): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < frameCount)
      .slice(0, 1024)
    let id = typeof r.id === 'string' && /^[a-z0-9_-]{1,64}$/i.test(r.id) && !taken.has(r.id) ? r.id : ''
    if (id) taken.add(id)
    else id = animId(name, dir, taken)
    out.push({
      id,
      name,
      dir,
      frames,
      fps: int(r.fps, 10, 1, 60),
      loop: LOOPS.includes(r.loop as LoopMode) ? (r.loop as LoopMode) : 'loop'
    })
  }
  return out
}

function sanitizeSheet(raw: unknown): SheetRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.path !== 'string' || !r.path) return null
  const w = num(r.w)
  const h = num(r.h)
  const format = FORMATS.includes(r.format as AtlasFormat) ? (r.format as AtlasFormat) : 'grid'
  const grid = sanitizeGrid(r.grid, w, h)
  const stored = Array.isArray(r.frames) ? r.frames.map(sanitizeFrame).filter((f): f is FrameRect => !!f).slice(0, MAX_FRAMES) : []
  const frames = format === 'grid' && !stored.length && grid ? gridFrames(grid) : stored
  return {
    id: typeof r.id === 'string' && /^[a-z0-9_-]{1,64}$/i.test(r.id) ? r.id : newId(),
    path: r.path,
    w,
    h,
    size: num(r.size),
    mtime: num(r.mtime),
    hash: typeof r.hash === 'string' ? r.hash : '',
    atlasPath: typeof r.atlasPath === 'string' && r.atlasPath ? r.atlasPath : null,
    format,
    grid: format === 'grid' ? (grid ?? (w && h ? makeGrid(w, h, w, h) : null)) : grid,
    frames,
    empty: Array.isArray(r.empty) ? r.empty.filter((i): i is number => typeof i === 'number' && Number.isInteger(i) && i >= 0 && i < frames.length) : [],
    anims: sanitizeAnims(r.anims, frames.length),
    warnings: Array.isArray(r.warnings) ? r.warnings.filter((x): x is string => typeof x === 'string').slice(0, 20) : [],
    animsAuto: r.animsAuto !== false,
    origin: r.origin === 'new' ? 'new' : 'import',
    character: typeof r.character === 'string' && r.character ? r.character : null,
    description: typeof r.description === 'string' ? r.description.slice(0, 2000) : '',
    cell: num(r.cell, 128)
  }
}

function relRef(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null
  const c = v.replace(/\\/g, '/')
  return c.split('/').some((p) => p === '..') || /^[a-z]:/i.test(c) || c.startsWith('/') ? null : c
}

function sanitizeStyle(raw: unknown): SpriteStyle {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  return {
    promptEn: typeof r.promptEn === 'string' ? r.promptEn.slice(0, 6000) : '',
    templateId: typeof r.templateId === 'string' && r.templateId ? r.templateId.slice(0, 120) : null,
    refImages: (Array.isArray(r.refImages) ? r.refImages : []).map(relRef).filter((x): x is string => !!x).slice(0, 8),
    notes: typeof r.notes === 'string' ? r.notes.slice(0, 4000) : '',
    locked: r.locked === true,
    lockedAt: num(r.lockedAt)
  }
}

function sanitizeReview(raw: unknown): Record<string, StripReviewEntry> {
  const out: Record<string, StripReviewEntry> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!/^[a-z0-9_-]{1,64}:[a-z0-9_-]{1,64}$/i.test(k) || !v || typeof v !== 'object') continue
    const e = v as Record<string, unknown>
    out[k] = { decision: e.decision === 'approved' || e.decision === 'rejected' ? e.decision : null, selected: int(e.selected, 0, 0, 100000), version: int(e.version, 0, 0, 100000) }
  }
  return out
}

export function readSpriteData(data: ProjectFile): SpriteData {
  const raw = data.sprite && typeof data.sprite === 'object' ? (data.sprite as Record<string, unknown>) : {}
  const settings = sanitizeSettings(raw.settings)
  const seen = new Set<string>()
  const sheets: SheetRecord[] = []
  for (const s of Array.isArray(raw.sheets) ? raw.sheets : []) {
    const rec = sanitizeSheet(s)
    if (!rec) continue
    const k = pathKey(rec.path)
    if (seen.has(k)) continue
    seen.add(k)
    while (sheets.some((x) => x.id === rec.id)) rec.id = newId()
    sheets.push(rec)
  }
  const last = raw.lastExport && typeof raw.lastExport === 'object' ? (raw.lastExport as Record<string, unknown>) : null
  return {
    settings,
    sheets,
    style: sanitizeStyle(raw.style),
    review: sanitizeReview(raw.review),
    lockKey: typeof raw.lockKey === 'string' && raw.lockKey ? raw.lockKey : null,
    exportDir: typeof raw.exportDir === 'string' ? raw.exportDir.slice(0, 1024) : '',
    lastExport: last ? { at: num(last.at), sheets: num(last.sheets), frames: num(last.frames) } : null
  }
}

function writeSpriteData(data: ProjectFile, sprite: SpriteData): void {
  data.sprite = {
    settings: sprite.settings,
    sheets: sprite.sheets,
    style: sprite.style,
    review: sprite.review,
    lockKey: sprite.lockKey,
    exportDir: sprite.exportDir,
    lastExport: sprite.lastExport
  }
}

async function readText(p: string): Promise<string> {
  return fs.readFile(p, 'utf8')
}

function sidecars(image: string): string[] {
  const dir = dirname(image)
  const base = basename(image, extname(image))
  return [join(dir, `${base}.json`), join(dir, `${base}.plist`), `${image}.meta`]
}

async function imageForAtlas(atlas: string, text: string): Promise<string | null> {
  const dir = dirname(atlas)
  const named = atlasImageName(atlas, text)
  if (named) {
    const p = resolve(dir, named)
    if (existsSync(p) && isImage(p)) return p
    const alt = join(dir, basename(named))
    if (existsSync(alt) && isImage(alt)) return alt
  }
  const stem = atlas.toLowerCase().endsWith('.meta') ? atlas.slice(0, -5) : join(dir, basename(atlas, extname(atlas)))
  if (isImage(stem) && existsSync(stem)) return stem
  for (const ext of IMAGE_EXTS) {
    const p = `${stem}${ext}`
    if (existsSync(p)) return p
  }
  return null
}

function autoAnims(rec: SheetRecord, settings: SpriteSettings, parsed?: ParsedAtlas): SpriteAnim[] {
  if (rec.format === 'grid' && rec.grid) return animsFromGrid(rec.grid, rec.empty, settings)
  if (parsed?.tags.length) return animsFromTags(parsed.tags, rec.frames.length)
  return animsFromNames(rec.frames)
}

export class SpriteService {
  constructor(private readonly deps: SpriteDeps) {}

  private async load(rel: string): Promise<{ dir: string; data: ProjectFile; sprite: SpriteData }> {
    const dir = this.deps.projectDir(rel)
    const data = await this.deps.readProject(dir)
    return { dir, data, sprite: readSpriteData(data) }
  }

  private async save(dir: string, data: ProjectFile, sprite: SpriteData): Promise<void> {
    writeSpriteData(data, sprite)
    await this.deps.writeProject(dir, data)
  }

  private async status(rec: SheetRecord): Promise<{ status: SheetStatus; dirty: boolean }> {
    try {
      const st = await fs.stat(rec.path)
      if (!st.isFile()) return { status: 'missing', dirty: false }
      if (st.size === rec.size && Math.round(st.mtimeMs) === rec.mtime) return { status: 'ok', dirty: false }
      const h = await hashFile(rec.path)
      if (h !== rec.hash) return { status: 'changed', dirty: false }
      rec.size = st.size
      rec.mtime = Math.round(st.mtimeMs)
      return { status: 'ok', dirty: true }
    } catch {
      return { status: 'missing', dirty: false }
    }
  }

  private async view(rel: string, dir: string, data: ProjectFile, sprite: SpriteData, forceWrite = false): Promise<SpriteProjectView> {
    let dirty = forceWrite
    const sheets: SheetView[] = []
    for (const rec of sprite.sheets) {
      const s = await this.status(rec)
      if (s.dirty) dirty = true
      const thumb = s.status === 'missing' ? null : await ensureThumb(dir, rec.path, rec.hash)
      this.deps.allow(rec.path)
      sheets.push({
        id: rec.id,
        name: basename(rec.path),
        path: rec.path,
        url: fileUrl(rec.path, `${rec.mtime}`),
        thumb: thumb ? fileUrl(thumb, rec.hash) : null,
        w: rec.w,
        h: rec.h,
        size: rec.size,
        status: s.status,
        atlasPath: rec.atlasPath,
        atlasName: rec.atlasPath ? basename(rec.atlasPath) : null,
        format: rec.format,
        grid: rec.grid,
        frames: rec.frames,
        empty: rec.empty,
        anims: rec.anims,
        warnings: rec.warnings,
        origin: rec.origin,
        characterUrl: this.characterUrl(dir, rec),
        description: rec.description
      })
    }
    if (dirty) await this.save(dir, data, sprite)
    const defs = this.defs(sprite, sheets)
    const strips: StripView[] = []
    for (const d of defs) strips.push(await this.stripView(dir, d, sprite))
    for (const st of strips) {
      if (!st.mirrorOf) continue
      const src = strips.find((x) => x.key === st.mirrorOf)
      if (!src) continue
      st.versions = src.versions
      st.selected = src.selected
      st.url = src.url
      st.decision = src.decision
      st.qa = src.qa
    }
    return {
      rel,
      name: basename(dir),
      dir,
      kind: 'sprite',
      settings: sprite.settings,
      sheets,
      style: { ...sprite.style, refImages: sprite.style.refImages.filter((r) => existsSync(join(dir, r))) },
      strips,
      lockKey: this.lockOf(sprite, defs),
      export: { outDir: sprite.exportDir, lastAt: sprite.lastExport?.at ?? 0, lastSheets: sprite.lastExport?.sheets ?? 0, lastFrames: sprite.lastExport?.frames ?? 0 },
      updatedAt: Date.parse(data.updatedAt) || 0
    }
  }

  private defs(sprite: SpriteData, views?: SheetView[]): StripDef[] {
    const ok = new Set((views ?? []).filter((v) => v.status !== 'missing').map((v) => v.id))
    return buildStripDefs(
      sprite.sheets.filter((s) => !views || ok.has(s.id)),
      sprite.settings
    )
  }

  private lockOf(sprite: SpriteData, defs: StripDef[]): string | null {
    if (sprite.lockKey && defs.some((d) => d.key === sprite.lockKey && !d.mirrorOf)) return sprite.lockKey
    return autoLockKey(defs)
  }

  private async stripView(dir: string, d: StripDef, sprite: SpriteData): Promise<StripView> {
    const versions = await listStripVersions(dir, d.assetRel)
    const entry = sprite.review[d.key]
    const last = versions.length ? versions[versions.length - 1] : 0
    const selected = entry?.selected && versions.includes(entry.selected) ? entry.selected : last
    const orig = await origStrip(dir, d).catch(() => null)
    const meta = selected ? await readStripMeta(dir, d.assetRel, selected) : null
    return {
      key: d.key,
      assetRel: d.assetRel,
      sheetId: d.sheet.id,
      sheetName: basename(d.sheet.path),
      animId: d.anim.id,
      anim: d.anim.name,
      dir: d.anim.dir,
      frameCount: d.frames.length,
      frameSizes: frameSizes(d.frames),
      origUrl: d.sheet.origin === 'new' ? null : orig ? fileUrl(orig, basename(orig)) : null,
      mirrorOf: d.mirrorOf,
      versions,
      selected,
      url: selected ? fileUrl(versionPath(dir, d.assetRel, selected), `${selected}`) : null,
      decision: decisionAt(entry, selected),
      qa: meta?.qa ?? null,
      created: d.sheet.origin === 'new',
      refUrl: d.sheet.origin === 'new' ? this.characterUrl(dir, d.sheet as SheetRecord) : null
    }
  }

  private characterPath(dir: string, rec: Pick<SheetRecord, 'character'>): string | null {
    if (!rec.character) return null
    const p = join(dir, rec.character)
    return existsSync(p) ? p : null
  }

  private characterUrl(dir: string, rec: Pick<SheetRecord, 'character'>): string | null {
    const p = this.characterPath(dir, rec)
    if (!p) return null
    this.deps.allow(p)
    return fileUrl(p, rec.character ?? '')
  }

  async pickCharacter(win: BrowserWindow | null): Promise<PickedImage | null> {
    const { dialog } = await import('electron')
    const opts: Electron.OpenDialogOptions = { properties: ['openFile', 'dontAddToRecent'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths.length) return null
    const p = resolve(r.filePaths[0])
    const meta = await sharp(p).metadata()
    if (!meta.width || !meta.height) return null
    this.deps.allow(p)
    return { path: p, url: fileUrl(p, String(Date.now())), w: meta.width, h: meta.height }
  }

  createSheet(rel: string, spec: NewSheetSpec): Promise<CreateSheetResult> {
    return this.deps.run(async () => {
      try {
        const { dir, data, sprite } = await this.load(rel)
        const src = typeof spec?.character === 'string' ? spec.character : ''
        if (!src || !existsSync(src)) return { view: null, sheetId: null, error: 'noCharacter' }
        const cell = spec.cell === 64 || spec.cell === 256 ? spec.cell : 128
        const seen = new Set<string>()
        const anims = (Array.isArray(spec.anims) ? spec.anims : [])
          .map((a) => ({ name: String(a?.name ?? '').trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').slice(0, 30), frames: int(a?.frames, 4, 2, NEW_MAX_FRAMES) }))
          .filter((a) => a.name && !seen.has(a.name) && seen.add(a.name))
          .slice(0, 12)
        if (!anims.length) return { view: null, sheetId: null, error: 'noAnims' }
        const slug = (String(spec.name ?? '').trim().replace(/.png$/i, '').replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '') || 'character').slice(0, 60)
        const genDir = join(dir, 'generated')
        await fs.mkdir(genDir, { recursive: true })
        let name = `${slug}.png`
        for (let n = 2; existsSync(join(genDir, name)) || sprite.sheets.some((x) => basename(x.path).toLowerCase() === name.toLowerCase()); n++) name = `${slug}_${n}.png`
        const dirs: Array<Direction | null> = sprite.settings.dirSet ? (sprite.settings.rowOrder.length ? sprite.settings.rowOrder : DIRECTIONS[sprite.settings.dirSet]) : [null]
        const cols = Math.max(...anims.map((a) => a.frames))
        const rows = anims.length * dirs.length
        const grid: GridSpec = { cellW: cell, cellH: cell, cols, rows, offsetX: 0, offsetY: 0, gapX: 0, gapY: 0 }
        const frames = gridFrames(grid)
        const out: SpriteAnim[] = []
        const empty: number[] = []
        const taken = new Set<string>()
        let r = 0
        for (const a of anims) {
          for (const d of dirs) {
            const idx = Array.from({ length: a.frames }, (_, c) => r * cols + c)
            for (let c = a.frames; c < cols; c++) empty.push(r * cols + c)
            idx.forEach((i, k) => (frames[i].name = `${a.name}${d ? `_${d}` : ''}_${String(k).padStart(2, '0')}`))
            out.push({
              id: animId(a.name, d, taken),
              name: a.name,
              dir: d,
              frames: idx,
              fps: /idle/.test(a.name) ? 6 : /run|attack/.test(a.name) ? 12 : /die/.test(a.name) ? 8 : 10,
              loop: /attack|hurt|die/.test(a.name) ? 'once' : 'loop'
            })
            r++
          }
        }
        const path = join(genDir, name)
        await sharp({ create: { width: cols * cell, height: rows * cell, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toFile(path)
        const charDir = join(dir, 'styles', 'sprite')
        await fs.mkdir(charDir, { recursive: true })
        const charRel = `styles/sprite/character_${name.replace(/\.png$/i, '')}.png`
        await sharp(src).png().toFile(join(dir, charRel))
        const st = await fs.stat(path)
        const rec: SheetRecord = {
          id: newId(),
          path,
          w: cols * cell,
          h: rows * cell,
          size: st.size,
          mtime: Math.round(st.mtimeMs),
          hash: await hashFile(path),
          atlasPath: null,
          format: 'grid',
          grid,
          frames,
          empty,
          anims: out,
          warnings: [],
          animsAuto: false,
          origin: 'new',
          character: charRel,
          description: typeof spec.description === 'string' ? spec.description.trim().slice(0, 2000) : '',
          cell
        }
        sprite.sheets.push(rec)
        this.deps.log(`sprite ${rel}: created sheet ${name} ${cols}x${rows} cell ${cell}`)
        const view = await this.view(rel, dir, data, sprite, true)
        return { view, sheetId: rec.id, error: null }
      } catch (e) {
        this.deps.log(`sprite create sheet failed: ${(e as Error).message}`)
        return { view: null, sheetId: null, error: (e as Error).message }
      }
    })
  }

  snippets(rel: string, sheetId: string): Promise<SheetSnippets | null> {
    return this.deps.run(async () => {
      try {
        const { sprite } = await this.load(rel)
        const rec = sprite.sheets.find((x) => x.id === sheetId)
        if (!rec || !rec.grid) return null
        return buildSnippets({ image: basename(rec.path), w: rec.w, h: rec.h, grid: rec.grid, frames: rec.frames, anims: rec.anims })
      } catch {
        return null
      }
    })
  }

  private async mutateView(rel: string, fn: (ctx: { dir: string; data: ProjectFile; sprite: SpriteData }) => Promise<void> | void, what: string): Promise<SpriteProjectView | null> {
    return this.deps.run(async () => {
      try {
        const ctx = await this.load(rel)
        await fn(ctx)
        return await this.view(rel, ctx.dir, ctx.data, ctx.sprite, true)
      } catch (e) {
        this.deps.log(`sprite ${what} failed: ${(e as Error).message}`)
        return null
      }
    })
  }

  setStyle(rel: string, patch: Partial<SpriteStyle>): Promise<SpriteProjectView | null> {
    return this.mutateView(
      rel,
      ({ sprite }) => {
        const p = patch && typeof patch === 'object' ? patch : {}
        const next = sanitizeStyle({ ...sprite.style, ...p })
        if (p.locked === true && !sprite.style.locked) next.lockedAt = Date.now()
        if (p.locked === false) next.lockedAt = 0
        sprite.style = next
      },
      'set style'
    )
  }

  async addRefs(rel: string, win: BrowserWindow | null): Promise<SpriteProjectView | null> {
    const { dialog } = await import('electron')
    const opts: Electron.OpenDialogOptions = { properties: ['openFile', 'multiSelections', 'dontAddToRecent'], filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths.length) return null
    return this.mutateView(
      rel,
      async ({ dir, sprite }) => {
        const refDir = join(dir, 'styles', 'sprite', 'refs')
        await fs.mkdir(refDir, { recursive: true })
        for (const src of r.filePaths.slice(0, 8)) {
          if (sprite.style.refImages.length >= 8) break
          const base = (basename(src).replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40) || 'ref').toLowerCase()
          let name = `${base}.png`
          for (let n = 2; existsSync(join(refDir, name)); n++) name = `${base}-${n}.png`
          await sharp(src).png().toFile(join(refDir, name))
          sprite.style.refImages.push(`styles/sprite/refs/${name}`)
        }
      },
      'add refs'
    )
  }

  setLock(rel: string, key: string | null): Promise<SpriteProjectView | null> {
    return this.mutateView(
      rel,
      ({ sprite }) => {
        sprite.lockKey = typeof key === 'string' && key ? key : null
      },
      'set lock'
    )
  }

  review(rel: string, patch: Record<string, SpriteStripPatch>): Promise<SpriteProjectView | null> {
    return this.mutateView(
      rel,
      async ({ dir, sprite }) => {
        const defs = this.defs(sprite)
        for (const [k, v] of Object.entries(patch && typeof patch === 'object' ? patch : {})) {
          if (!/^[a-z0-9_-]{1,64}:[a-z0-9_-]{1,64}$/i.test(k) || !v || typeof v !== 'object') continue
          const cur = sprite.review[k] ?? { decision: null, selected: 0 }
          const def = defs.find((d) => d.key === k)
          const versions = def ? await listStripVersions(dir, def.assetRel) : []
          if (v.decision !== undefined) cur.decision = v.decision === 'approved' || v.decision === 'rejected' ? v.decision : null
          if (v.selected !== undefined) {
            cur.selected = int(v.selected, 0, 0, 100000)
            if (v.decision === undefined) cur.decision = null
          }
          cur.version = cur.selected && versions.includes(cur.selected) ? cur.selected : (versions[versions.length - 1] ?? 0)
          sprite.review[k] = cur
        }
      },
      'review'
    )
  }

  versions(rel: string, key: string): Promise<StripVersion[]> {
    return this.deps.run(async () => {
      try {
        const { dir, sprite } = await this.load(rel)
        const defs = this.defs(sprite)
        const d0 = defs.find((x) => x.key === key)
        if (!d0) return []
        const d = d0.mirrorOf ? (defs.find((x) => x.key === d0.mirrorOf) ?? d0) : d0
        const v = await stripVersions(dir, d.assetRel)
        for (const x of v) this.deps.allow(versionPath(dir, d.assetRel, x.version))
        return v
      } catch (e) {
        this.deps.log(`sprite versions failed: ${(e as Error).message}`)
        return []
      }
    })
  }

  enqueue(rel: string, keys: string[], note?: string): Promise<number> {
    return this.deps.run(async () => {
      const push = this.deps.enqueue?.()
      if (!push) return 0
      const { dir, sprite } = await this.load(rel)
      if (!sprite.style.locked) return -1
      const defs = this.defs(sprite)
      const lockKey = this.lockOf(sprite, defs)
      const lockDef = defs.find((d) => d.key === lockKey)
      let lockImages: string[] = []
      if (lockDef) {
        const versions = await listStripVersions(dir, lockDef.assetRel)
        const sel = sprite.review[lockDef.key]?.selected
        const v = sel && versions.includes(sel) ? sel : versions[versions.length - 1]
        if (v && decisionAt(sprite.review[lockDef.key], v) === 'approved') lockImages = [versionPath(dir, lockDef.assetRel, v)]
      }
      let styleImages: string[] = []
      let prompt = sprite.style.promptEn
      if (sprite.style.templateId && this.deps.template) {
        const tpl = await this.deps.template(sprite.style.templateId).catch(() => null)
        const preview = tpl ? (tpl.previewSmPath ?? tpl.previewPath) : null
        if (preview) styleImages = [preview]
        if (!prompt.trim() && tpl) prompt = tpl.promptEn
      }
      const refImages = sprite.style.refImages.map((r) => join(dir, r)).filter((p) => existsSync(p))
      const notes = [sprite.style.notes.trim(), (note ?? '').trim()].filter(Boolean).join('\n')
      const specs: JobSpec[] = []
      for (const key of keys) {
        const d = defs.find((x) => x.key === key)
        if (!d || d.mirrorOf) continue
        specs.push({
          projectPath: dir,
          assetRelPath: d.assetRel,
          sourcePath: d.sheet.path,
          groupId: 'sprite',
          stylePrompt: prompt,
          styleImages,
          refImages,
          note: notes || undefined,
          sprite: {
            sheetId: d.sheet.id,
            animId: d.anim.id,
            anim: d.anim.name,
            dir: d.anim.dir,
            view: sprite.settings.view,
            frames: d.frames,
            lockImages: d.key === lockKey ? [] : lockImages,
            ...(d.sheet.origin === 'new' && this.characterPath(dir, d.sheet as SheetRecord)
              ? { create: { character: this.characterPath(dir, d.sheet as SheetRecord) as string, description: (d.sheet as SheetRecord).description, cell: (d.sheet as SheetRecord).cell } }
              : {})
          }
        })
      }
      if (!specs.length) return 0
      push(specs)
      this.deps.log(`sprite ${rel}: enqueued ${specs.length} strip(s)`)
      return specs.length
    })
  }

  async pickExportDir(rel: string, win: BrowserWindow | null): Promise<string | null> {
    const { dialog } = await import('electron')
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory', 'dontAddToRecent'] }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths.length) return null
    const picked = r.filePaths[0]
    await this.mutateView(
      rel,
      ({ sprite }) => {
        sprite.exportDir = picked
      },
      'export dir'
    )
    return picked
  }

  exportRun(rel: string, outDirRaw: string): Promise<SpriteExportResult> {
    return this.deps.run(async () => {
      const fail = (error: string, outDir = ''): SpriteExportResult => ({ ok: false, outDir, sheets: [], backupDir: null, error })
      try {
        const { dir, data, sprite } = await this.load(rel)
        const outDir = resolve(dir, outDirRaw.trim() || sprite.exportDir || 'output')
        const defs = this.defs(sprite)
        const byKey = new Map(defs.map((d) => [d.key, d]))
        const pickVersion = async (d: StripDef): Promise<string | null> => {
          const e = sprite.review[d.key]
          const versions = await listStripVersions(dir, d.assetRel)
          const v = e?.selected && versions.includes(e.selected) ? e.selected : versions[versions.length - 1]
          return v && decisionAt(e, v) === 'approved' ? versionPath(dir, d.assetRel, v) : null
        }
        const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15)
        let backupDir: string | null = null
        const result: SpriteExportResult['sheets'] = []
        for (const rec of sprite.sheets) {
          if (!existsSync(rec.path)) continue
          if (pathKey(dirname(rec.path)) === pathKey(outDir)) return fail('outIsSource', outDir)
          const pieces: ExportPiece[] = []
          for (const d of defs.filter((x) => x.sheet.id === rec.id)) {
            const src = d.mirrorOf ? byKey.get(d.mirrorOf) : d
            if (!src) continue
            const file = await pickVersion(src)
            if (!file) continue
            pieces.push({ def: d, file, flip: !!d.mirrorOf, sourceSizes: frameSizes(src.frames) })
          }
          if (!pieces.length) continue
          pieces.sort((a, b) => Number(!!a.def.mirrorOf) - Number(!!b.def.mirrorOf))
          const { image, replaced } = await composeSheet(rec.path, rec.frames, pieces)
          await fs.mkdir(outDir, { recursive: true })
          const name = sheetOutName(rec.path)
          const target = join(outDir, name)
          const extras = rec.atlasPath && existsSync(rec.atlasPath) ? [rec.atlasPath] : []
          for (const f of [target, ...extras.map((a) => join(outDir, basename(a)))]) {
            if (!existsSync(f)) continue
            backupDir = backupDir ?? join(outDir, '_backup', stamp)
            await fs.mkdir(backupDir, { recursive: true })
            await fs.copyFile(f, join(backupDir, basename(f)))
          }
          await savePng(image, target)
          let atlas: string | null = null
          for (const a of extras) {
            await fs.copyFile(a, join(outDir, basename(a)))
            atlas = basename(a)
          }
          const used = rec.anims.reduce((n, a) => n + a.frames.length, 0)
          let snippets: string | null = null
          if (rec.origin === 'new' && rec.grid) {
            const jsonName = name.replace(/\.png$/i, '.json')
            const mdName = name.replace(/\.png$/i, '-snippets.md')
            for (const f of [jsonName, mdName].map((n) => join(outDir, n))) {
              if (!existsSync(f)) continue
              backupDir = backupDir ?? join(outDir, '_backup', stamp)
              await fs.mkdir(backupDir, { recursive: true })
              await fs.copyFile(f, join(backupDir, basename(f)))
            }
            const sheet = { image: name, w: rec.w, h: rec.h, grid: rec.grid, frames: rec.frames, anims: rec.anims }
            await fs.writeFile(join(outDir, jsonName), atlasJson(sheet), 'utf8')
            await fs.writeFile(join(outDir, mdName), snippetsMarkdown(buildSnippets(sheet), name), 'utf8')
            atlas = jsonName
            snippets = join(outDir, mdName)
          }
          result.push({ name, file: target, frames: replaced, kept: Math.max(0, rec.frames.length - rec.empty.length - replaced), atlas, snippets })
          this.deps.log(`sprite export ${rel}: ${name} ${replaced}/${used} frame(s) replaced`)
        }
        if (!result.length) return fail('nothingApproved', outDir)
        sprite.exportDir = outDirRaw.trim() || sprite.exportDir
        sprite.lastExport = { at: Date.now(), sheets: result.length, frames: result.reduce((n, r) => n + r.frames, 0) }
        await this.save(dir, data, sprite)
        return { ok: true, outDir, sheets: result, backupDir, error: null }
      } catch (e) {
        this.deps.log(`sprite export failed: ${(e as Error).message}`)
        return fail((e as Error).message)
      }
    })
  }

  open(rel: string): Promise<SpriteProjectView | null> {
    return this.deps.run(async () => {
      try {
        const { dir, data, sprite } = await this.load(rel)
        return await this.view(rel, dir, data, sprite)
      } catch (e) {
        this.deps.log(`sprite open failed: ${(e as Error).message}`)
        return null
      }
    })
  }

  private async makeRecord(image: string, atlas: string | null, settings: SpriteSettings): Promise<SheetRecord> {
    const st = await fs.stat(image)
    const meta = await sharp(image).metadata()
    if (!meta.width || !meta.height) throw new Error('unreadable')
    const rec: SheetRecord = {
      id: newId(),
      path: resolve(image),
      w: meta.width,
      h: meta.height,
      size: st.size,
      mtime: Math.round(st.mtimeMs),
      hash: await hashFile(image),
      atlasPath: null,
      format: 'grid',
      grid: null,
      frames: [],
      empty: [],
      anims: [],
      warnings: [],
      animsAuto: true,
      origin: 'import',
      character: null,
      description: '',
      cell: 0
    }
    let parsed: ParsedAtlas | undefined
    if (atlas) {
      parsed = parseAtlas(atlas, await readText(atlas), rec.w, rec.h)
      rec.atlasPath = resolve(atlas)
      rec.format = parsed.format
      rec.frames = parsed.frames.slice(0, MAX_FRAMES)
      rec.warnings = parsed.warnings.slice(0, 20)
    } else {
      rec.grid = (await detectGrid(image)) ?? makeGrid(rec.w, rec.h, rec.w, rec.h)
      rec.frames = gridFrames(rec.grid)
    }
    rec.empty = await emptyCells(image, rec.frames)
    rec.anims = autoAnims(rec, settings, parsed)
    return rec
  }

  private async expand(paths: string[], skipped: SpriteSkipped[]): Promise<string[]> {
    const out: string[] = []
    for (const p of paths) {
      let st: import('node:fs').Stats
      try {
        st = await fs.stat(p)
      } catch {
        skipped.push({ name: basename(p), reason: 'unreadable' })
        continue
      }
      if (st.isDirectory()) {
        let names: string[] = []
        try {
          names = await fs.readdir(p)
        } catch {
          skipped.push({ name: basename(p), reason: 'unreadable' })
          continue
        }
        for (const n of names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
          const f = join(p, n)
          if (n.startsWith('.')) continue
          if (!(isImage(f) || isAtlasFile(f))) continue
          try {
            if ((await fs.stat(f)).isFile()) out.push(resolve(f))
          } catch {
            continue
          }
        }
      } else if (st.isFile()) out.push(resolve(p))
    }
    return out
  }

  addPaths(rel: string, paths: string[]): Promise<SpriteAddResult> {
    return this.deps.run(async () => {
      const { dir, data, sprite } = await this.load(rel)
      const skipped: SpriteSkipped[] = []
      const files = await this.expand(
        paths.filter((p) => typeof p === 'string' && p),
        skipped
      )
      const known = new Set(sprite.sheets.map((s) => pathKey(s.path)))
      const pairs = new Map<string, { image: string; atlas: string | null }>()
      const atlasFiles = files.filter((f) => isAtlasFile(f))
      const imageFiles = files.filter((f) => isImage(f))
      for (const f of files) if (!isAtlasFile(f) && !isImage(f)) skipped.push({ name: basename(f), reason: 'notPng' })
      for (const a of atlasFiles) {
        if (extname(a).toLowerCase() === '.atlas') {
          skipped.push({ name: basename(a), reason: 'badAtlas', detail: 'spine' })
          continue
        }
        let text: string
        try {
          text = await readText(a)
        } catch {
          skipped.push({ name: basename(a), reason: 'unreadable' })
          continue
        }
        const img = await imageForAtlas(a, text)
        if (!img) {
          skipped.push({ name: basename(a), reason: 'noImage' })
          continue
        }
        const k = pathKey(img)
        if (!pairs.has(k)) pairs.set(k, { image: img, atlas: a })
      }
      for (const img of imageFiles) {
        const k = pathKey(img)
        if (pairs.has(k)) continue
        const side = sidecars(img).find((s) => existsSync(s)) ?? null
        pairs.set(k, { image: img, atlas: side })
      }
      let added = 0
      for (const [k, pair] of pairs) {
        if (known.has(k)) {
          skipped.push({ name: basename(pair.image), reason: 'duplicate' })
          continue
        }
        try {
          let rec: SheetRecord
          try {
            rec = await this.makeRecord(pair.image, pair.atlas, sprite.settings)
          } catch (e) {
            if (!pair.atlas || (e as Error).message === 'unreadable') throw e
            skipped.push({ name: basename(pair.atlas), reason: 'badAtlas', detail: (e as Error).message })
            rec = await this.makeRecord(pair.image, null, sprite.settings)
          }
          sprite.sheets.push(rec)
          known.add(k)
          added++
        } catch (e) {
          const msg = (e as Error).message
          skipped.push({ name: basename(pair.image), reason: msg === 'unreadable' ? 'unreadable' : 'notPng', detail: msg })
        }
      }
      sprite.sheets.sort((a, b) => basename(a.path).localeCompare(basename(b.path), undefined, { numeric: true }))
      this.deps.log(`sprite ${rel}: +${added} sheet(s), ${skipped.length} skipped`)
      const view = await this.view(rel, dir, data, sprite, added > 0)
      return { view, added, skipped, canceled: false }
    })
  }

  async addFromDialog(rel: string, win: BrowserWindow | null): Promise<SpriteAddResult> {
    const { dialog } = await import('electron')
    const opts: Electron.OpenDialogOptions = {
      properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
      filters: [
        { name: 'Sprite sheet / atlas', extensions: ['png', 'jpg', 'jpeg', 'webp', 'json', 'plist', 'meta'] },
        { name: 'All files', extensions: ['*'] }
      ]
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    if (r.canceled || !r.filePaths.length) return { view: null, added: 0, skipped: [], canceled: true }
    return this.addPaths(rel, r.filePaths)
  }

  remove(rel: string, sheetId: string): Promise<SpriteProjectView | null> {
    return this.deps.run(async () => {
      try {
        const { dir, data, sprite } = await this.load(rel)
        sprite.sheets = sprite.sheets.filter((s) => s.id !== sheetId)
        return await this.view(rel, dir, data, sprite, true)
      } catch (e) {
        this.deps.log(`sprite remove failed: ${(e as Error).message}`)
        return null
      }
    })
  }

  updateSheet(rel: string, sheetId: string, patch: SheetPatch): Promise<SpriteProjectView | null> {
    return this.deps.run(async () => {
      try {
        const { dir, data, sprite } = await this.load(rel)
        const rec = sprite.sheets.find((s) => s.id === sheetId)
        if (!rec) return null
        const p = patch && typeof patch === 'object' ? patch : {}
        if (p.grid) {
          const g = sanitizeGrid(p.grid, rec.w, rec.h)
          if (g) {
            rec.grid = g
            rec.format = 'grid'
            rec.frames = gridFrames(g)
            rec.empty = existsSync(rec.path) ? await emptyCells(rec.path, rec.frames) : []
            if (rec.animsAuto) rec.anims = autoAnims(rec, sprite.settings)
            else rec.anims = sanitizeAnims(rec.anims, rec.frames.length)
          }
        }
        if (p.anims) {
          rec.anims = sanitizeAnims(p.anims, rec.frames.length)
          rec.animsAuto = false
        }
        if (p.autoAnims === true) {
          rec.animsAuto = true
          let parsed: ParsedAtlas | undefined
          if (rec.format !== 'grid' && rec.atlasPath && existsSync(rec.atlasPath)) {
            try {
              parsed = parseAtlas(rec.atlasPath, await readText(rec.atlasPath), rec.w, rec.h)
            } catch {
              parsed = undefined
            }
          }
          rec.anims = autoAnims(rec, sprite.settings, parsed)
        }
        return await this.view(rel, dir, data, sprite, true)
      } catch (e) {
        this.deps.log(`sprite update failed: ${(e as Error).message}`)
        return null
      }
    })
  }

  detectGrid(rel: string, sheetId: string): Promise<GridSpec | null> {
    return this.deps.run(async () => {
      try {
        const { sprite } = await this.load(rel)
        const rec = sprite.sheets.find((s) => s.id === sheetId)
        if (!rec || !existsSync(rec.path)) return null
        return await detectGrid(rec.path)
      } catch (e) {
        this.deps.log(`sprite detect grid failed: ${(e as Error).message}`)
        return null
      }
    })
  }

  setSettings(rel: string, patch: Partial<SpriteSettings>): Promise<SpriteProjectView | null> {
    return this.deps.run(async () => {
      try {
        const { dir, data, sprite } = await this.load(rel)
        const p = patch && typeof patch === 'object' ? { ...patch } : {}
        if (p.dirSet !== undefined && p.dirSet !== sprite.settings.dirSet && p.rowOrder === undefined && (p.rowPreset ?? sprite.settings.rowPreset) === 'custom') {
          p.rowOrder = p.dirSet ? DIRECTIONS[p.dirSet as 4 | 6 | 8] ?? [] : []
        }
        const next = sanitizeSettings({ ...sprite.settings, ...p }, sprite.settings)
        const orderChanged = next.dirSet !== sprite.settings.dirSet || next.rowOrder.join() !== sprite.settings.rowOrder.join()
        sprite.settings = next
        if (orderChanged) {
          for (const rec of sprite.sheets) if (rec.animsAuto && rec.format === 'grid' && rec.grid) rec.anims = autoAnims(rec, next)
        }
        return await this.view(rel, dir, data, sprite, true)
      } catch (e) {
        this.deps.log(`sprite settings failed: ${(e as Error).message}`)
        return null
      }
    })
  }
}

const s = (v: unknown): string => (typeof v === 'string' ? v : '')
const ss = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])
const o = <T>(v: unknown): T => (v && typeof v === 'object' ? (v as T) : ({} as T))

export function registerSpriteIpc(ipcMain: IpcMain, getWindow: () => BrowserWindow | null, service: SpriteService): void {
  ipcMain.handle(SPRITE_IPC.open, (_e, rel: unknown) => service.open(s(rel)))
  ipcMain.handle(SPRITE_IPC.addDialog, (_e, rel: unknown) => service.addFromDialog(s(rel), getWindow()))
  ipcMain.handle(SPRITE_IPC.addPaths, (_e, rel: unknown, paths: unknown) => service.addPaths(s(rel), ss(paths)))
  ipcMain.handle(SPRITE_IPC.remove, (_e, rel: unknown, id: unknown) => service.remove(s(rel), s(id)))
  ipcMain.handle(SPRITE_IPC.updateSheet, (_e, rel: unknown, id: unknown, patch: unknown) => service.updateSheet(s(rel), s(id), o<SheetPatch>(patch)))
  ipcMain.handle(SPRITE_IPC.detectGrid, (_e, rel: unknown, id: unknown) => service.detectGrid(s(rel), s(id)))
  ipcMain.handle(SPRITE_IPC.setSettings, (_e, rel: unknown, patch: unknown) => service.setSettings(s(rel), o<Partial<SpriteSettings>>(patch)))
  ipcMain.handle(SPRITE_GEN_IPC.setStyle, (_e, rel: unknown, patch: unknown) => service.setStyle(s(rel), o<Partial<SpriteStyle>>(patch)))
  ipcMain.handle(SPRITE_GEN_IPC.addRefs, (_e, rel: unknown) => service.addRefs(s(rel), getWindow()))
  ipcMain.handle(SPRITE_GEN_IPC.setLock, (_e, rel: unknown, key: unknown) => service.setLock(s(rel), typeof key === 'string' ? key : null))
  ipcMain.handle(SPRITE_GEN_IPC.enqueue, (_e, rel: unknown, keys: unknown, note: unknown) => service.enqueue(s(rel), ss(keys), typeof note === 'string' ? note : undefined))
  ipcMain.handle(SPRITE_GEN_IPC.review, (_e, rel: unknown, patch: unknown) => service.review(s(rel), o<Record<string, SpriteStripPatch>>(patch)))
  ipcMain.handle(SPRITE_GEN_IPC.versions, (_e, rel: unknown, key: unknown) => service.versions(s(rel), s(key)))
  ipcMain.handle(SPRITE_GEN_IPC.exportRun, (_e, rel: unknown, outDir: unknown) => service.exportRun(s(rel), s(outDir)))
  ipcMain.handle(SPRITE_GEN_IPC.exportDir, (_e, rel: unknown) => service.pickExportDir(s(rel), getWindow()))
  ipcMain.handle(SPRITE_GEN_IPC.pickCharacter, () => service.pickCharacter(getWindow()))
  ipcMain.handle(SPRITE_GEN_IPC.createSheet, (_e, rel: unknown, spec: unknown) => service.createSheet(s(rel), o<NewSheetSpec>(spec)))
  ipcMain.handle(SPRITE_GEN_IPC.snippets, (_e, rel: unknown, id: unknown) => service.snippets(s(rel), s(id)))
  ipcMain.handle(SPRITE_GEN_IPC.reveal, async (_e, p: unknown) => {
    const target = s(p)
    if (!target || !existsSync(target)) return
    const { shell } = await import('electron')
    await shell.openPath(target)
  })
}
