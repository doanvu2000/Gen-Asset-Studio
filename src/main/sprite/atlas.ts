import type { AtlasTag, FrameRect, ParsedAtlas, TagDirection } from '@shared/sprite'

type Plist = string | number | boolean | Plist[] | { [key: string]: Plist }

function num(v: unknown, d = 0): number {
  const n = typeof v === 'string' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : d
}

function obj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null
}

function extOf(file: string): string {
  const lower = file.toLowerCase()
  if (lower.endsWith('.meta')) return 'meta'
  const dot = lower.lastIndexOf('.')
  return dot >= 0 ? lower.slice(dot + 1) : ''
}

function makeFrame(
  name: string,
  sheet: { x: number; y: number; w: number; h: number },
  rotated: boolean,
  src: { x: number; y: number; w: number; h: number } | null,
  pivot: { x: number; y: number } | null
): FrameRect {
  const uprightW = sheet.w
  const uprightH = sheet.h
  const onSheetW = rotated ? uprightH : uprightW
  const onSheetH = rotated ? uprightW : uprightH
  const srcW = src ? Math.max(src.w, uprightW) : uprightW
  const srcH = src ? Math.max(src.h, uprightH) : uprightH
  const srcX = src ? src.x : 0
  const srcY = src ? src.y : 0
  const trimmed = !!src && (srcX !== 0 || srcY !== 0 || srcW !== uprightW || srcH !== uprightH)
  return {
    name,
    x: Math.round(sheet.x),
    y: Math.round(sheet.y),
    w: Math.round(onSheetW),
    h: Math.round(onSheetH),
    rotated,
    trimmed,
    srcX: Math.round(srcX),
    srcY: Math.round(srcY),
    srcW: Math.round(srcW),
    srcH: Math.round(srcH),
    pivotX: pivot ? pivot.x : 0.5,
    pivotY: pivot ? pivot.y : 1
  }
}

function rectOf(v: unknown): { x: number; y: number; w: number; h: number } | null {
  const o = obj(v)
  if (!o) return null
  return { x: num(o.x), y: num(o.y), w: num(o.w ?? o.width), h: num(o.h ?? o.height) }
}

function tagDir(v: unknown): TagDirection {
  const s = typeof v === 'string' ? v.toLowerCase() : ''
  return s === 'reverse' ? 'reverse' : s === 'pingpong' || s === 'pingpong_reverse' ? 'pingpong' : 'forward'
}

function parseJson(text: string): ParsedAtlas {
  let raw: unknown
  try {
    raw = JSON.parse(text.replace(/^﻿/, ''))
  } catch (e) {
    throw new Error(`Invalid JSON atlas: ${(e as Error).message}`)
  }
  const root = obj(raw)
  if (!root || !root.frames) throw new Error('Not a sprite atlas JSON (no "frames")')
  const meta = obj(root.meta) ?? {}
  const app = typeof meta.app === 'string' ? meta.app.toLowerCase() : ''
  const isAse = app.includes('aseprite') || Array.isArray(meta.frameTags)
  const entries: Array<[string, Record<string, unknown>]> = []
  const isArray = Array.isArray(root.frames)
  if (isArray) {
    ;(root.frames as unknown[]).forEach((f, i) => {
      const o = obj(f)
      if (o) entries.push([typeof o.filename === 'string' ? o.filename : `frame_${i}`, o])
    })
  } else {
    const fr = obj(root.frames)
    if (!fr) throw new Error('Atlas "frames" must be an object or array')
    for (const [k, v] of Object.entries(fr)) {
      const o = obj(v)
      if (o) entries.push([k, o])
    }
  }
  const warnings: string[] = []
  const frames: FrameRect[] = []
  for (const [name, o] of entries) {
    const r = rectOf(o.frame)
    if (!r || r.w <= 0 || r.h <= 0) {
      warnings.push(`frame "${name}" has no valid rect`)
      continue
    }
    const rotated = o.rotated === true
    const sss = rectOf(o.spriteSourceSize)
    const ss = obj(o.sourceSize)
    const src = sss || ss ? { x: sss?.x ?? 0, y: sss?.y ?? 0, w: ss ? num(ss.w) : r.w, h: ss ? num(ss.h) : r.h } : null
    const pv = obj(o.pivot)
    frames.push(makeFrame(name, r, rotated, src, pv ? { x: num(pv.x, 0.5), y: num(pv.y, 0.5) } : null))
  }
  if (!frames.length) throw new Error('Atlas has no frames')
  const tags: AtlasTag[] = []
  if (Array.isArray(meta.frameTags)) {
    for (const t of meta.frameTags) {
      const o = obj(t)
      if (!o || typeof o.name !== 'string') continue
      const from = Math.max(0, Math.round(num(o.from)))
      const to = Math.min(frames.length - 1, Math.round(num(o.to, from)))
      if (to < from) continue
      tags.push({ name: o.name, from, to, direction: tagDir(o.direction) })
    }
  }
  const size = obj(meta.size)
  return {
    format: isAse ? 'aseprite' : isArray ? 'tp-array' : 'tp-hash',
    image: typeof meta.image === 'string' && meta.image ? meta.image : null,
    width: size ? num(size.w) : 0,
    height: size ? num(size.h) : 0,
    frames,
    tags,
    warnings
  }
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCharCode(Number(d)))
    .replace(/&amp;/g, '&')
}

