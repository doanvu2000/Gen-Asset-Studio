import sharp from 'sharp'
import type { Direction, FrameRect, StripQa, StripQaCheck, ViewAngle } from '@shared/sprite'
import { removeBackground } from '../pipeline/background'
import { alphaBBox, crop, createImage, decode, encodePng, resizeRaw } from '../pipeline/image'
import type { RawImage, Rgb } from '../pipeline/types'

export interface Box {
  x: number
  y: number
  width: number
  height: number
}

function cropBox(img: RawImage, b: Box): RawImage {
  return crop(img, { x: b.x, y: b.y, w: b.width, h: b.height })
}

function bbox(img: RawImage): Box | null {
  const b = alphaBBox(img, 20)
  return b ? { x: b.x, y: b.y, width: b.w, height: b.h } : null
}

export interface StripLayout {
  count: number
  cols: number
  rows: number
  cellW: number
  cellH: number
  pad: number
  offX: number
  offY: number
  width: number
  height: number
  aspect: '1:1' | '3:2' | '2:3'
}

export interface StripFit {
  frames: RawImage[]
  scale: number
  offsetX: number
  offsetY: number
  qa: StripQa
}

const ASPECTS: Array<{ id: StripLayout['aspect']; r: number }> = [
  { id: '1:1', r: 1 },
  { id: '3:2', r: 1.5 },
  { id: '2:3', r: 2 / 3 }
]

export function stripLayout(count: number, cellW: number, cellH: number): StripLayout {
  const pad = Math.max(8, Math.round(Math.max(cellW, cellH) * 0.12))
  let best: StripLayout | null = null
  let bestScore = Infinity
  for (let cols = 1; cols <= count; cols++) {
    const rows = Math.ceil(count / cols)
    if (cols * rows - count >= cols) continue
    const w = cols * (cellW + pad * 2)
    const h = rows * (cellH + pad * 2)
    for (const a of ASPECTS) {
      const width = Math.max(w, Math.ceil(h * a.r))
      const height = Math.max(h, Math.ceil(width / a.r))
      const waste = (width * height) / (w * h)
      const score = waste + (cols * rows - count) * 0.15
      if (score < bestScore) {
        bestScore = score
        best = { count, cols, rows, cellW, cellH, pad, offX: Math.floor((width - w) / 2), offY: Math.floor((height - h) / 2), width, height, aspect: a.id }
      }
    }
  }
  return best as StripLayout
}

export function cellBox(l: StripLayout, i: number): Box {
  const c = i % l.cols
  const r = Math.floor(i / l.cols)
  return { x: l.offX + c * (l.cellW + l.pad * 2), y: l.offY + r * (l.cellH + l.pad * 2), width: l.cellW + l.pad * 2, height: l.cellH + l.pad * 2 }
}

export async function uprightFrame(sheet: RawImage, f: FrameRect): Promise<RawImage> {
  const part = crop(sheet, { x: f.x, y: f.y, w: f.w, h: f.h })
  let up = part
  if (f.rotated) {
    const buf = await sharp(Buffer.from(part.data), { raw: { width: part.width, height: part.height, channels: 4 } }).rotate(-90).raw().toBuffer({ resolveWithObject: true })
    up = { data: new Uint8Array(buf.data.buffer, buf.data.byteOffset, buf.data.byteLength), width: buf.info.width, height: buf.info.height }
  }
  const out = createImage(f.srcW, f.srcH)
  blitClip(out, up, f.srcX, f.srcY)
  return out
}

