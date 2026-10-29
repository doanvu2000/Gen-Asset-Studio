import { colorDistance, createImage } from './image'
import type { RawImage, RemoveBackgroundInfo, RemoveBackgroundOptions, Rgb } from './types'

function median(values: number[]): number {
  if (values.length === 0) return 0
  const s = values.slice().sort((a, b) => a - b)
  return s[s.length >> 1]
}

function estimateBackground(img: RawImage, nominal: Rgb): { bg: Rgb; noise: number } {
  const { width: w, height: h, data } = img
  const ring = Math.max(2, Math.round(Math.min(w, h) / 256))
  const samples: number[] = []
  const push = (x: number, y: number): void => {
    const i = (y * w + x) * 4
    samples.push(data[i], data[i + 1], data[i + 2], data[i + 3])
  }
  for (let r = 0; r < ring; r++) {
    for (let x = 0; x < w; x++) {
      push(x, r)
      push(x, h - 1 - r)
    }
    for (let y = ring; y < h - ring; y++) {
      push(r, y)
      push(w - 1 - r, y)
    }
  }
  const all: Rgb[] = []
  const nearNominal: Rgb[] = []
  for (let i = 0; i < samples.length; i += 4) {
    if (samples[i + 3] < 128) continue
    const c: Rgb = [samples[i], samples[i + 1], samples[i + 2]]
    all.push(c)
    if (colorDistance(c[0], c[1], c[2], nominal) < 140) nearNominal.push(c)
  }
  const pool = nearNominal.length >= all.length * 0.2 && nearNominal.length > 0 ? nearNominal : all
  if (pool.length === 0) return { bg: nominal, noise: 0 }
  const bg: Rgb = [median(pool.map((c) => c[0])), median(pool.map((c) => c[1])), median(pool.map((c) => c[2]))]
  const dists = pool.map((c) => colorDistance(c[0], c[1], c[2], bg)).sort((a, b) => a - b)
  return { bg, noise: dists[Math.min(dists.length - 1, Math.floor(dists.length * 0.99))] }
}

function mixAlpha(data: Uint8Array, i: number, bg: Rgb, tol: number): number {
  let a = 0
  for (let c = 0; c < 3; c++) {
    const v = data[i + c]
    const k = bg[c]
    const dev = Math.max(0, Math.abs(v - k) - tol)
    const need = dev / Math.max(tol + 1, v > k ? 255 - k : k)
    if (need > a) a = need
  }
  return Math.min(1, a)
}

function boxBlurRgb(img: RawImage, r: number): Float32Array {
  const { width: w, height: h, data } = img
  const tmp = new Float32Array(w * h * 3)
  const out = new Float32Array(w * h * 3)
  const span = 2 * r + 1
  for (let y = 0; y < h; y++) {
    for (let c = 0; c < 3; c++) {
      let acc = 0
      for (let k = -r; k <= r; k++) acc += data[(y * w + Math.min(w - 1, Math.max(0, k))) * 4 + c]
      for (let x = 0; x < w; x++) {
        tmp[(y * w + x) * 3 + c] = acc / span
        const add = Math.min(w - 1, x + r + 1)
        const sub = Math.max(0, x - r)
        acc += data[(y * w + add) * 4 + c] - data[(y * w + sub) * 4 + c]
      }
    }
  }
  for (let x = 0; x < w; x++) {
    for (let c = 0; c < 3; c++) {
      let acc = 0
      for (let k = -r; k <= r; k++) acc += tmp[(Math.min(h - 1, Math.max(0, k)) * w + x) * 3 + c]
      for (let y = 0; y < h; y++) {
        out[(y * w + x) * 3 + c] = acc / span
        const add = Math.min(h - 1, y + r + 1)
        const sub = Math.max(0, y - r)
        acc += tmp[(add * w + x) * 3 + c] - tmp[(sub * w + x) * 3 + c]
      }
    }
  }
  return out
}

function writeUnmixed(
  od: Uint8Array,
  i: number,
  r: number,
  g: number,
  b: number,
  bg: Rgb,
  alpha: number,
  fr: number,
  fg: number,
  fb: number
): void {
  if (alpha <= 0.05) return
  if (alpha >= 0.92) {
    od[i] = r
    od[i + 1] = g
    od[i + 2] = b
    od[i + 3] = 255
    return
  }
  const cr = Math.min(255, Math.max(0, bg[0] + (r - bg[0]) / alpha))
  const cg = Math.min(255, Math.max(0, bg[1] + (g - bg[1]) / alpha))
  const cb = Math.min(255, Math.max(0, bg[2] + (b - bg[2]) / alpha))
  const k = fr < 0 ? 1 : alpha
  od[i] = Math.round(fr * (1 - k) + cr * k)
  od[i + 1] = Math.round(fg * (1 - k) + cg * k)
  od[i + 2] = Math.round(fb * (1 - k) + cb * k)
  od[i + 3] = Math.round(alpha * 255)
}