export function parsePlistXml(text: string): Plist {
  const tokens = text.match(/<[^>]+>|[^<]+/g) ?? []
  let i = 0
  const nextTag = (): string | null => {
    while (i < tokens.length) {
      const t = tokens[i++]
      if (t.startsWith('<?') || t.startsWith('<!')) continue
      if (t.startsWith('<')) return t
    }
    return null
  }
  const textUntil = (close: string): string => {
    let s = ''
    while (i < tokens.length && tokens[i] !== close) s += tokens[i++]
    if (tokens[i] !== close) throw new Error(`plist: missing ${close}`)
    i++
    return decodeXml(s)
  }
  const value = (tag: string): Plist => {
    const name = /^<\s*([a-zA-Z]+)/.exec(tag)?.[1] ?? ''
    const selfClosing = /\/\s*>$/.test(tag)
    switch (name) {
      case 'dict': {
        const out: Record<string, Plist> = {}
        if (selfClosing) return out
        for (;;) {
          const t = nextTag()
          if (!t) throw new Error('plist: unterminated <dict>')
          if (/^<\/\s*dict/.test(t)) return out
          if (!/^<\s*key/.test(t)) throw new Error(`plist: expected <key>, got ${t}`)
          const key = textUntil('</key>')
          const vt = nextTag()
          if (!vt) throw new Error('plist: missing value')
          out[key] = value(vt)
        }
      }
      case 'array': {
        const out: Plist[] = []
        if (selfClosing) return out
        for (;;) {
          const t = nextTag()
          if (!t) throw new Error('plist: unterminated <array>')
          if (/^<\/\s*array/.test(t)) return out
          out.push(value(t))
        }
      }
      case 'string':
      case 'date':
      case 'data':
        return selfClosing ? '' : textUntil(`</${name}>`).trim()
      case 'integer':
      case 'real':
        return selfClosing ? 0 : num(textUntil(`</${name}>`).trim())
      case 'true':
        return true
      case 'false':
        return false
      case 'plist': {
        const t = nextTag()
        if (!t) throw new Error('plist: empty')
        return value(t)
      }
      default:
        throw new Error(`plist: unexpected tag ${tag}`)
    }
  }
  const first = nextTag()
  if (!first) throw new Error('plist: empty document')
  return value(first)
}

function nums(s: unknown): number[] {
  return typeof s === 'string' ? (s.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number) : []
}

