import { alphaBBox, blit, createImage, crop, resizeRaw } from './image'
import type { Box, FitInfo, FitOptions, RawImage, Side, SliceInfo } from './types'

const NINE_SLICE_NAME = /(^|[\\/])(btn|button|bg|panel|popup|frame|bar|box|dialog|card|slot|tab|progress|board|banner)[_-]/i

function columnDiff(img: RawImage, a: number, b: number, axis: 'x' | 'y'): number {
  const { width: w, height: h, data } = img
  const len = axis === 'x' ? h : w
  let sum = 0
  for (let t = 0; t < len; t++) {
    const ia = axis === 'x' ? (t * w + a) * 4 : (a * w + t) * 4
    const ib = axis === 'x' ? (t * w + b) * 4 : (b * w + t) * 4
    const aa = data[ia + 3]
    const ab = data[ib + 3]
    const wgt = Math.max(aa, ab) / 255
    sum +=
      (Math.abs(data[ia] - data[ib]) + Math.abs(data[ia + 1] - data[ib + 1]) + Math.abs(data[ia + 2] - data[ib + 2])) *
        wgt /
        3 +
      Math.abs(aa - ab)
  }
  return sum / Math.max(1, len)
}

export function detectStretchRegion(img: RawImage, axis: 'x' | 'y', tolerance = 10): SliceInfo {
  const len = axis === 'x' ? img.width : img.height
  const cross = axis === 'x' ? img.height : img.width
  const c = len >> 1
  let start = c
  let end = c + 1
  while (start > 1 && columnDiff(img, start - 1, c, axis) < tolerance) start--
  while (end < len - 1 && columnDiff(img, end, c, axis) < tolerance) end++
  const run = end - start
  if (run >= Math.max(2, len * 0.1)) {
    const inset = Math.floor(run * 0.1)
    return { axis, start: start + inset, end: Math.max(start + inset + 1, end - inset), uniform: true }
  }
  const corner = Math.min(Math.floor(len * 0.45), Math.ceil(cross * 0.5))
  return { axis, start: corner, end: Math.max(corner + 1, len - corner), uniform: false }
}

export function guessNineSlice(original: RawImage, name?: string): boolean {
  if (name && NINE_SLICE_NAME.test(name)) return true
  const box = alphaBBox(original) ?? { x: 0, y: 0, w: original.width, h: original.height }
  const aspect = box.w / box.h
  if (aspect < 1.6 && aspect > 1 / 1.6) return false
  const axis = aspect >= 1 ? 'x' : 'y'
  const region = detectStretchRegion(crop(original, box), axis, 8)
  const len = axis === 'x' ? box.w : box.h
  return region.uniform && region.end - region.start >= len * 0.2
}

export function detectEdgeAnchored(original: RawImage, threshold = 20): Side[] {
  const box = alphaBBox(original, threshold)
  if (!box) return []
  const out: Side[] = []
  if (box.x === 0) out.push('left')
  if (box.y === 0) out.push('top')
  if (box.x + box.w === original.width) out.push('right')
  if (box.y + box.h === original.height) out.push('bottom')
  return out
}

async function stretch(img: RawImage, slice: SliceInfo, targetLen: number): Promise<RawImage> {
  const len = slice.axis === 'x' ? img.width : img.height
  const head = slice.start
  const tail = len - slice.end
  const midLen = targetLen - head - tail
  if (midLen < 1) return img
  const midBox: Box =
    slice.axis === 'x'
      ? { x: slice.start, y: 0, w: slice.end - slice.start, h: img.height }
      : { x: 0, y: slice.start, w: img.width, h: slice.end - slice.start }
  const mid = crop(img, midBox)
  const midScaled =
    slice.axis === 'x' ? await resizeRaw(mid, midLen, img.height) : await resizeRaw(mid, img.width, midLen)
  if (slice.axis === 'x') {
    const out = createImage(targetLen, img.height)
    blit(out, crop(img, { x: 0, y: 0, w: head, h: img.height }), 0, 0)
    blit(out, midScaled, head, 0)
    blit(out, crop(img, { x: slice.end, y: 0, w: tail, h: img.height }), head + midLen, 0)
    return out
  }
  const out = createImage(img.width, targetLen)
  blit(out, crop(img, { x: 0, y: 0, w: img.width, h: head }), 0, 0)
  blit(out, midScaled, 0, head)
  blit(out, crop(img, { x: 0, y: slice.end, w: img.width, h: tail }), 0, head + midLen)
  return out
}

export async function fitToOriginal(
  block: RawImage,
  original: RawImage,
  options: FitOptions = {}
): Promise<{ image: RawImage; info: FitInfo }> {
  const W = original.width
  const H = original.height
  const margin = Math.max(2, options.margin ?? 2)
  const origBox = alphaBBox(original) ?? { x: 0, y: 0, w: W, h: H }
  const anchored = options.edgeAnchored === undefined || options.edgeAnchored === 'auto' ? detectEdgeAnchored(original) : options.edgeAnchored
  const has = (s: Side): boolean => anchored.includes(s)
  const tx0 = has('left') ? origBox.x : Math.max(origBox.x, margin)
  const ty0 = has('top') ? origBox.y : Math.max(origBox.y, margin)
  const tx1 = has('right') ? origBox.x + origBox.w : Math.min(origBox.x + origBox.w, W - margin)
  const ty1 = has('bottom') ? origBox.y + origBox.h : Math.min(origBox.y + origBox.h, H - margin)
  const target: Box = { x: tx0, y: ty0, w: Math.max(1, tx1 - tx0), h: Math.max(1, ty1 - ty0) }
  const nineGuess = guessNineSlice(original, options.name)
  const nine = options.nineSlice === undefined || options.nineSlice === 'auto' ? nineGuess : options.nineSlice
  const s = Math.min(target.w / block.width, target.h / block.height)
  const rw = Math.min(target.w, Math.max(1, Math.round(block.width * s)))
  const rh = Math.min(target.h, Math.max(1, Math.round(block.height * s)))
  let img = await resizeRaw(block, rw, rh)
  let slice: SliceInfo | null = null
  if (nine) {
    if (rw < target.w) {
      slice = detectStretchRegion(img, 'x')
      img = await stretch(img, slice, target.w)
    } else if (rh < target.h) {
      slice = detectStretchRegion(img, 'y')
      img = await stretch(img, slice, target.h)
    }
  }
  const canvas = createImage(W, H)
  let ox = target.x + Math.round((target.w - img.width) / 2)
  let oy = target.y + Math.round((target.h - img.height) / 2)
  if (has('left') && !has('right')) ox = target.x
  if (has('right') && !has('left')) ox = target.x + target.w - img.width
  if (has('top') && !has('bottom')) oy = target.y
  if (has('bottom') && !has('top')) oy = target.y + target.h - img.height
  blit(canvas, img, ox, oy)
  return {
    image: canvas,
    info: {
      mode: slice ? 'nine-slice' : 'uniform',
      nineSliceGuess: nineGuess,
      scale: Math.round(s * 10000) / 10000,
      target,
      placed: { x: ox, y: oy, w: img.width, h: img.height },
      edgeAnchored: anchored,
      slice
    }
  }
}
