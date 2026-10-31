import { createHash } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import sharp from 'sharp'
import type { Direction, FrameRect, FrameSize, SpriteAnim, SpriteSettings, StripDecision, StripQa, StripVersion } from '@shared/sprite'
import { versionsDir } from '../queue/GenJob'
import { fileUrl } from '../workspace/protocol'
import { createImage, decode } from '../pipeline/image'
import type { RawImage } from '../pipeline/types'
import { blitClip, flipFrame, joinFrames, loadSheet, savePng, splitFrames, uprightFrame } from './strip'

export interface StripReviewEntry {
  version?: number
  decision: StripDecision | null
  selected: number
}

export interface StripSheetLike {
  id: string
  origin?: 'import' | 'new'
  path: string
  hash: string
  frames: FrameRect[]
  anims: SpriteAnim[]
}

export interface StripDef {
  key: string
  assetRel: string
  sheet: StripSheetLike
  anim: SpriteAnim
  frames: FrameRect[]
  mirrorOf: string | null
}

const MIRROR: Partial<Record<Direction, Direction>> = { E: 'W', NE: 'NW', SE: 'SW' }

export function decisionAt<T>(e: { decision: T | null; version?: number } | undefined, selected: number): T | null {
  if (!e || !selected) return null
  return !e.version || e.version === selected ? e.decision : null
}

export function stripKey(sheetId: string, animId: string): string {
  return `${sheetId}:${animId}`
}

export function stripAsset(sheetId: string, animId: string): string {
  return `sprite/${sheetId}/${animId}`
}

export function buildStripDefs(sheets: StripSheetLike[], settings: SpriteSettings): StripDef[] {
  const out: StripDef[] = []
  for (const sheet of sheets) {
    for (const anim of sheet.anims) {
      const frames = anim.frames.map((i) => sheet.frames[i]).filter((f): f is FrameRect => !!f)
      if (!frames.length) continue
      let mirrorOf: string | null = null
      if (settings.mirror && settings.dirSet && anim.dir && MIRROR[anim.dir]) {
        const src = sheet.anims.find((a) => a.name === anim.name && a.dir === MIRROR[anim.dir as Direction] && a.frames.length === anim.frames.length)
        if (src) mirrorOf = stripKey(sheet.id, src.id)
      }
      out.push({ key: stripKey(sheet.id, anim.id), assetRel: stripAsset(sheet.id, anim.id), sheet, anim, frames, mirrorOf })
    }
  }
  return out
}

export function autoLockKey(defs: StripDef[]): string | null {
  const own = defs.filter((d) => !d.mirrorOf)
  const rank = (d: StripDef): number => (/idle/i.test(d.anim.name) ? 0 : /walk/i.test(d.anim.name) ? 1 : 2)
  const south = own.filter((d) => d.anim.dir === 'S').sort((a, b) => rank(a) - rank(b))
  return south[0]?.key ?? own[0]?.key ?? null
}

export function frameSizes(frames: FrameRect[]): FrameSize[] {
  return frames.map((f) => ({ w: f.srcW, h: f.srcH }))
}

export async function origStrip(projectDir: string, def: StripDef): Promise<string | null> {
  if (!existsSync(def.sheet.path)) return null
  const sig = createHash('sha1').update(JSON.stringify([def.sheet.hash, def.frames])).digest('hex').slice(0, 12)
  const file = join(projectDir, '.cache', 'strips', `${def.sheet.id}_${def.anim.id}_${sig}.png`)
  if (existsSync(file)) return file
  await fs.mkdir(dirname(file), { recursive: true })
  const sheet = await loadSheet(def.sheet.path)
  const frames = await Promise.all(def.frames.map((f) => uprightFrame(sheet, f)))
  await savePng(joinFrames(frames), file)
  return file
}