export function removeBackground(
  img: RawImage,
  chroma: Rgb,
  options: RemoveBackgroundOptions = {}
): { image: RawImage; info: RemoveBackgroundInfo } {
  const { width: w, height: h, data } = img
  const n = w * h
  const { bg, noise } = estimateBackground(img, chroma)
  const hard = options.hardTolerance ?? Math.min(80, Math.max(24, noise * 3 + 10))
  const band = options.bandWidth ?? Math.max(2, Math.round(Math.max(w, h) / 512) + 2)
  const minHoleArea = options.minHoleArea ?? Math.max(16, Math.round(n * 0.00002))
  const holeMode = options.holes ?? 'auto'

  const dist = new Float32Array(n)
  for (let p = 0; p < n; p++) {
    const i = p * 4
    dist[p] = data[i + 3] < 10 ? 0 : colorDistance(data[i], data[i + 1], data[i + 2], bg)
  }

  const mask = new Uint8Array(n)
  const queue = new Int32Array(n)
  let qh = 0
  let qt = 0
  const seed = (p: number): void => {
    if (mask[p] === 0 && dist[p] < hard) {
      mask[p] = 1
      queue[qt++] = p
    }
  }
  for (let x = 0; x < w; x++) {
    seed(x)
    seed((h - 1) * w + x)
  }
  for (let y = 0; y < h; y++) {
    seed(y * w)
    seed(y * w + w - 1)
  }
  while (qh < qt) {
    const p = queue[qh++]
    const x = p % w
    const y = (p - x) / w
    if (x > 0) seed(p - 1)
    if (x < w - 1) seed(p + 1)
    if (y > 0) seed(p - w)
    if (y < h - 1) seed(p + w)
  }
  const outsidePixels = qt

  const noiseTol = Math.max(3, noise)
  const minAlpha = new Float32Array(n)
  for (let p = 0; p < n; p++) minAlpha[p] = mixAlpha(data, p * 4, bg, noiseTol)
  const glow = new Uint8Array(n)
  let glowPixels = 0
  if (options.softGlow !== false) {
    const blur = boxBlurRgb(img, 2)
    const slope = options.glowSlope ?? 80 / Math.max(w, h)
    const glowMax = options.glowMaxAlpha ?? 0.9
    const colorStep = options.glowColorStep ?? 60
    const refColor = new Float32Array(n * 3)
    const hasRef = new Uint8Array(n)
    const blurAlpha = new Float32Array(n)
    const px = new Uint8Array(4)
    for (let p = 0; p < n; p++) {
      px[0] = blur[p * 3]
      px[1] = blur[p * 3 + 1]
      px[2] = blur[p * 3 + 2]
      blurAlpha[p] = mixAlpha(px, 0, bg, noiseTol * 0.5)
    }
    const depth = new Uint16Array(n)
    qh = 0
    qt = 0
    for (let p = 0; p < n; p++) if (mask[p] !== 0) queue[qt++] = p
    while (qh < qt) {
      const p = queue[qh++]
      const x = p % w
      const y = (p - x) / w
      const dq = Math.min(65535, depth[p] + 1)
      const visit = (q: number): void => {
        if (mask[q] !== 0 || glow[q] !== 0 || blurAlpha[q] >= glowMax) return
        if (blurAlpha[q] > 0.08 + slope * dq || blurAlpha[q] < blurAlpha[p] - 0.02) return
        const aq = blurAlpha[q]
        if (aq > 0.3) {
          let d2 = 0
          for (let c = 0; c < 3; c++) {
            const cq = bg[c] + (blur[q * 3 + c] - bg[c]) / aq
            const ref = hasRef[p] ? refColor[p * 3 + c] : cq
            refColor[q * 3 + c] = ref
            d2 += (cq - ref) * (cq - ref)
          }
          if (d2 > colorStep * colorStep) return
          hasRef[q] = 1
        }
        glow[q] = 1
        depth[q] = dq
        queue[qt++] = q
      }
      if (x > 0) visit(p - 1)
      if (x < w - 1) visit(p + 1)
      if (y > 0) visit(p - w)
      if (y < h - 1) visit(p + w)
    }
    for (let p = 0; p < n; p++) {
      if (glow[p] === 0) continue
      if (dist[p] < hard || minAlpha[p] <= 0.06) {
        glow[p] = 0
        mask[p] = 1
      } else {
        glowPixels++
      }
    }
  }

  let holesKeyed = 0
  let holesKept = 0
  if (holeMode !== 'outside-only') {
    const seen = new Uint8Array(n)
    for (let start = 0; start < n; start++) {
      if (mask[start] !== 0 || seen[start] !== 0 || dist[start] >= hard) continue
      qh = 0
      qt = 0
      seen[start] = 1
      queue[qt++] = start
      let sum = 0
      while (qh < qt) {
        const p = queue[qh++]
        sum += dist[p]
        const x = p % w
        const y = (p - x) / w
        const visit = (q: number): void => {
          if (seen[q] === 0 && mask[q] === 0 && dist[q] < hard) {
            seen[q] = 1
            queue[qt++] = q
          }
        }
        if (x > 0) visit(p - 1)
        if (x < w - 1) visit(p + 1)
        if (y > 0) visit(p - w)
        if (y < h - 1) visit(p + w)
      }
      const area = qt
      const mean = sum / area
      const key = holeMode === 'all' ? area >= minHoleArea : area >= minHoleArea && mean < Math.max(noise * 2, hard * 0.6)
      if (key) {
        for (let k = 0; k < area; k++) mask[queue[k]] = 2
        holesKeyed++
      } else {
        holesKept++
      }
    }
  }

  const ring = new Uint8Array(n).fill(255)
  qh = 0
  qt = 0
  for (let p = 0; p < n; p++) {
    if (mask[p] !== 0) {
      ring[p] = 0
      queue[qt++] = p
    }
  }
  while (qh < qt) {
    const p = queue[qh++]
    const d = ring[p]
    if (d >= band) continue
    const x = p % w
    const y = (p - x) / w
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy
      if (yy < 0 || yy >= h) continue
      for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx
        if (xx < 0 || xx >= w) continue
        const q = yy * w + xx
        if (ring[q] === 255) {
          ring[q] = d + 1
          queue[qt++] = q
        }
      }
    }
  }

  const out = createImage(w, h)
  const od = out.data
  const radius = band + 3
  let bandPixels = 0
  let unmixedPixels = 0
  for (let p = 0; p < n; p++) {
    const i = p * 4
    if (mask[p] !== 0) continue
    const r = data[i]
    const g = data[i + 1]
    const b = data[i + 2]
    if (glow[p] !== 0) {
      writeUnmixed(od, i, r, g, b, bg, minAlpha[p], -1, 0, 0)
      continue
    }
    if (ring[p] === 255) {
      od[i] = r
      od[i + 1] = g
      od[i + 2] = b
      od[i + 3] = 255
      continue
    }
    bandPixels++
    const x = p % w
    const y = (p - x) / w
    let best = Infinity
    let fr = 0
    let fg = 0
    let fb = 0
    let fc = 0
    const y0 = Math.max(0, y - radius)
    const y1 = Math.min(h - 1, y + radius)
    const x0 = Math.max(0, x - radius)
    const x1 = Math.min(w - 1, x + radius)
    for (let yy = y0; yy <= y1; yy++) {
      for (let xx = x0; xx <= x1; xx++) {
        const q = yy * w + xx
        if (ring[q] !== 255 || glow[q] !== 0) continue
        const dd = (xx - x) * (xx - x) + (yy - y) * (yy - y)
        if (dd < best - 2) {
          best = dd
          fr = fg = fb = fc = 0
        }
        if (dd <= best + 2) {
          const qi = q * 4
          fr += data[qi]
          fg += data[qi + 1]
          fb += data[qi + 2]
          fc++
        }
      }
    }
    let a: number
    if (fc > 0) {
      fr /= fc
      fg /= fc
      fb /= fc
      const vr = fr - bg[0]
      const vg = fg - bg[1]
      const vb = fb - bg[2]
      const len2 = vr * vr + vg * vg + vb * vb
      if (len2 >= 48 * 48) {
        a = ((r - bg[0]) * vr + (g - bg[1]) * vg + (b - bg[2]) * vb) / len2
        unmixedPixels++
      } else {
        a = minAlpha[p]
      }
    } else {
      a = minAlpha[p]
      fr = r
      fg = g
      fb = b
    }
    writeUnmixed(od, i, r, g, b, bg, a, fr, fg, fb)
  }

  return {
    image: out,
    info: {
      bg,
      bgNoiseP99: Math.round(noise * 10) / 10,
      hardTolerance: Math.round(hard * 10) / 10,
      outsidePixels,
      holesKeyed,
      holesKept,
      bandPixels,
      unmixedPixels,
      glowPixels
    }
  }
}
