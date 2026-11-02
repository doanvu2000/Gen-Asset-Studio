import { skinAtlasName, skinPageName, skinSkeletonName } from '@shared/spine'
import { skinPath, skinSource } from './binary'

type Json = Record<string, unknown>

function obj(v: unknown): Json {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {}
}

export { skinAtlasName, skinPageName, skinSkeletonName }

const isEntry = (line: string): boolean => line.includes(':')

// Mirrors parseSpineAtlas: every page block is copied as-is except the page file and region
// names, so bounds / rotate / offsets / index / split stay byte-identical to the source atlas.
export function skinAtlasPages(text: string, skin: string): string {
  const lines = text.replace(/\r/g, '').split('\n')
  const out: string[] = []
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  while (i < lines.length && lines[i].trim() && isEntry(lines[i])) i++
  let inPage = false
  for (; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim()) {
      if (inPage) out.push('')
      inPage = false
      continue
    }
    if (!inPage) {
      if (isEntry(raw)) continue
      out.push(skinPageName(raw.trim(), skin))
      inPage = true
      continue
    }
    out.push(isEntry(raw) ? raw : skinPath(skin, raw.trim()))
  }
  return out.join('\n').replace(/\n+$/, '')
}

export function mergeSkinAtlas(text: string, skins: string[]): string {
  if (!skins.length) return text
  return `${text.replace(/\s+$/, '')}\n\n${skins.map((s) => skinAtlasPages(text, s)).join('\n\n')}\n`
}

const CONSTRAINTS = ['bones', 'ik', 'transform', 'path', 'physics'] as const

function skinAttachment(a: Json, key: string, srcSkin: string, skin: string): Json | null {
  const type = a.type ?? 'region'
  if (type !== 'region' && type !== 'mesh' && type !== 'linkedmesh') return null
  const path = skinPath(skin, typeof a.path === 'string' ? a.path : typeof a.name === 'string' ? a.name : key)
  if (type !== 'mesh') return { ...structuredClone(a), path }
  // Deform timelines target the source mesh; a linked mesh inheriting timelines keeps them.
  const out: Json = { type: 'linkedmesh', path, parent: key, timelines: true }
  if (srcSkin !== 'default') out.skin = srcSkin
  for (const f of ['name', 'color', 'width', 'height', 'sequence']) if (a[f] !== undefined) out[f] = structuredClone(a[f])
  return out
}

export function addSkinsJson(text: string, skins: string[]): string {
  if (!skins.length) return text
  const raw = obj(JSON.parse(text))
  const arr = Array.isArray(raw.skins)
  const list = arr
    ? (raw.skins as unknown[]).map(obj).map((s) => ({ name: String(s.name ?? 'default'), atts: obj(s.attachments), data: s }))
    : Object.entries(obj(raw.skins)).map(([name, atts]) => ({ name, atts: obj(atts), data: {} as Json }))
  const src = skinSource(list, (s) => Object.values(s.atts).some((m) => Object.keys(obj(m)).length > 0))
  if (!src) return text
  const target = arr ? (raw.skins as unknown[]) : null
  const legacy = arr ? null : obj(raw.skins)
  for (const skin of skins) {
    const atts: Json = {}
    for (const [slot, m] of Object.entries(src.atts)) {
      const out: Json = {}
      for (const [key, a] of Object.entries(obj(m))) {
        const c = skinAttachment(obj(a), key, src.name, skin)
        if (c) out[key] = c
      }
      if (Object.keys(out).length) atts[slot] = out
    }
    if (target) {
      const extra: Json = {}
      if (src.name !== 'default') for (const k of CONSTRAINTS) if (src.data[k] !== undefined) extra[k] = structuredClone(src.data[k])
      target.push({ name: skin, ...extra, attachments: atts })
    } else if (legacy) legacy[skin] = atts
  }
  return JSON.stringify(raw, null, 2)
}
