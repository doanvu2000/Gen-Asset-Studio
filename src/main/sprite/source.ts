import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import type { FrameRect, SheetStatus, StripSource } from '@shared/sprite'
import type { RawImage } from '../pipeline/types'
import { versionsDir } from '../queue/GenJob'
import { parseAtlas } from './atlas'
import { loadSheet, uprightFrame } from './strip'
import type { SheetRecord, SpriteData } from './service'
import type { StripDef } from './strips'

type Layout = 'ok' | 'layoutChanged' | 'atlasMissing'

const MAX_FRAMES = 4096
const CACHE_MAX = 20000
const hashCache = new Map<string, string>()

export function frameHash(img: RawImage): string {
  return createHash('sha1').update(`${img.width}x${img.height}:`).update(img.data).digest('hex').slice(0, 16)
}

export async function sourceFrameHashes(sheet: RawImage, frames: FrameRect[]): Promise<string[]> {
  return Promise.all(frames.map(async (f) => frameHash(await uprightFrame(sheet, f))))
}

export function atlasTextHash(text: string): string {
  return createHash('sha1').update(text).digest('hex')
}

function rectsEqual(a: FrameRect[], b: FrameRect[]): boolean {
  if (a.length !== b.length) return false
  return a.every((f, i) => {
    const g = b[i]
    return f.x === g.x && f.y === g.y && f.w === g.w && f.h === g.h && f.rotated === g.rotated && f.srcX === g.srcX && f.srcY === g.srcY && f.srcW === g.srcW && f.srcH === g.srcH
  })
}

function rectKey(f: FrameRect): string {
  return `${f.x},${f.y},${f.w},${f.h},${f.rotated ? 1 : 0},${f.srcX},${f.srcY},${f.srcW},${f.srcH}`
}

async function storedFrames(dir: string, assetRel: string, version: number, depth = 0): Promise<string[] | null> {
  try {
    const raw = JSON.parse(await fs.readFile(join(versionsDir(dir, assetRel), `v${version}.json`), 'utf8')) as Record<string, unknown>
    if (Array.isArray(raw.srcFrames) && raw.srcFrames.every((x) => typeof x === 'string')) return raw.srcFrames as string[]
    if (raw.kind === 'recolor' && typeof raw.from === 'number' && depth < 8) return await storedFrames(dir, assetRel, raw.from, depth + 1)
  } catch {
    return null
  }
  return null
}

export interface SourceChecker {
  dirty: boolean
  strip: (d: StripDef, selected: number) => Promise<StripSource | undefined>
}

export async function createSourceChecker(dir: string, sprite: SpriteData, statuses: Map<string, SheetStatus>): Promise<SourceChecker> {
  const layouts = new Map<string, Layout>()
  const self: SourceChecker = { dirty: false, strip: async () => undefined }

  for (const rec of sprite.sheets) {
    const status = statuses.get(rec.id)
    if (rec.origin === 'new' || !status || status === 'missing') continue
    let w = rec.w
    let h = rec.h
    if (status === 'changed') {
      const meta = await sharp(rec.path).metadata().catch(() => null)
      w = meta?.width ?? 0
      h = meta?.height ?? 0
    }
    if (w !== rec.w || h !== rec.h) {
      layouts.set(rec.id, 'layoutChanged')
      continue
    }
    if (rec.format === 'grid' || !rec.atlasPath) continue
    const st = await fs.stat(rec.atlasPath).catch(() => null)
    if (!st?.isFile()) {
      layouts.set(rec.id, 'atlasMissing')
      continue
    }
    const mtime = Math.round(st.mtimeMs)
    if (rec.atlasHash && st.size === rec.atlasSize && mtime === rec.atlasMtime) continue
    const stamp = (hash: string): void => {
      rec.atlasSize = st.size
      rec.atlasMtime = mtime
      rec.atlasHash = hash
      self.dirty = true
    }
    try {
      const text = await fs.readFile(rec.atlasPath, 'utf8')
      const hash = atlasTextHash(text)
      if (rec.atlasHash && hash === rec.atlasHash) {
        stamp(hash)
        continue
      }
      const parsed = parseAtlas(rec.atlasPath, text, w, h).frames.slice(0, MAX_FRAMES)
      if (rectsEqual(rec.frames, parsed)) stamp(hash)
      else layouts.set(rec.id, 'layoutChanged')
    } catch {
      layouts.set(rec.id, 'layoutChanged')
    }
  }

  const sheets = new Map<string, Promise<RawImage>>()
  const hashesOf = async (rec: SheetRecord, frames: FrameRect[]): Promise<string[]> => {
    const st = await fs.stat(rec.path)
    const prefix = `${rec.path}|${st.size}|${st.mtimeMs}|`
    const missing = frames.filter((f) => !hashCache.has(prefix + rectKey(f)))
    if (missing.length) {
      let sheet = sheets.get(rec.id)
      if (!sheet) {
        sheet = loadSheet(rec.path)
        sheets.set(rec.id, sheet)
      }
      const hashes = await sourceFrameHashes(await sheet, missing)
      if (hashCache.size > CACHE_MAX) hashCache.clear()
      missing.forEach((f, i) => hashCache.set(prefix + rectKey(f), hashes[i]))
    }
    return frames.map((f) => hashCache.get(prefix + rectKey(f)) ?? '')
  }

  self.strip = async (d, selected) => {
    const rec = sprite.sheets.find((s) => s.id === d.sheet.id)
    const status = rec ? statuses.get(rec.id) : undefined
    if (!rec || rec.origin === 'new' || !status || status === 'missing') return undefined
    const layout = layouts.get(rec.id) ?? 'ok'
    if (layout === 'atlasMissing') return { state: 'missing', frames: [] }
    if (layout === 'layoutChanged') return { state: 'layoutChanged', frames: [] }
    const sig = (await storedFrames(dir, d.assetRel, selected)) ?? sprite.srcSigs[d.key]
    const pngChanged = status === 'changed'
    try {
      if (!sig) {
        if (pngChanged) return undefined
        sprite.srcSigs[d.key] = await hashesOf(rec, d.frames)
        self.dirty = true
        return undefined
      }
      if (sig.length !== d.frames.length) return { state: 'layoutChanged', frames: [] }
      if (!pngChanged) return undefined
      const now = await hashesOf(rec, d.frames)
      const frames = now.flatMap((h, i) => (h === sig[i] ? [] : [i]))
      return frames.length ? { state: 'sourceChanged', frames } : undefined
    } catch {
      return { state: 'missing', frames: [] }
    }
  }
  return self
}
