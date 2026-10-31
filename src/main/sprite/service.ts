import { randomBytes } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { basename, dirname, extname, join, resolve } from 'node:path'
import sharp from 'sharp'
import type { BrowserWindow, IpcMain } from 'electron'
import {
  DEFAULT_SPRITE_SETTINGS,
  DIRECTIONS,
  ROW_PRESETS,
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
  type ViewAngle
} from '@shared/sprite'
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
}

export interface SpriteData {
  settings: SpriteSettings
  sheets: SheetRecord[]
}

export interface SpriteDeps {
  projectDir: (rel: string) => string
  run: <T>(fn: () => Promise<T>) => Promise<T>
  allow: (abs: string) => void
  log: (message: string) => void
  readProject: (dir: string) => Promise<ProjectFile>
  writeProject: (dir: string, data: ProjectFile) => Promise<void>
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
    animsAuto: r.animsAuto !== false
  }
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
  return { settings, sheets }
}

function writeSpriteData(data: ProjectFile, sprite: SpriteData): void {
  data.sprite = { settings: sprite.settings, sheets: sprite.sheets }
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
        warnings: rec.warnings
      })
    }
    if (dirty) await this.save(dir, data, sprite)
    return {
      rel,
      name: basename(dir),
      dir,
      kind: 'sprite',
      settings: sprite.settings,
      sheets,
      updatedAt: Date.parse(data.updatedAt) || 0
    }
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
      animsAuto: true
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
}
