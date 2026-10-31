import type { Direction, StripQa, StripQaCheck, ViewAngle } from '@shared/sprite'
import { resizeRaw, createImage } from '../pipeline/image'
import type { RawImage } from '../pipeline/types'
import { DIR_TEXT, VIEW_TEXT, blitClip, cellBox, cellContent, median, same, scaleRegion, type Box, type StripLayout } from './strip'

export const ANIM_TEXT: Record<string, string> = {
  idle: 'idle loop: standing in place, gentle breathing / bobbing, feet planted',
  walk: 'walk cycle: legs alternate (contact, passing, contact on the other leg), arms swing opposite to legs, body bobs slightly',
  run: 'run cycle: longer strides, both feet briefly off the ground, body leaning forward, arms pumping',
  attack: 'attack: anticipation wind-up, fast strike, follow-through, recovery back to the ready pose',
  hurt: 'hurt: flinch back from a hit, short recoil, back to stance',
  die: 'death: stagger, fall, final frames lying on the ground',
  jump: 'jump: crouch, take off, airborne, land'
}

export function animText(name: string): string {
  const key = Object.keys(ANIM_TEXT).find((k) => name.toLowerCase().includes(k))
  return key ? ANIM_TEXT[key] : `${name} animation, smooth readable key poses`
}

export function composeGuide(ref: RawImage, l: StripLayout, fill = 0.82): Promise<RawImage> {
  return guideAsync(ref, l, fill)
}

async function guideAsync(ref: RawImage, l: StripLayout, fill: number): Promise<RawImage> {
  const scale = Math.min((l.cellW * 0.9) / ref.width, (l.cellH * fill) / ref.height)
  const w = Math.max(1, Math.round(ref.width * scale))
  const h = Math.max(1, Math.round(ref.height * scale))
  const small = await resizeRaw(ref, w, h)
  const out = createImage(l.width, l.height)
  for (let i = 0; i < l.count; i++) {
    const b = cellBox(l, i)
    blitClip(out, small, b.x + l.pad + Math.floor((l.cellW - w) / 2), b.y + l.pad + (l.cellH - h) - Math.round(l.cellH * 0.04))
  }
  return out
}

export interface NewFit {
  frames: RawImage[]
  scale: number
  qa: StripQa
}

function feetCenter(img: RawImage, box: Box): number {
  const y0 = Math.round(box.y + box.height * 0.75)
  let sum = 0
  let w = 0
  for (let y = y0; y < box.y + box.height; y++) {
    for (let x = box.x; x < box.x + box.width; x++) {
      const a = img.data[(y * img.width + x) * 4 + 3]
      if (a <= 40) continue
      sum += x * a
      w += a
    }
  }
  return w ? sum / w : box.x + box.width / 2
}

export async function fitNewStrip(keyed: RawImage, l: StripLayout, targetH: number, baseline: number, grounded = true): Promise<NewFit> {
  const info = Array.from({ length: l.count }, (_, i) => {
    const region = cellBox(l, i)
    const { box, touches } = cellContent(keyed, region)
    return { region, box, touches }
  })
  const heights = info.filter((f) => f.box).map((f) => (f.box as Box).height)
  const s = heights.length ? targetH / median(heights) : 1
  const bottoms = info.filter((f) => f.box).map((f) => (f.box as Box).y - f.region.y + (f.box as Box).height)
  const by = median(bottoms)
  const frames: RawImage[] = []
  const missing: number[] = []
  const clipped: number[] = []
  const cut: number[] = []
  const heightBad: number[] = []
  let worstH = 0
  for (let i = 0; i < info.length; i++) {
    const f = info[i]
    const out = createImage(l.cellW, l.cellH)
    if (!f.box) {
      missing.push(i)
      frames.push(out)
      continue
    }
    if (f.touches) cut.push(i)
    const scaled = await scaleRegion(keyed, f.box, s)
    const fx = feetCenter(keyed, f.box)
    const dx = Math.round(l.cellW / 2 - (fx - f.box.x) * s)
    const dy = grounded ? Math.round(baseline - scaled.height) : Math.round(baseline - (by - (f.box.y - f.region.y)) * s)
    blitClip(out, scaled, dx, dy)
    if (dx < 0 || dy < 0 || dx + scaled.width > out.width || dy + scaled.height > out.height) clipped.push(i)
    const hr = Math.abs(f.box.height / median(heights) - 1)
    worstH = Math.max(worstH, hr)
    if (hr > 0.25) heightBad.push(i)
    frames.push(out)
  }
  const dup: number[] = []
  for (let i = 1; i < frames.length; i++) if (!missing.includes(i) && !missing.includes(i - 1) && same(frames[i], frames[i - 1])) dup.push(i)
  const checks: StripQaCheck[] = [
    { id: 'missing', status: missing.length ? 'fail' : 'pass', value: missing.length, threshold: 0, frames: missing, message: missing.length ? `${missing.length} frame(s) empty in AI output` : 'all frames present' },
    { id: 'height', status: heightBad.length ? 'warn' : 'pass', value: Math.round(worstH * 100), threshold: 25, frames: heightBad, message: `max height spread ${Math.round(worstH * 100)}%` },
    { id: 'clipped', status: clipped.length ? 'warn' : 'pass', value: clipped.length, threshold: 0, frames: clipped, message: clipped.length ? `${clipped.length} frame(s) clipped by the cell` : 'no clipping' },
    { id: 'cut', status: cut.length ? 'warn' : 'pass', value: cut.length, threshold: 0, frames: cut, message: cut.length ? `${cut.length} frame(s) touch the AI cell border` : 'cells separated' },
    { id: 'duplicate', status: dup.length ? 'warn' : 'pass', value: dup.length, threshold: 0, frames: dup, message: dup.length ? `${dup.length} frame(s) identical to the previous one` : 'frames differ' }
  ]
  return { frames, scale: s, qa: { pass: !checks.some((c) => c.status === 'fail'), checks } }
}

