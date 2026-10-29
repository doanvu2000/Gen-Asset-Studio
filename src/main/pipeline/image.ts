import sharp, { type Sharp } from 'sharp'
import type { Box, ImageInput, RawImage, Rgb } from './types'

export async function decode(input: ImageInput): Promise<RawImage> {
  const src = typeof input === 'string' ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  const { data, info } = await sharp(src).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height }
}

export async function hasAlphaChannel(input: ImageInput): Promise<boolean> {
  const src = typeof input === 'string' ? input : Buffer.from(input.buffer, input.byteOffset, input.byteLength)
  const meta = await sharp(src).metadata()
  return meta.hasAlpha === true
}

export function rawSharp(img: RawImage): Sharp {
  return sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
    raw: { width: img.width, height: img.height, channels: 4 }
  })
}

export async function encodePng(img: RawImage): Promise<Uint8Array> {
  const buf = await rawSharp(img).png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer()
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

export async function toRaw(s: Sharp): Promise<RawImage> {
  const { data, info } = await s.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height }
}

export async function resizeRaw(img: RawImage, width: number, height: number): Promise<RawImage> {
  const w = Math.max(1, Math.round(width))
  const h = Math.max(1, Math.round(height))
  if (w === img.width && h === img.height) return { data: img.data.slice(), width: w, height: h }
  return toRaw(rawSharp(img).resize(w, h, { fit: 'fill', kernel: 'lanczos3' }))
}

export function createImage(width: number, height: number): RawImage {
  return { data: new Uint8Array(width * height * 4), width, height }
}

export function crop(img: RawImage, box: Box): RawImage {
  const out = createImage(box.w, box.h)
  for (let y = 0; y < box.h; y++) {
    const sy = y + box.y
    if (sy < 0 || sy >= img.height) continue
    for (let x = 0; x < box.w; x++) {
      const sx = x + box.x
      if (sx < 0 || sx >= img.width) continue
      const si = (sy * img.width + sx) * 4
      const di = (y * box.w + x) * 4
      out.data[di] = img.data[si]
      out.data[di + 1] = img.data[si + 1]
      out.data[di + 2] = img.data[si + 2]
      out.data[di + 3] = img.data[si + 3]
    }
  }
  return out
}

export function blit(dst: RawImage, src: RawImage, ox: number, oy: number): void {
  for (let y = 0; y < src.height; y++) {
    const dy = y + oy
    if (dy < 0 || dy >= dst.height) continue
    for (let x = 0; x < src.width; x++) {
      const dx = x + ox
      if (dx < 0 || dx >= dst.width) continue
      const si = (y * src.width + x) * 4
      const di = (dy * dst.width + dx) * 4
      dst.data[di] = src.data[si]
      dst.data[di + 1] = src.data[si + 1]
      dst.data[di + 2] = src.data[si + 2]
      dst.data[di + 3] = src.data[si + 3]
    }
  }
}

export function alphaBBox(img: RawImage, threshold = 20): Box | null {
  let x0 = img.width
  let y0 = img.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < img.height; y++) {
    for (let x = 0; x < img.width; x++) {
      if (img.data[(y * img.width + x) * 4 + 3] > threshold) {
        if (x < x0) x0 = x
        if (x > x1) x1 = x
        if (y < y0) y0 = y
        if (y > y1) y1 = y
      }
    }
  }
  if (x1 < 0) return null
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

export function colorDistance(r: number, g: number, b: number, c: Rgb): number {
  const dr = r - c[0]
  const dg = g - c[1]
  const db = b - c[2]
  return Math.sqrt(dr * dr + dg * dg + db * db)
}

export function rgbToHex(c: Rgb): string {
  return '#' + c.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('').toUpperCase()
}

export function hexToRgb(hex: string): Rgb {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new Error(`Invalid hex color: ${hex}`)
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

export function hue(r: number, g: number, b: number): { h: number; s: number } {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  const s = max === 0 ? 0 : d / max
  if (d === 0) return { h: 0, s }
  let h: number
  if (max === r) h = ((g - b) / d) % 6
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  h *= 60
  if (h < 0) h += 360
  return { h, s }
}
