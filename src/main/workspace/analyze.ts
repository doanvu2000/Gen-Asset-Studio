import sharp from 'sharp'
import { createHash } from 'node:crypto'
import { createReadStream, promises as fs } from 'node:fs'
import { basename, extname } from 'node:path'
import type { InputKind, InputType } from '@shared/workspace'
import { alphaBBox } from '../pipeline/image'
import { guessNineSlice } from '../pipeline/fit'
import type { RawImage } from '../pipeline/types'

export interface ImageFacts {
  w: number
  h: number
  alpha: boolean
  size: number
  mtime: number
  hash: string
  kind: InputKind
  type: InputType
}

const SAMPLE = 384

export function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha1')
    const s = createReadStream(file)
    s.on('data', (chunk) => h.update(chunk))
    s.on('error', reject)
    s.on('end', () => resolve(h.digest('hex')))
  })
}

function stem(file: string): string {
  return basename(file, extname(file)).toLowerCase()
}

const NAME_RULES: Array<[RegExp, InputKind]> = [
  [/(^|[_\-\s])(char|chara|character|hero|npc|avatar|mascot|idol|monster|enemy|player|boss|pet)([_\-\s\d]|$)/, 'character'],
  [/(^|[_\-\s])(btn|button)([_\-\s\d]|$)/, 'button'],
  [/(^|[_\-\s])(bar|progress|slider|gauge|hpbar|expbar|loading)([_\-\s\d]|$)/, 'bar'],
  [/(^|[_\-\s])(ic|icon|ico)([_\-\s\d]|$)/, 'icon'],
  [/(^|[_\-\s])(panel|popup|dialog|frame|bg|board|window|card|box|banner|ribbon)([_\-\s\d]|$)/, 'panel']
]

export function guessKind(name: string, w: number, h: number, bw: number, bh: number, coverage: number): InputKind {
  for (const [re, kind] of NAME_RULES) if (re.test(name)) return kind
  const aspect = bw / Math.max(1, bh)
  const longest = Math.max(w, h)
  if (aspect >= 4 || aspect <= 0.25) return 'bar'
  if (longest <= 160 && aspect > 0.66 && aspect < 1.5) return 'icon'
  if (coverage < 0.55 && bh > bw * 1.1) return 'character'
  if (aspect >= 1.4 && longest < 640 && coverage >= 0.6) return 'button'
  if (coverage >= 0.8 && Math.min(w, h) >= 200) return 'panel'
  if (coverage < 0.6) return 'character'
  return longest <= 256 ? 'icon' : 'panel'
}

const READABLE = new Set(['png', 'jpeg', 'webp', 'heif', 'avif', 'tiff'])

export async function analyzeImage(file: string): Promise<ImageFacts> {
  const st = await fs.stat(file)
  const meta = await sharp(file).metadata()
  if (!meta.format || !READABLE.has(meta.format) || !meta.width || !meta.height) throw new Error('notPng')
  const { data, info } = await sharp(file)
    .ensureAlpha()
    .resize({ width: SAMPLE, height: SAMPLE, fit: 'inside', withoutEnlargement: true })
    .raw()
    .toBuffer({ resolveWithObject: true })
  const raw: RawImage = { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height }
  let minAlpha = 255
  let solid = 0
  for (let i = 3; i < raw.data.length; i += 4) {
    const a = raw.data[i]
    if (a < minAlpha) minAlpha = a
    if (a > 20) solid++
  }
  const alpha = meta.hasAlpha === true && minAlpha < 255
  const box = alphaBBox(raw) ?? { x: 0, y: 0, w: raw.width, h: raw.height }
  const coverage = solid / Math.max(1, box.w * box.h)
  const name = stem(file)
  const kind = guessKind(name, meta.width, meta.height, box.w, box.h, coverage)
  let nine = false
  const boxAspect = box.w / Math.max(1, box.h)
  const elongated = boxAspect >= 1.6 || boxAspect <= 0.625
  if ((kind === 'panel' && (elongated || Math.min(meta.width, meta.height) >= 200)) || ((kind === 'button' || kind === 'bar') && elongated)) {
    try {
      nine = guessNineSlice(raw, basename(file))
    } catch {
      nine = false
    }
  }
  const hash = await hashFile(file)
  return {
    w: meta.width,
    h: meta.height,
    alpha,
    size: st.size,
    mtime: Math.round(st.mtimeMs),
    hash,
    kind,
    type: nine ? 'nine' : 'normal'
  }
}

export async function makeThumb(file: string, dest: string): Promise<void> {
  const tmp = `${dest}.${process.pid}.tmp`
  await sharp(file).resize({ width: 256, height: 256, fit: 'inside', withoutEnlargement: true }).png({ compressionLevel: 6 }).toFile(tmp)
  await fs.rename(tmp, dest)
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length)
  let next = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++
      out[i] = await fn(items[i], i)
    }
  })
  await Promise.all(workers)
  return out
}
