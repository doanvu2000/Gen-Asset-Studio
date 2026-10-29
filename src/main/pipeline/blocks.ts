import { crop } from './image'
import type { Box, ExtractInfo, ExtractOptions, RawImage } from './types'

interface Component {
  area: number
  x0: number
  y0: number
  x1: number
  y1: number
}

function gap(a: Component, b: Component): number {
  const dx = Math.max(0, a.x0 - b.x1, b.x0 - a.x1)
  const dy = Math.max(0, a.y0 - b.y1, b.y0 - a.y1)
  return Math.max(dx, dy)
}

export function extractMainBlock(img: RawImage, options: ExtractOptions = {}): { image: RawImage; info: ExtractInfo } {
  const { width: w, height: h, data } = img
  const n = w * h
  const threshold = options.alphaThreshold ?? 8
  const labels = new Int32Array(n).fill(-1)
  const queue = new Int32Array(n)
  const comps: Component[] = []
  for (let start = 0; start < n; start++) {
    if (labels[start] !== -1 || data[start * 4 + 3] <= threshold) continue
    const id = comps.length
    const c: Component = { area: 0, x0: w, y0: h, x1: -1, y1: -1 }
    let qh = 0
    let qt = 0
    labels[start] = id
    queue[qt++] = start
    while (qh < qt) {
      const p = queue[qh++]
      const x = p % w
      const y = (p - x) / w
      c.area++
      if (x < c.x0) c.x0 = x
      if (x > c.x1) c.x1 = x
      if (y < c.y0) c.y0 = y
      if (y > c.y1) c.y1 = y
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy
        if (yy < 0 || yy >= h) continue
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx
          if (xx < 0 || xx >= w) continue
          const q = yy * w + xx
          if (labels[q] === -1 && data[q * 4 + 3] > threshold) {
            labels[q] = id
            queue[qt++] = q
          }
        }
      }
    }
    comps.push(c)
  }
  if (comps.length === 0) {
    return {
      image: { data: new Uint8Array(4), width: 1, height: 1 },
      info: { components: 0, kept: 0, dropped: 0, mainArea: 0, bbox: { x: 0, y: 0, w: 1, h: 1 } }
    }
  }
  let mainId = 0
  for (let i = 1; i < comps.length; i++) if (comps[i].area > comps[mainId].area) mainId = i
  const main = comps[mainId]
  const near = options.nearDistance ?? Math.round(Math.max(main.x1 - main.x0, main.y1 - main.y0) * 0.06)
  const minArea = options.minArea ?? Math.max(12, Math.round(main.area * 0.0005))
  const keep = new Uint8Array(comps.length)
  keep[mainId] = 1
  const union: Component = { ...main }
  let changed = true
  while (changed) {
    changed = false
    for (let i = 0; i < comps.length; i++) {
      if (keep[i]) continue
      const c = comps[i]
      if (c.area < minArea) continue
      if (gap(c, union) <= near) {
        keep[i] = 1
        union.x0 = Math.min(union.x0, c.x0)
        union.y0 = Math.min(union.y0, c.y0)
        union.x1 = Math.max(union.x1, c.x1)
        union.y1 = Math.max(union.y1, c.y1)
        changed = true
      }
    }
  }
  const pad = options.padding ?? 0
  const box: Box = {
    x: Math.max(0, union.x0 - pad),
    y: Math.max(0, union.y0 - pad),
    w: Math.min(w, union.x1 + pad + 1) - Math.max(0, union.x0 - pad),
    h: Math.min(h, union.y1 + pad + 1) - Math.max(0, union.y0 - pad)
  }
  const cleaned: RawImage = { data: data.slice(), width: w, height: h }
  for (let p = 0; p < n; p++) {
    const l = labels[p]
    if (l >= 0 && keep[l] === 0) cleaned.data[p * 4 + 3] = 0
  }
  let kept = 0
  for (let i = 0; i < comps.length; i++) if (keep[i]) kept++
  return {
    image: crop(cleaned, box),
    info: { components: comps.length, kept, dropped: comps.length - kept, mainArea: main.area, bbox: box }
  }
}
