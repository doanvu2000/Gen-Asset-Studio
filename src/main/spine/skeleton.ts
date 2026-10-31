import type { SpineAttachmentKind, SpineAttachmentRef, SpineRig, SpineSkeletonInfo } from '@shared/spine'
import { attachmentKey } from '@shared/spine'

type Json = Record<string, unknown>

function obj(v: unknown): Json {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Json) : {}
}

function num(v: unknown, d = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}

export class SkeletonError extends Error {
  constructor(
    readonly code: 'version' | 'parse',
    message: string
  ) {
    super(message)
  }
}

function skinList(raw: Json): Array<{ name: string; attachments: Json }> {
  const skins = raw.skins
  if (Array.isArray(skins)) return skins.map((s) => obj(s)).map((s) => ({ name: String(s.name ?? 'default'), attachments: obj(s.attachments) }))
  return Object.entries(obj(skins)).map(([name, attachments]) => ({ name, attachments: obj(attachments) }))
}

function kindOf(type: unknown): SpineAttachmentKind {
  if (type === undefined || type === 'region') return 'region'
  if (type === 'mesh') return 'mesh'
  if (type === 'linkedmesh') return 'linkedmesh'
  return 'other'
}

export function parseSkeleton(text: string): { raw: Json; info: SpineSkeletonInfo } {
  let raw: Json
  try {
    raw = obj(JSON.parse(text))
  } catch (e) {
    throw new SkeletonError('parse', (e as Error).message)
  }
  const sk = obj(raw.skeleton)
  const version = typeof sk.spine === 'string' ? sk.spine : ''
  if (!/^4\.2(\.|$)/.test(version)) throw new SkeletonError('version', version || 'unknown')
  const bones = (Array.isArray(raw.bones) ? raw.bones : []).map(obj).map((b) => ({ name: String(b.name ?? ''), parent: typeof b.parent === 'string' ? b.parent : null }))
  const slots = (Array.isArray(raw.slots) ? raw.slots : []).map(obj).map((s) => ({ name: String(s.name ?? ''), bone: String(s.bone ?? ''), attachment: typeof s.attachment === 'string' ? s.attachment : null }))
  const attachments: SpineAttachmentRef[] = []
  const skins = skinList(raw)
  for (const skin of skins) {
    for (const [slot, atts] of Object.entries(skin.attachments)) {
      for (const [name, a] of Object.entries(obj(atts))) {
        const at = obj(a)
        const kind = kindOf(at.type)
        if (kind === 'other') continue
        attachments.push({ skin: skin.name, slot, name, region: typeof at.path === 'string' ? at.path : typeof at.name === 'string' ? at.name : name, kind })
      }
    }
  }
  return {
    raw,
    info: {
      version,
      bones,
      slots,
      skins: skins.map((s) => s.name),
      animations: Object.keys(obj(raw.animations)),
      attachments,
      width: num(sk.width),
      height: num(sk.height)
    }
  }
}

const FIELDS = ['x', 'y', 'rotation', 'scaleX', 'scaleY'] as const

function cleanEdit(e: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  const r = obj(e)
  for (const f of FIELDS) if (typeof r[f] === 'number' && Number.isFinite(r[f])) out[f] = Math.round((r[f] as number) * 1000) / 1000
  return out
}

export function sanitizeRig(raw: unknown): SpineRig {
  const r = obj(raw)
  const bones: SpineRig['bones'] = {}
  const attachments: SpineRig['attachments'] = {}
  for (const [k, v] of Object.entries(obj(r.bones)).slice(0, 2000)) {
    const e = cleanEdit(v)
    if (Object.keys(e).length) bones[k.slice(0, 200)] = e
  }
  for (const [k, v] of Object.entries(obj(r.attachments)).slice(0, 4000)) {
    const e = cleanEdit(v)
    if (Object.keys(e).length) attachments[k.slice(0, 400)] = e
  }
  return { bones, attachments }
}

export function rigIsEmpty(rig: SpineRig): boolean {
  return !Object.keys(rig.bones).length && !Object.keys(rig.attachments).length
}

export function applyRig(text: string, rig: SpineRig): string {
  if (rigIsEmpty(rig)) return text
  const raw = obj(JSON.parse(text))
  for (const b of Array.isArray(raw.bones) ? raw.bones : []) {
    const bone = obj(b)
    const e = rig.bones[String(bone.name ?? '')]
    if (e) Object.assign(bone, e)
  }
  const skins = raw.skins
  const list = Array.isArray(skins) ? skins.map(obj).map((s) => ({ name: String(s.name ?? 'default'), atts: obj(s.attachments) })) : Object.entries(obj(skins)).map(([name, atts]) => ({ name, atts: obj(atts) }))
  for (const skin of list) {
    for (const [slot, atts] of Object.entries(skin.atts)) {
      for (const [name, a] of Object.entries(obj(atts))) {
        const e = rig.attachments[attachmentKey(skin.name, slot, name)]
        if (e) Object.assign(obj(a), e)
      }
    }
  }
  return JSON.stringify(raw, null, 2)
}