function parsePlist(text: string): ParsedAtlas {
  const root = obj(parsePlistXml(text))
  if (!root) throw new Error('plist root must be a dict')
  const framesDict = obj(root.frames)
  if (!framesDict) throw new Error('Not a Cocos sprite plist (no "frames")')
  const meta = obj(root.metadata) ?? {}
  const format = num(meta.format, 2)
  const warnings: string[] = []
  const frames: FrameRect[] = []
  for (const [name, v] of Object.entries(framesDict)) {
    const f = obj(v)
    if (!f) continue
    let rect: { x: number; y: number; w: number; h: number }
    let rotated = false
    let offX = 0
    let offY = 0
    let srcW = 0
    let srcH = 0
    let colorRect: number[] | null = null
    if (format === 0 || ('x' in f && 'width' in f)) {
      rect = { x: num(f.x), y: num(f.y), w: num(f.width), h: num(f.height) }
      offX = num(f.offsetX)
      offY = num(f.offsetY)
      srcW = num(f.originalWidth, rect.w)
      srcH = num(f.originalHeight, rect.h)
    } else if (format === 3 || 'textureRect' in f) {
      const r = nums(f.textureRect)
      rect = { x: r[0] ?? 0, y: r[1] ?? 0, w: r[2] ?? 0, h: r[3] ?? 0 }
      rotated = f.textureRotated === true
      const o = nums(f.spriteOffset)
      offX = o[0] ?? 0
      offY = o[1] ?? 0
      const s = nums(f.spriteSourceSize)
      srcW = s[0] ?? rect.w
      srcH = s[1] ?? rect.h
    } else {
      const r = nums(f.frame)
      rect = { x: r[0] ?? 0, y: r[1] ?? 0, w: r[2] ?? 0, h: r[3] ?? 0 }
      rotated = f.rotated === true
      const o = nums(f.offset)
      offX = o[0] ?? 0
      offY = o[1] ?? 0
      const s = nums(f.sourceSize)
      srcW = s[0] ?? rect.w
      srcH = s[1] ?? rect.h
      const cr = nums(f.sourceColorRect)
      if (cr.length === 4) colorRect = cr
    }
    if (rect.w <= 0 || rect.h <= 0) {
      warnings.push(`frame "${name}" has no valid rect`)
      continue
    }
    const srcX = colorRect ? colorRect[0] : (srcW - rect.w) / 2 + offX
    const srcY = colorRect ? colorRect[1] : (srcH - rect.h) / 2 - offY
    frames.push(makeFrame(name, rect, rotated, { x: srcX, y: srcY, w: srcW, h: srcH }, null))
  }
  if (!frames.length) throw new Error('plist has no frames')
  const size = nums(meta.size)
  const image =
    (typeof meta.realTextureFileName === 'string' && meta.realTextureFileName) ||
    (typeof meta.textureFileName === 'string' && meta.textureFileName) ||
    (obj(meta.target) && typeof obj(meta.target)?.textureFileName === 'string' ? (obj(meta.target)?.textureFileName as string) : '') ||
    null
  return { format: 'plist', image, width: size[0] ?? 0, height: size[1] ?? 0, frames, tags: [], warnings }
}

function yamlScalar(s: string): string {
  const t = s.trim()
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1)
  return t
}

function inlineMap(s: string): Record<string, string> {
  const out: Record<string, string> = {}
  const body = s.trim().replace(/^\{/, '').replace(/\}$/, '')
  for (const part of body.split(',')) {
    const idx = part.indexOf(':')
    if (idx > 0) out[part.slice(0, idx).trim()] = yamlScalar(part.slice(idx + 1))
  }
  return out
}

