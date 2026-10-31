import sharp from 'sharp'
import { promises as fs } from 'node:fs'
import type { FrameRect, GridSpec } from '@shared/sprite'

interface AlphaMap {
  width: number
  height: number
  hasAlpha: boolean
  alpha: Uint8Array
}

const ALPHA_MIN = 8
const CACHE_MAX = 4
const cache = new Map<string, AlphaMap>()

export async function loadAlpha(abs: string): Promise<AlphaMap> {
  const st = await fs.stat(abs)
  const key = `${abs}|${Math.round(st.mtimeMs)}|${st.size}`
  const hit = cache.get(key)
  if (hit) {
    cache.delete(key)
    cache.set(key, hit)
    return hit
  }
  const meta = await sharp(abs).metadata()
  const { data, info } = await sharp(abs).ensureAlpha().extractChannel(3).raw().toBuffer({ resolveWithObject: true })
  const map: AlphaMap = {
    width: info.width,
    height: info.height,
    hasAlpha: meta.hasAlpha === true,
    alpha: new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  }
  for (const k of [...cache.keys()]) if (k.startsWith(`${abs}|`)) cache.delete(k)
  cache.set(key, map)
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string)
  return map
}

function projections(m: AlphaMap): { cols: Uint8Array; rows: Uint8Array } {
  const cols = new Uint8Array(m.width)
  const rows = new Uint8Array(m.height)
  for (let y = 0; y < m.height; y++) {
    const off = y * m.width
    for (let x = 0; x < m.width; x++) {
      if (m.alpha[off + x] > ALPHA_MIN) {
        cols[x] = 1
        rows[y] = 1
      }
    }
  }
  return { cols, rows }
}

function segments(occ: Uint8Array): Array<[number, number]> {
  const out: Array<[number, number]> = []
  let start = -1
  for (let i = 0; i <= occ.length; i++) {
    const on = i < occ.length && occ[i] === 1
    if (on && start < 0) start = i
    else if (!on && start >= 0) {
      out.push([start, i])
      start = -1
    }
  }
  return out
}

function median(v: number[]): number {
  const s = [...v].sort((a, b) => a - b)
  return s.length ? s[Math.floor(s.length / 2)] : 0
}

function boundaryScore(occ: Uint8Array, cell: number): number {
  const n = Math.floor(occ.length / cell)
  if (n <= 1) return 1
  let clear = 0
  for (let k = 1; k < n; k++) {
    const x = k * cell
    if (!occ[x] && !occ[x - 1]) clear++
  }
  return clear / (n - 1)
}

function pickCell(occ: Uint8Array): number | null {
  const len = occ.length
  const segs = segments(occ)
  if (!segs.length) return null
  if (segs.length === 1) return len
  const centers = segs.map(([a, b]) => (a + b) / 2)
  const diffs: number[] = []
  for (let i = 1; i < centers.length; i++) diffs.push(centers[i] - centers[i - 1])
  const smallest = Math.min(...diffs)
  const unit = diffs.filter((d) => d < smallest * 1.5)
  const pitch = median(unit.length ? unit : diffs)
  if (pitch < 4) return null
  let best: number | null = null
  let bestScore = -1
  for (let c = Math.max(4, Math.floor(pitch * 0.75)); c <= Math.ceil(pitch * 1.25); c++) {
    if (len % c !== 0) continue
    const score = boundaryScore(occ, c) - Math.abs(c - pitch) / (pitch * 10)
    if (score > bestScore) {
      bestScore = score
      best = c
    }
  }
  if (best !== null && boundaryScore(occ, best) >= 0.85) return best
  const rounded = Math.round(pitch)
  return boundaryScore(occ, rounded) >= 0.85 ? rounded : null
}

function fallbackCell(len: number, other: number): number {
  if (len % other === 0) return other
  for (const c of [128, 64, 256, 32]) if (len % c === 0 && len >= c) return c
  return len
}

export function makeGrid(w: number, h: number, cellW: number, cellH: number): GridSpec {
  return {
    cellW,
    cellH,
    cols: Math.max(1, Math.floor(w / cellW)),
    rows: Math.max(1, Math.floor(h / cellH)),
    offsetX: 0,
    offsetY: 0,
    gapX: 0,
    gapY: 0
  }
}

export async function detectGrid(abs: string): Promise<GridSpec | null> {
  let m: AlphaMap
  try {
    m = await loadAlpha(abs)
  } catch {
    return null
  }
  const { width: w, height: h } = m
  if (!w || !h) return null
  let cellW: number | null = null
  let cellH: number | null = null
  if (m.hasAlpha) {
    const { cols, rows } = projections(m)
    cellW = pickCell(cols)
    cellH = pickCell(rows)
  }
  if (cellW && !cellH) cellH = h % cellW === 0 ? cellW : fallbackCell(h, cellW)
  if (cellH && !cellW) cellW = w % cellH === 0 ? cellH : fallbackCell(w, cellH)
  if (!cellW || !cellH) {
    const side = Math.min(w, h)
    if (w % side === 0 && h % side === 0) {
      cellW = side
      cellH = side
    } else {
      cellW = fallbackCell(w, h)
      cellH = fallbackCell(h, cellW)
    }
  }
  return makeGrid(w, h, cellW, cellH)
}

export function gridFrames(grid: GridSpec): FrameRect[] {
  const out: FrameRect[] = []
  for (let r = 0; r < grid.rows; r++) {
    for (let c = 0; c < grid.cols; c++) {
      out.push({
        name: `r${r}_c${c}`,
        x: grid.offsetX + c * (grid.cellW + grid.gapX),
        y: grid.offsetY + r * (grid.cellH + grid.gapY),
        w: grid.cellW,
        h: grid.cellH,
        rotated: false,
        trimmed: false,
        srcX: 0,
        srcY: 0,
        srcW: grid.cellW,
        srcH: grid.cellH,
        pivotX: 0.5,
        pivotY: 1
      })
    }
  }
  return out
}

export async function emptyCells(abs: string, frames: FrameRect[]): Promise<number[]> {
  let m: AlphaMap
  try {
    m = await loadAlpha(abs)
  } catch {
    return []
  }
  if (!m.hasAlpha) return []
  const out: number[] = []
  frames.forEach((f, i) => {
    const x0 = Math.max(0, f.x)
    const y0 = Math.max(0, f.y)
    const x1 = Math.min(m.width, f.x + f.w)
    const y1 = Math.min(m.height, f.y + f.h)
    for (let y = y0; y < y1; y++) {
      const off = y * m.width
      for (let x = x0; x < x1; x++) if (m.alpha[off + x] > ALPHA_MIN) return
    }
    out.push(i)
  })
  return out
}
