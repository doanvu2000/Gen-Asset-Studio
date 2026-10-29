import { colorDistance, decode, hexToRgb, hue, resizeRaw } from './image'
import type { ChromaColor, ChromaName, ChromaPick, ChromaScore, ImageInput, PickChromaOptions, RawImage } from './types'

export const CHROMA_COLORS: Record<ChromaName, ChromaColor> = {
  magenta: { name: 'magenta', hex: '#FF00FF', rgb: [255, 0, 255] },
  green: { name: 'green', hex: '#00FF00', rgb: [0, 255, 0] },
  blue: { name: 'blue', hex: '#0000FF', rgb: [0, 0, 255] },
  cyan: { name: 'cyan', hex: '#00FFFF', rgb: [0, 255, 255] },
  yellow: { name: 'yellow', hex: '#FFFF00', rgb: [255, 255, 0] }
}

const PROMPT_NAMES: Record<ChromaName, string> = {
  magenta: 'solid flat magenta (#FF00FF)',
  green: 'solid flat pure green (#00FF00)',
  blue: 'solid flat pure blue (#0000FF)',
  cyan: 'solid flat cyan (#00FFFF)',
  yellow: 'solid flat yellow (#FFFF00)'
}

const DEFAULT_CANDIDATES: ChromaName[] = ['magenta', 'green', 'blue']
const SAMPLE_SIDE = 160

export function resolveChroma(c: ChromaColor | string): ChromaColor {
  if (typeof c !== 'string') return c
  const key = c.toLowerCase() as ChromaName
  if (key in CHROMA_COLORS) return CHROMA_COLORS[key]
  const rgb = hexToRgb(c)
  const known = Object.values(CHROMA_COLORS).find((k) => k.rgb.every((v, i) => v === rgb[i]))
  return known ?? { name: 'magenta', hex: c.toUpperCase(), rgb }
}

async function opaquePixels(img: RawImage): Promise<number[]> {
  const scale = Math.min(1, SAMPLE_SIDE / Math.max(img.width, img.height))
  const small = scale < 1 ? await resizeRaw(img, img.width * scale, img.height * scale) : img
  const out: number[] = []
  for (let i = 0; i < small.data.length; i += 4) {
    if (small.data[i + 3] >= 128) out.push(small.data[i], small.data[i + 1], small.data[i + 2])
  }
  return out
}

export async function pickChroma(
  source: ImageInput,
  styleRefs: ImageInput[] = [],
  options: PickChromaOptions = {}
): Promise<ChromaPick> {
  const candidates = options.candidates ?? DEFAULT_CANDIDATES
  const nearDistance = options.nearDistance ?? 150
  const pixels: number[] = []
  for (const input of [source, ...styleRefs]) {
    const img = await decode(input)
    const px = await opaquePixels(img)
    for (const v of px) pixels.push(v)
  }
  const count = pixels.length / 3
  const hueHistogram = new Array<number>(12).fill(0)
  for (let i = 0; i < pixels.length; i += 3) {
    const { h, s } = hue(pixels[i], pixels[i + 1], pixels[i + 2])
    if (s >= 0.25) hueHistogram[Math.floor(h / 30) % 12]++
  }
  const scores: ChromaScore[] = candidates.map((name) => {
    const c = CHROMA_COLORS[name]
    if (count === 0) return { name, hex: c.hex, p1Distance: 441, nearFraction: 0, score: 441 }
    const dists = new Float32Array(count)
    let near = 0
    for (let i = 0; i < count; i++) {
      const d = colorDistance(pixels[i * 3], pixels[i * 3 + 1], pixels[i * 3 + 2], c.rgb)
      dists[i] = d
      if (d < nearDistance) near++
    }
    dists.sort()
    const p1 = dists[Math.min(count - 1, Math.floor(count * 0.01))]
    const nearFraction = near / count
    return { name, hex: c.hex, p1Distance: Math.round(p1), nearFraction, score: p1 * (1 - nearFraction) }
  })
  const best = scores.reduce((a, b) => (b.score > a.score ? b : a))
  const color = CHROMA_COLORS[best.name]
  return { ...color, promptName: PROMPT_NAMES[best.name], scores, hueHistogram, sampledPixels: count }
}