export async function listStripVersions(projectDir: string, assetRel: string): Promise<number[]> {
  let names: string[] = []
  try {
    names = await fs.readdir(versionsDir(projectDir, assetRel))
  } catch {
    return []
  }
  return names
    .map((n) => /^v(\d+)\.png$/i.exec(n))
    .filter((m): m is RegExpExecArray => !!m)
    .map((m) => Number(m[1]))
    .sort((a, b) => a - b)
}

export function versionPath(projectDir: string, assetRel: string, v: number): string {
  return join(versionsDir(projectDir, assetRel), `v${v}.png`)
}

export async function readStripMeta(projectDir: string, assetRel: string, v: number): Promise<{ qa: StripQa | null; note: string | null; createdAt: number }> {
  try {
    const raw = JSON.parse(await fs.readFile(join(versionsDir(projectDir, assetRel), `v${v}.json`), 'utf8')) as Record<string, unknown>
    const qa = raw.stripQa && typeof raw.stripQa === 'object' ? (raw.stripQa as StripQa) : null
    return { qa, note: typeof raw.note === 'string' ? raw.note : null, createdAt: Date.parse(String(raw.createdAt ?? '')) || 0 }
  } catch {
    return { qa: null, note: null, createdAt: 0 }
  }
}

export async function stripVersions(projectDir: string, assetRel: string): Promise<StripVersion[]> {
  const out: StripVersion[] = []
  for (const v of await listStripVersions(projectDir, assetRel)) {
    const m = await readStripMeta(projectDir, assetRel, v)
    out.push({ version: v, url: fileUrl(versionPath(projectDir, assetRel, v), `${v}`), createdAt: m.createdAt, note: m.note, qa: m.qa })
  }
  return out
}

function fitInto(src: RawImage, w: number, h: number): RawImage {
  if (src.width === w && src.height === h) return src
  const out = createImage(w, h)
  blitClip(out, src, Math.floor((w - src.width) / 2), h - src.height)
  return out
}

async function toSheetOrientation(upright: RawImage, f: FrameRect): Promise<RawImage> {
  const uw = f.rotated ? f.h : f.w
  const uh = f.rotated ? f.w : f.h
  const part = createImage(uw, uh)
  blitClip(part, upright, -f.srcX, -f.srcY)
  if (!f.rotated) return part
  const buf = await sharp(Buffer.from(part.data), { raw: { width: part.width, height: part.height, channels: 4 } }).rotate(90).raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(buf.data.buffer, buf.data.byteOffset, buf.data.byteLength), width: buf.info.width, height: buf.info.height }
}

function clearRect(img: RawImage, x: number, y: number, w: number, h: number): void {
  for (let yy = Math.max(0, y); yy < Math.min(img.height, y + h); yy++) {
    img.data.fill(0, (yy * img.width + Math.max(0, x)) * 4, (yy * img.width + Math.min(img.width, x + w)) * 4)
  }
}

export interface ExportPiece {
  def: StripDef
  file: string
  flip: boolean
  sourceSizes: FrameSize[]
}

export async function composeSheet(sheetPath: string, frames: FrameRect[], pieces: ExportPiece[]): Promise<{ image: RawImage; replaced: number }> {
  const base = await decode(sheetPath)
  const done = new Set<number>()
  for (const p of pieces) {
    const strip = await decode(p.file)
    const parts = splitFrames(strip, p.sourceSizes)
    for (let j = 0; j < p.def.anim.frames.length; j++) {
      const idx = p.def.anim.frames[j]
      const f = frames[idx]
      if (!f || !parts[j]) continue
      const upright = fitInto(p.flip ? flipFrame(parts[j]) : parts[j], f.srcW, f.srcH)
      const piece = await toSheetOrientation(upright, f)
      clearRect(base, f.x, f.y, f.w, f.h)
      blitClip(base, piece, f.x, f.y)
      done.add(idx)
    }
  }
  return { image: base, replaced: done.size }
}

export function sheetOutName(sheetPath: string): string {
  return basename(sheetPath)
}
