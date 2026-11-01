import sharp from 'sharp'
import type { RawImage } from '../pipeline/types'
import { createImage, decode, hexToRgb } from '../pipeline/image'
import { blitClip } from './strip'

export type AnimFormat = 'gif' | 'webp'
export type AnimScale = 1 | 2 | 4

export interface AnimOptions {
  fps: number
  format: AnimFormat
  loop: boolean
  scale: AnimScale
  background?: 'transparent' | string
  pixel?: boolean
}

export function frameDelay(fps: number): number {
  return Number.isFinite(fps) && fps > 0 ? Math.max(10, Math.round(1000 / fps)) : 100
}

export function padFrames(frames: RawImage[]): RawImage[] {
  const w = frames.reduce((n, f) => Math.max(n, f.width), 1)
  const h = frames.reduce((n, f) => Math.max(n, f.height), 1)
  return frames.map((f) => {
    if (f.width === w && f.height === h) return f
    const out = createImage(w, h)
    blitClip(out, f, Math.floor((w - f.width) / 2), h - f.height)
    return out
  })
}

async function toRaw(f: RawImage | Buffer): Promise<RawImage> {
  return Buffer.isBuffer(f) ? decode(f) : f
}

export async function encodeAnimation(input: Array<RawImage | Buffer>, opts: AnimOptions): Promise<Buffer> {
  if (!input.length) throw new Error('no frames')
  const frames = padFrames(await Promise.all(input.map(toRaw)))
  const { width, height } = frames[0]
  const bg = opts.background && opts.background !== 'transparent' ? hexToRgb(opts.background) : null
  const kernel = opts.pixel === false ? 'lanczos3' : 'nearest'
  const pngs = await Promise.all(
    frames.map((f) => {
      let img = sharp(Buffer.from(f.data.buffer, f.data.byteOffset, f.data.byteLength), { raw: { width, height, channels: 4 } })
      if (opts.scale > 1) img = img.resize(width * opts.scale, height * opts.scale, { kernel })
      if (bg) img = img.flatten({ background: { r: bg[0], g: bg[1], b: bg[2] } })
      return img.png().toBuffer()
    })
  )
  const loop = opts.loop ? 0 : 1
  const delay = pngs.map(() => frameDelay(opts.fps))
  const src = pngs.length === 1 ? sharp(pngs[0]) : sharp(pngs, { join: { animated: true } })
  return opts.format === 'gif' ? src.gif({ delay, loop }).toBuffer() : src.webp({ delay, loop, lossless: true }).toBuffer()
}

export function animFileBase(sheetPath: string, anim: string, dir: string | null): string {
  const clean = (s: string): string => s.replace(/[^\p{L}\p{N}._-]+/gu, '_').replace(/^_+|_+$/g, '')
  const sheet = clean(sheetPath.replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, ''))
  return [sheet, clean(anim), dir ? clean(dir) : ''].filter(Boolean).join('_') || 'anim'
}