export interface NewPromptInput {
  stylePrompt: string
  description: string
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

export function buildNewStripPrompt(p: NewPromptInput): string {
  const l = p.layout
  const lines: string[] = []
  let idx = 2
  lines.push('Create a game sprite animation sheet. Generate exactly one image with the image generation tool.')
  lines.push('')
  lines.push(
    `Image 1 is the LAYOUT GUIDE and CHARACTER REFERENCE: ${l.cols} column(s) x ${l.rows} row(s) of cells, ${l.count} cells in use, each showing the character's reference look. Redraw every cell as one frame of the animation, read left to right, top to bottom.`
  )
  if (p.lockCount > 0) {
    lines.push(`Image${p.lockCount > 1 ? `s ${idx}-${idx + p.lockCount - 1} are` : ` ${idx} is`} the CHARACTER LOCK: already approved frames of this exact character. Match face, hair, outfit, colors, proportions and rendering exactly.`)
    idx += p.lockCount
  }
  if (p.styleImageCount > 0) {
    lines.push(`Image${p.styleImageCount > 1 ? `s ${idx}-${idx + p.styleImageCount - 1} are` : ` ${idx} is`} the STYLE LOCK: copy rendering style, outline weight, shading and palette, never its objects.`)
    idx += p.styleImageCount
  }
  if (p.refImageCount > 0) lines.push(`The last ${p.refImageCount} image(s) are extra style references only.`)
  lines.push('')
  lines.push(`Animation: "${p.anim}" — ${animText(p.anim)}. ${l.count} frames forming a smooth loop${/die|attack|hurt|jump/i.test(p.anim) ? ' (or a one-shot sequence)' : ''}.`)
  lines.push(`Facing: ${p.dir ? DIR_TEXT[p.dir] : 'facing the camera'}, ${VIEW_TEXT[p.view]}. Every frame faces the same direction.`)
  if (p.description.trim()) lines.push(`Character: ${p.description.trim()}`)
  if (p.stylePrompt.trim()) {
    lines.push('')
    lines.push('Target style:')
    lines.push(p.stylePrompt.trim())
  }
  if (p.note && p.note.trim()) {
    lines.push('')
    lines.push(`Notes: ${p.note.trim()}`)
  }
  lines.push('')
  lines.push('Hard rules:')
  lines.push(`- Keep the same ${l.cols} x ${l.rows} grid with exactly ${l.count} frames; each frame is centered in its own cell, same size as the reference, feet on the same ground line near the cell bottom. Empty cells stay empty.`)
  lines.push('- Same character in every frame: identical design, colors, proportions and size. Only the pose changes, following the animation.')
  lines.push('- Consecutive frames must differ clearly (readable poses), never copy the reference pose into every cell.')
  lines.push('- Leave clear empty space between cells. No grid lines, borders, frame numbers, labels, text or extra objects.')
  lines.push(`- Background: fill the entire canvas with one ${p.chromaName}, exact hex ${p.chromaHex}. No gradient, texture or floor. Never use this color on the character.`)
  lines.push(`- The output canvas aspect ratio must be ${l.aspect}.`)
  lines.push('- Clean crisp edges, no blur.')
  lines.push('')
  lines.push('Do not write code, files or scripts.')
  return lines.join('\n')
}