export function blitClip(dst: RawImage, src: RawImage, ox: number, oy: number): void {
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

export async function loadSheet(abs: string): Promise<RawImage> {
  return decode(abs)
}

export function composeSource(frames: RawImage[], l: StripLayout, background?: Rgb): RawImage {
  const out = createImage(l.width, l.height)
  if (background) {
    for (let i = 0; i < out.data.length; i += 4) {
      out.data[i] = background[0]
      out.data[i + 1] = background[1]
      out.data[i + 2] = background[2]
      out.data[i + 3] = 255
    }
  }
  frames.forEach((f, i) => {
    const b = cellBox(l, i)
    const x = b.x + l.pad + Math.floor((l.cellW - f.width) / 2)
    const y = b.y + l.pad + (l.cellH - f.height)
    if (background) blendOver(out, f, x, y)
    else blitClip(out, f, x, y)
  })
  return out
}

function blendOver(dst: RawImage, src: RawImage, ox: number, oy: number): void {
  for (let y = 0; y < src.height; y++) {
    for (let x = 0; x < src.width; x++) {
      const dx = x + ox
      const dy = y + oy
      if (dx < 0 || dy < 0 || dx >= dst.width || dy >= dst.height) continue
      const si = (y * src.width + x) * 4
      const di = (dy * dst.width + dx) * 4
      const a = src.data[si + 3] / 255
      for (let k = 0; k < 3; k++) dst.data[di + k] = Math.round(src.data[si + k] * a + dst.data[di + k] * (1 - a))
    }
  }
}

function frameOrigin(f: RawImage, l: StripLayout, i: number): { x: number; y: number } {
  const b = cellBox(l, i)
  return { x: b.x + l.pad + Math.floor((l.cellW - f.width) / 2), y: b.y + l.pad + (l.cellH - f.height) }
}

export function components(img: RawImage, region: Box, threshold = 40): Array<Box & { area: number }> {
  const { width: W, data } = img
  const seen = new Uint8Array(region.width * region.height)
  const out: Array<Box & { area: number }> = []
  const stack: number[] = []
  for (let ry = 0; ry < region.height; ry++) {
    for (let rx = 0; rx < region.width; rx++) {
      const k = ry * region.width + rx
      if (seen[k]) continue
      const a = data[((region.y + ry) * W + region.x + rx) * 4 + 3]
      if (a <= threshold) continue
      let x0 = rx
      let y0 = ry
      let x1 = rx
      let y1 = ry
      let area = 0
      seen[k] = 1
      stack.push(k)
      while (stack.length) {
        const p = stack.pop() as number
        const px = p % region.width
        const py = (p - px) / region.width
        area++
        if (px < x0) x0 = px
        if (px > x1) x1 = px
        if (py < y0) y0 = py
        if (py > y1) y1 = py
        for (const [nx, ny] of [
          [px - 1, py],
          [px + 1, py],
          [px, py - 1],
          [px, py + 1]
        ]) {
          if (nx < 0 || ny < 0 || nx >= region.width || ny >= region.height) continue
          const q = ny * region.width + nx
          if (seen[q]) continue
          if (data[((region.y + ny) * W + region.x + nx) * 4 + 3] <= threshold) continue
          seen[q] = 1
          stack.push(q)
        }
      }
      out.push({ x: region.x + x0, y: region.y + y0, width: x1 - x0 + 1, height: y1 - y0 + 1, area })
    }
  }
  return out
}

export function union(boxes: Box[]): Box | null {
  if (!boxes.length) return null
  let x0 = Infinity
  let y0 = Infinity
  let x1 = -Infinity
  let y1 = -Infinity
  for (const b of boxes) {
    x0 = Math.min(x0, b.x)
    y0 = Math.min(y0, b.y)
    x1 = Math.max(x1, b.x + b.width)
    y1 = Math.max(y1, b.y + b.height)
  }
  return { x: x0, y: y0, width: x1 - x0, height: y1 - y0 }
}

export function median(v: number[]): number {
  if (!v.length) return 0
  const s = [...v].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function cellContent(img: RawImage, region: Box): { box: Box | null; touches: boolean } {
  const comps = components(img, region)
  const biggest = comps.reduce((m, c) => Math.max(m, c.area), 0)
  const keep = comps.filter((c) => c.area >= Math.max(12, biggest * 0.003))
  const box = union(keep)
  const touches = !!box && (box.x <= region.x || box.y <= region.y || box.x + box.width >= region.x + region.width || box.y + box.height >= region.y + region.height)
  return { box, touches }
}

export async function keyStrip(raw: string | Uint8Array, l: StripLayout, chroma: Rgb): Promise<RawImage> {
  const ai = await decode(raw)
  const keyed = removeBackground(ai, chroma).image
  return keyed.width === l.width && keyed.height === l.height ? keyed : resizeRaw(keyed, l.width, l.height)
}

function sampleBilinear(src: RawImage, x: number, y: number, out: Uint8Array, o: number): void {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const fx = x - x0
  const fy = y - y0
  let r = 0
  let g = 0
  let b = 0
  let a = 0
  for (const [dx, dy, w] of [
    [0, 0, (1 - fx) * (1 - fy)],
    [1, 0, fx * (1 - fy)],
    [0, 1, (1 - fx) * fy],
    [1, 1, fx * fy]
  ]) {
    const sx = x0 + dx
    const sy = y0 + dy
    if (sx < 0 || sy < 0 || sx >= src.width || sy >= src.height || w === 0) continue
    const i = (sy * src.width + sx) * 4
    const al = (src.data[i + 3] / 255) * w
    r += src.data[i] * al
    g += src.data[i + 1] * al
    b += src.data[i + 2] * al
    a += al
  }
  if (a > 0) {
    out[o] = Math.round(r / a)
    out[o + 1] = Math.round(g / a)
    out[o + 2] = Math.round(b / a)
  }
  out[o + 3] = Math.round(Math.min(1, a) * 255)
}

export async function scaleRegion(src: RawImage, box: Box, s: number): Promise<RawImage> {
  const part = cropBox(src, box)
  const w = Math.max(1, Math.round(part.width * s))
  const h = Math.max(1, Math.round(part.height * s))
  if (s >= 1) {
    const out = createImage(w, h)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) sampleBilinear(part, (x + 0.5) / s - 0.5, (y + 0.5) / s - 0.5, out.data, (y * w + x) * 4)
    return out
  }
  return resizeRaw(part, w, h)
}

export async function fitStrip(keyed: RawImage, l: StripLayout, originals: RawImage[], opts: { anchorTol?: number; heightTol?: number } = {}): Promise<StripFit> {
  const anchorTol = opts.anchorTol ?? Math.max(3, Math.round(l.cellH * 0.04))
  const heightTol = opts.heightTol ?? 0.12
  const info = originals.map((orig, i) => {
    const ob = bbox(orig)
    const region = cellBox(l, i)
    const { box, touches } = cellContent(keyed, region)
    const origin = frameOrigin(orig, l, i)
    return { orig, ob, box, touches, origin }
  })
  const ratios = info.filter((f) => f.ob && f.box).map((f) => (f.ob as Box).height / (f.box as Box).height)
  const s = median(ratios) || 1
  const offsX: number[] = []
  const offsY: number[] = []
  for (const f of info) {
    if (!f.ob || !f.box) continue
    const ocx = f.ob.x + f.ob.width / 2
    const oby = f.ob.y + f.ob.height
    const acx = f.box.x - f.origin.x + f.box.width / 2
    const aby = f.box.y - f.origin.y + f.box.height
    offsX.push(ocx - acx * s)
    offsY.push(oby - aby * s)
  }
  const offX = median(offsX)
  const offY = median(offsY)
  const frames: RawImage[] = []
  const anchorBad: number[] = []
  const heightBad: number[] = []
  const clipped: number[] = []
  const missing: number[] = []
  const cut: number[] = []
  let worstAnchor = 0
  let worstHeight = 0
  for (let i = 0; i < info.length; i++) {
    const f = info[i]
    const out = createImage(f.orig.width, f.orig.height)
    if (!f.box) {
      missing.push(i)
      frames.push(out)
      continue
    }
    if (f.touches) cut.push(i)
    const scaled = await scaleRegion(keyed, f.box, s)
    const dx = Math.round((f.box.x - f.origin.x) * s + offX)
    const dy = Math.round((f.box.y - f.origin.y) * s + offY)
    blitClip(out, scaled, dx, dy)
    if (dx < 0 || dy < 0 || dx + scaled.width > out.width || dy + scaled.height > out.height) clipped.push(i)
    if (f.ob) {
      const ex = Math.abs(f.ob.x + f.ob.width / 2 - (dx + scaled.width / 2))
      const ey = Math.abs(f.ob.y + f.ob.height - (dy + scaled.height))
      const err = Math.max(ex, ey)
      worstAnchor = Math.max(worstAnchor, err)
      if (err > anchorTol) anchorBad.push(i)
      const hr = Math.abs(scaled.height / f.ob.height - 1)
      worstHeight = Math.max(worstHeight, hr)
      if (hr > heightTol) heightBad.push(i)
    }
    frames.push(out)
  }
  const dup: number[] = []
  for (let i = 1; i < frames.length; i++) if (!missing.includes(i) && same(frames[i], frames[i - 1]) && !same(originals[i], originals[i - 1])) dup.push(i)
  const checks: StripQaCheck[] = [
    { id: 'missing', status: missing.length ? 'fail' : 'pass', value: missing.length, threshold: 0, frames: missing, message: missing.length ? `${missing.length} frame(s) empty in AI output` : 'all frames present' },
    { id: 'anchor', status: anchorBad.length ? 'warn' : 'pass', value: Math.round(worstAnchor), threshold: anchorTol, frames: anchorBad, message: `max anchor drift ${Math.round(worstAnchor)} px` },
    { id: 'height', status: heightBad.length ? 'warn' : 'pass', value: Math.round(worstHeight * 100), threshold: Math.round(heightTol * 100), frames: heightBad, message: `max height change ${Math.round(worstHeight * 100)}%` },
    { id: 'clipped', status: clipped.length ? 'warn' : 'pass', value: clipped.length, threshold: 0, frames: clipped, message: clipped.length ? `${clipped.length} frame(s) clipped by the cell` : 'no clipping' },
    { id: 'cut', status: cut.length ? 'warn' : 'pass', value: cut.length, threshold: 0, frames: cut, message: cut.length ? `${cut.length} frame(s) touch the AI cell border` : 'cells separated' },
    { id: 'duplicate', status: dup.length ? 'warn' : 'pass', value: dup.length, threshold: 0, frames: dup, message: dup.length ? `${dup.length} frame(s) identical to the previous one` : 'frames differ' }
  ]
  return { frames, scale: s, offsetX: offX, offsetY: offY, qa: { pass: !checks.some((c) => c.status === 'fail'), checks } }
}

export function same(a: RawImage, b: RawImage): boolean {
  if (a.width !== b.width || a.height !== b.height) return false
  let diff = 0
  for (let i = 3; i < a.data.length; i += 4) if (Math.abs(a.data[i] - b.data[i]) > 24) diff++
  return diff < (a.width * a.height) / 400
}

export function joinFrames(frames: RawImage[]): RawImage {
  const w = frames.reduce((n, f) => n + f.width, 0)
  const h = frames.reduce((n, f) => Math.max(n, f.height), 0)
  const out = createImage(Math.max(1, w), Math.max(1, h))
  let x = 0
  for (const f of frames) {
    blitClip(out, f, x, 0)
    x += f.width
  }
  return out
}

export function splitFrames(strip: RawImage, sizes: Array<{ w: number; h: number }>): RawImage[] {
  const out: RawImage[] = []
  let x = 0
  for (const s of sizes) {
    const f = createImage(s.w, s.h)
    blitClip(f, crop(strip, { x, y: 0, w: Math.min(s.w, strip.width - x), h: Math.min(s.h, strip.height) }), 0, 0)
    out.push(f)
    x += s.w
  }
  return out
}

export function flipFrame(f: RawImage): RawImage {
  const out = createImage(f.width, f.height)
  for (let y = 0; y < f.height; y++) {
    for (let x = 0; x < f.width; x++) {
      const si = (y * f.width + x) * 4
      const di = (y * f.width + (f.width - 1 - x)) * 4
      out.data.set(f.data.subarray(si, si + 4), di)
    }
  }
  return out
}

export { encodePng }

export const DIR_TEXT: Record<Direction, string> = {
  S: 'facing the camera (front view, walking down the screen)',
  SW: 'facing down-left (three-quarter front view toward the left)',
  W: 'facing left (side profile looking left)',
  NW: 'facing up-left (three-quarter back view toward the left)',
  N: 'facing away from the camera (back view, walking up the screen)',
  NE: 'facing up-right (three-quarter back view toward the right)',
  E: 'facing right (side profile looking right)',
  SE: 'facing down-right (three-quarter front view toward the right)'
}

export const VIEW_TEXT: Record<ViewAngle, string> = {
  topdown: 'top-down 3/4 RPG camera',
  iso: 'isometric camera',
  side: 'side-view platformer camera'
}

export interface StripPromptInput {
  stylePrompt: string
  note?: string
  anim: string
  dir: Direction | null
  view: ViewAngle
  layout: StripLayout
  chromaName: string
  chromaHex: string
  lockCount: number
  styleImageCount: number
  refImageCount: number
}

export function buildStripPrompt(p: StripPromptInput): string {
  const l = p.layout
  const lines: string[] = []
  let idx = 2
  lines.push('Restyle the attached animation frames of a game character into the target art style. Generate exactly one image with the image generation tool.')
  lines.push('')
  lines.push(
    `Image 1 is a SPRITE GRID: ${l.count} animation frames of the "${p.anim}" animation laid out in ${l.cols} column(s) x ${l.rows} row(s), read left to right, top to bottom. Every frame shows the same character${p.dir ? `, ${DIR_TEXT[p.dir]}` : ''}, ${VIEW_TEXT[p.view]}.`
  )
  if (p.lockCount > 0) {
    lines.push(`Image${p.lockCount > 1 ? `s ${idx}-${idx + p.lockCount - 1} are` : ` ${idx} is`} the CHARACTER LOCK: the already approved restyled character. Match its face, hair, outfit, colors, proportions and rendering exactly.`)
    idx += p.lockCount
  }
  if (p.styleImageCount > 0) {
    lines.push(`Image${p.styleImageCount > 1 ? `s ${idx}-${idx + p.styleImageCount - 1} are` : ` ${idx} is`} the STYLE LOCK: copy rendering style, outline weight, shading and palette, never its objects.`)
    idx += p.styleImageCount
  }
  if (p.refImageCount > 0) lines.push(`The last ${p.refImageCount} image(s) are extra style references only.`)
  lines.push('')
  lines.push('Target style:')
  lines.push(p.stylePrompt.trim() || 'Match the style lock exactly.')
  if (p.note && p.note.trim()) {
    lines.push('')
    lines.push(`Notes: ${p.note.trim()}`)
  }
  lines.push('')
  lines.push('Hard rules:')
  lines.push(`- Output the same ${l.cols} x ${l.rows} grid with exactly ${l.count} frames, each frame centered in its own cell at the same position and size as in image 1. Empty cells stay empty.`)
  lines.push('- Keep each frame\'s pose, limb positions, facing direction and silhouette exactly as in the source frame; only the art style changes. The animation must still play correctly frame by frame.')
  lines.push('- The character is identical in every frame: same design, same colors, same proportions, same size. Feet stay on the same ground line across frames.')
  lines.push('- Keep every element the source frames have (for example a soft shadow under the feet) and add nothing new. Leave clear empty space between cells. No grid lines, borders, frame numbers, labels or text.')
  lines.push(`- Background: fill the entire canvas with one ${p.chromaName}, exact hex ${p.chromaHex}. No gradient or texture. Never use this color on the character.`)
  lines.push(`- The output canvas aspect ratio must be ${l.aspect}.`)
  lines.push('- Clean crisp edges, no blur.')
  lines.push('')
  lines.push('Do not write code, files or scripts.')
  return lines.join('\n')
}

export async function savePng(img: RawImage, path: string): Promise<void> {
  await sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: 4 } }).png({ compressionLevel: 9 }).toFile(path)
}
