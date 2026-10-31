import sharp from 'sharp'
import type { SpineRegion } from '@shared/spine'
import { crop, createImage, resizeRaw } from '../pipeline/image'
import type { RawImage } from '../pipeline/types'
import { blitClip } from '../sprite/strip'
import { regionPageSize } from './atlas'

async function rotate(img: RawImage, angle: number): Promise<RawImage> {
  const buf = await sharp(Buffer.from(img.data), { raw: { width: img.width, height: img.height, channels: 4 } }).rotate(angle).raw().toBuffer({ resolveWithObject: true })
  return { data: new Uint8Array(buf.data.buffer, buf.data.byteOffset, buf.data.byteLength), width: buf.info.width, height: buf.info.height }
}

export async function extractRegion(page: RawImage, r: SpineRegion): Promise<RawImage> {
  const s = regionPageSize(r)
  const part = crop(page, { x: r.x, y: r.y, w: s.w, h: s.h })
  return r.degrees === 90 ? rotate(part, 90) : part
}

export async function writeRegion(page: RawImage, r: SpineRegion, upright: RawImage): Promise<void> {
  let img = upright.width === r.w && upright.height === r.h ? upright : await resizeRaw(upright, r.w, r.h)
  if (r.degrees === 90) img = await rotate(img, -90)
  const s = regionPageSize(r)
  for (let y = Math.max(0, r.y); y < Math.min(page.height, r.y + s.h); y++) {
    page.data.fill(0, (y * page.width + Math.max(0, r.x)) * 4, (y * page.width + Math.min(page.width, r.x + s.w)) * 4)
  }
  blitClip(page, img, r.x, r.y)
}

export async function partsBoard(parts: RawImage[], max = 1024): Promise<RawImage> {
  if (!parts.length) return createImage(1, 1)
  const gap = 16
  const cols = Math.max(1, Math.ceil(Math.sqrt(parts.length * 1.5)))
  const cellW = Math.max(...parts.map((p) => p.width))
  const cellH = Math.max(...parts.map((p) => p.height))
  const rows = Math.ceil(parts.length / cols)
  const board = createImage(cols * (cellW + gap) + gap, rows * (cellH + gap) + gap)
  parts.forEach((p, i) => {
    const c = i % cols
    const r = Math.floor(i / cols)
    blitClip(board, p, gap + c * (cellW + gap) + Math.floor((cellW - p.width) / 2), gap + r * (cellH + gap) + Math.floor((cellH - p.height) / 2))
  })
  const scale = Math.min(1, max / Math.max(board.width, board.height))
  return scale < 1 ? resizeRaw(board, Math.round(board.width * scale), Math.round(board.height * scale)) : board
}