function parseUnityMeta(text: string, imageH?: number): ParsedAtlas {
  if (!/TextureImporter\s*:/.test(text)) throw new Error('Not a Unity texture .meta (no TextureImporter)')
  const lines = text.replace(/\r/g, '').split('\n')
  const start = lines.findIndex((l) => /^\s*sprites\s*:\s*(\[\s*\])?\s*$/.test(l))
  if (start < 0 || /\[\s*\]/.test(lines[start])) throw new Error('Unity .meta has no sprites (Sprite Mode must be Multiple)')
  const baseIndent = lines[start].search(/\S/)
  type Item = { name: string; rect: Record<string, string>; pivot: Record<string, string> | null }
  const items: Item[] = []
  let cur: Item | null = null
  let itemIndent = -1
  let nested: 'rect' | null = null
  let nestedIndent = -1
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line.trim()) continue
    const indent = line.search(/\S/)
    const body = line.trim()
    if (indent < baseIndent || (indent === baseIndent && !body.startsWith('- '))) break
    let content = body
    if (body.startsWith('- ') && (itemIndent < 0 || indent === itemIndent)) {
      itemIndent = indent
      cur = { name: '', rect: {}, pivot: null }
      items.push(cur)
      nested = null
      content = body.slice(2)
    } else if (nested && indent <= nestedIndent) {
      nested = null
    }
    if (!cur) continue
    const idx = content.indexOf(':')
    if (idx < 0) continue
    const key = content.slice(0, idx).trim()
    const val = content.slice(idx + 1).trim()
    if (nested === 'rect') {
      cur.rect[key] = yamlScalar(val)
      continue
    }
    if (key === 'name') cur.name = yamlScalar(val)
    else if (key === 'rect' && !val) {
      nested = 'rect'
      nestedIndent = indent + (content === body ? 0 : 2)
    } else if (key === 'rect' && val.startsWith('{')) cur.rect = inlineMap(val)
    else if (key === 'pivot' && val.startsWith('{')) cur.pivot = inlineMap(val)
  }
  if (!items.length) throw new Error('Unity .meta sprites list is empty')
  if (!imageH) throw new Error('Unity .meta needs the image height to convert coordinates')
  const warnings: string[] = []
  const frames: FrameRect[] = []
  items.forEach((it, i) => {
    const w = num(it.rect.width)
    const h = num(it.rect.height)
    if (w <= 0 || h <= 0) {
      warnings.push(`sprite "${it.name || i}" has no valid rect`)
      return
    }
    const x = num(it.rect.x)
    const yTop = imageH - num(it.rect.y) - h
    const pivot = it.pivot ? { x: num(it.pivot.x, 0.5), y: 1 - num(it.pivot.y, 0.5) } : null
    frames.push(makeFrame(it.name || `sprite_${i}`, { x, y: yTop, w, h }, false, null, pivot))
  })
  if (!frames.length) throw new Error('Unity .meta has no valid sprites')
  return { format: 'unity', image: null, width: 0, height: imageH, frames, tags: [], warnings }
}

export function isAtlasFile(file: string): boolean {
  const e = extOf(file)
  return e === 'json' || e === 'plist' || e === 'meta' || e === 'atlas'
}

export function parseAtlas(file: string, text: string, imageW?: number, imageH?: number): ParsedAtlas {
  const e = extOf(file)
  let out: ParsedAtlas
  if (e === 'json') out = parseJson(text)
  else if (e === 'plist') out = parsePlist(text)
  else if (e === 'meta') out = parseUnityMeta(text, imageH)
  else if (e === 'atlas') throw new Error('Spine .atlas is not a sprite sheet atlas')
  else throw new Error(`Unsupported atlas file: ${file}`)
  if (imageW && imageH) {
    if (out.width && out.height && (out.width !== imageW || out.height !== imageH)) {
      out.warnings.push(`atlas size ${out.width}x${out.height} differs from image ${imageW}x${imageH}`)
    }
    const outside = out.frames.filter((f) => f.x < 0 || f.y < 0 || f.x + f.w > imageW || f.y + f.h > imageH)
    if (outside.length) out.warnings.push(`${outside.length} frame(s) fall outside the image`)
    if (!out.width) out.width = imageW
    if (!out.height) out.height = imageH
  }
  return out
}

export function atlasImageName(file: string, text: string): string | null {
  const e = extOf(file)
  if (e === 'meta') {
    const base = file.replace(/\\/g, '/').split('/').pop() ?? ''
    return base.slice(0, -'.meta'.length) || null
  }
  try {
    if (e === 'json') {
      const root = obj(JSON.parse(text.replace(/^﻿/, '')))
      const meta = obj(root?.meta)
      return meta && typeof meta.image === 'string' && meta.image ? meta.image : null
    }
    if (e === 'plist') {
      const root = obj(parsePlistXml(text))
      const meta = obj(root?.metadata)
      if (!meta) return null
      const v = meta.realTextureFileName ?? meta.textureFileName
      return typeof v === 'string' && v ? v : null
    }
  } catch {
    return null
  }
  return null
}
