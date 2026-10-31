import { DIRECTIONS, type AtlasTag, type Direction, type FrameRect, type GridSpec, type LoopMode, type SpriteAnim, type SpriteSettings } from '@shared/sprite'

const VERT: Record<string, 'S' | 'N'> = { s: 'S', south: 'S', down: 'S', front: 'S', d: 'S', n: 'N', north: 'N', up: 'N', back: 'N', u: 'N' }
const HORZ: Record<string, 'W' | 'E'> = { w: 'W', west: 'W', left: 'W', l: 'W', e: 'E', east: 'E', right: 'E', r: 'E' }
const SINGLE: Record<string, Direction> = {
  s: 'S',
  south: 'S',
  down: 'S',
  front: 'S',
  n: 'N',
  north: 'N',
  up: 'N',
  back: 'N',
  w: 'W',
  west: 'W',
  left: 'W',
  e: 'E',
  east: 'E',
  right: 'E',
  sw: 'SW',
  se: 'SE',
  nw: 'NW',
  ne: 'NE',
  southwest: 'SW',
  southeast: 'SE',
  northwest: 'NW',
  northeast: 'NE',
  downleft: 'SW',
  downright: 'SE',
  upleft: 'NW',
  upright: 'NE',
  leftdown: 'SW',
  rightdown: 'SE',
  leftup: 'NW',
  rightup: 'NE',
  frontleft: 'SW',
  frontright: 'SE',
  backleft: 'NW',
  backright: 'NE'
}

function combine(v: 'S' | 'N', h: 'W' | 'E'): Direction {
  return `${v}${h}` as Direction
}

export function animId(name: string, dir: Direction | null, taken?: Set<string>): string {
  const base = `a_${name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || 'anim'}_${dir ? dir.toLowerCase() : 'x'}`.slice(0, 60)
  if (!taken) return base
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`
  taken.add(id)
  return id
}

function defaultFps(name: string): number {
  return /idle|stand|breath/i.test(name) ? 6 : 10
}

function makeAnim(name: string, dir: Direction | null, frames: number[], taken: Set<string>, loop: LoopMode = 'loop'): SpriteAnim {
  return { id: animId(name, dir, taken), name, dir, frames, fps: defaultFps(name), loop }
}

function tokensOf(name: string): string[] {
  const noExt = name.replace(/\.(png|jpe?g|webp|gif|bmp|tga)$/i, '')
  return noExt
    .replace(/([a-z])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .split(/[_\-.\s/\\]+/)
    .filter(Boolean)
}

export function splitName(name: string): { base: string; dir: Direction | null; index: number | null } {
  const tokens = tokensOf(name)
  let index: number | null = null
  while (tokens.length) {
    const last = tokens[tokens.length - 1]
    if (/^\d+$/.test(last)) {
      if (index === null) index = Number(last)
      tokens.pop()
      continue
    }
    const m = /^(.*?[a-z])(\d+)$/.exec(last)
    if (m) {
      if (index === null) index = Number(m[2])
      tokens[tokens.length - 1] = m[1]
    }
    break
  }
  let dir: Direction | null = null
  if (tokens.length >= 2) {
    const a = tokens[tokens.length - 2]
    const b = tokens[tokens.length - 1]
    if (a in VERT && b in HORZ && (a.length > 1 || b.length > 1)) dir = combine(VERT[a], HORZ[b])
    else if (a in HORZ && b in VERT && (a.length > 1 || b.length > 1)) dir = combine(VERT[b], HORZ[a])
    if (dir) tokens.splice(-2, 2)
  }
  if (!dir && tokens.length >= 1) {
    const last = tokens[tokens.length - 1]
    const d = SINGLE[last]
    if (d && (tokens.length > 1 || last.length > 2)) {
      dir = d
      tokens.pop()
    }
  }
  return { base: tokens.join('_') || 'anim', dir, index }
}

export function animsFromNames(frames: FrameRect[]): SpriteAnim[] {
  const groups = new Map<string, { base: string; dir: Direction | null; items: Array<{ i: number; index: number | null }> }>()
  frames.forEach((f, i) => {
    const s = splitName(f.name)
    const key = `${s.base}|${s.dir ?? ''}`
    let g = groups.get(key)
    if (!g) {
      g = { base: s.base, dir: s.dir, items: [] }
      groups.set(key, g)
    }
    g.items.push({ i, index: s.index })
  })
  const taken = new Set<string>()
  const out: SpriteAnim[] = []
  for (const g of groups.values()) {
    const items = g.items.every((x) => x.index !== null) ? [...g.items].sort((a, b) => (a.index as number) - (b.index as number)) : g.items
    out.push(makeAnim(g.base, g.dir, items.map((x) => x.i), taken))
  }
  return out
}

export function animsFromTags(tags: AtlasTag[], frameCount: number): SpriteAnim[] {
  const taken = new Set<string>()
  const out: SpriteAnim[] = []
  for (const t of tags) {
    const from = Math.max(0, t.from)
    const to = Math.min(frameCount - 1, t.to)
    if (to < from) continue
    const frames: number[] = []
    for (let i = from; i <= to; i++) frames.push(i)
    if (t.direction === 'reverse') frames.reverse()
    const s = splitName(t.name)
    const name = s.dir ? s.base : t.name
    out.push(makeAnim(name, s.dir, frames, taken, t.direction === 'pingpong' ? 'pingpong' : 'loop'))
  }
  return out
}

export function dirOrder(settings: SpriteSettings): Direction[] {
  if (!settings.dirSet) return []
  const set = DIRECTIONS[settings.dirSet]
  const order = settings.rowOrder
  if (order.length === set.length && set.every((d) => order.includes(d))) return order
  return set
}

export function animsFromGrid(grid: GridSpec, empty: number[], settings: SpriteSettings): SpriteAnim[] {
  const skip = new Set(empty)
  const taken = new Set<string>()
  const rowFrames = (r: number): number[] => {
    const out: number[] = []
    for (let c = 0; c < grid.cols; c++) {
      const idx = r * grid.cols + c
      if (!skip.has(idx)) out.push(idx)
    }
    return out
  }
  const dirs = dirOrder(settings)
  const n = dirs.length
  const out: SpriteAnim[] = []
  if (n && (grid.rows === n || grid.rows === n * 2)) {
    const names = grid.rows === n ? ['walk'] : ['idle', 'walk']
    names.forEach((name, k) => {
      dirs.forEach((dir, j) => {
        const frames = rowFrames(k * n + j)
        if (frames.length) out.push(makeAnim(name, dir, frames, taken))
      })
    })
    return out
  }
  for (let r = 0; r < grid.rows; r++) {
    const frames = rowFrames(r)
    if (frames.length) out.push(makeAnim(`row_${r + 1}`, null, frames, taken))
  }
  return out
}
