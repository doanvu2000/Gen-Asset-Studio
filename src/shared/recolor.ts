export interface RecolorRegion {
  hue: number
  range: number
}

export interface RecolorParams {
  hue: number
  sat: number
  bright: number
  region: RecolorRegion | null
}

export const RECOLOR_DEFAULT: RecolorParams = { hue: 0, sat: 100, bright: 100, region: null }

const GRAY_SAT = 0.12

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v))
}

export function normalizeRecolor(v: unknown): RecolorParams {
  const o = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>
  const num = (x: unknown, d: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : d)
  const r = o.region && typeof o.region === 'object' ? (o.region as Record<string, unknown>) : null
  return {
    hue: Math.round(clamp(num(o.hue, 0), -180, 180)),
    sat: Math.round(clamp(num(o.sat, 100), 0, 200)),
    bright: Math.round(clamp(num(o.bright, 100), 50, 150)),
    region: r ? { hue: ((Math.round(num(r.hue, 0)) % 360) + 360) % 360, range: Math.round(clamp(num(r.range, 30), 5, 90)) } : null
  }
}

export function isRecolorIdentity(p: RecolorParams): boolean {
  return p.hue === 0 && p.sat === 100 && p.bright === 100
}

export function rgbHue(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const d = max - min
  let h = 0
  if (d > 0) {
    if (max === r) h = ((g - b) / d) % 6
    else if (max === g) h = (b - r) / d + 2
    else h = (r - g) / d + 4
    h *= 60
    if (h < 0) h += 360
  }
  return { h, s: max === 0 ? 0 : d / max, v: max / 255 }
}

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const c = v * s
  const hp = (((h % 360) + 360) % 360) / 60
  const x = c * (1 - Math.abs((hp % 2) - 1))
  const m = v - c
  let r = 0
  let g = 0
  let b = 0
  if (hp < 1) [r, g, b] = [c, x, 0]
  else if (hp < 2) [r, g, b] = [x, c, 0]
  else if (hp < 3) [r, g, b] = [0, c, x]
  else if (hp < 4) [r, g, b] = [0, x, c]
  else if (hp < 5) [r, g, b] = [x, 0, c]
  else [r, g, b] = [c, 0, x]
  return [(r + m) * 255, (g + m) * 255, (b + m) * 255]
}

function regionWeight(h: number, s: number, region: RecolorRegion): number {
  if (s < GRAY_SAT) return 0
  const d = Math.abs(((h - region.hue + 540) % 360) - 180)
  const hard = region.range * 0.6
  if (d <= hard) return 1
  if (d >= region.range) return 0
  return 1 - (d - hard) / (region.range - hard)
}

/** In-place on RGBA bytes; alpha is never touched. */
export function recolorPixels(data: Uint8Array | Uint8ClampedArray, p: RecolorParams): void {
  if (isRecolorIdentity(p)) return
  const sat = p.sat / 100
  const bright = p.bright / 100
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    const { h, s, v } = rgbHue(r, g, b)
    const w = p.region ? regionWeight(h, s, p.region) : 1
    if (w === 0) continue
    const [nr, ng, nb] = hsvToRgb(h + p.hue, clamp(s * sat, 0, 1), clamp(v * bright, 0, 1))
    data[i] = Math.round(r + (nr - r) * w)
    data[i + 1] = Math.round(g + (ng - g) * w)
    data[i + 2] = Math.round(b + (nb - b) * w)
  }
}
