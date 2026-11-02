import type { SpineAttachmentKind, SpineAttachmentRef, SpineRig, SpineSkeletonInfo } from '@shared/spine'
import { attachmentKey } from '@shared/spine'
import { rigIsEmpty, SkeletonError } from './skeleton'

interface BoneSlot {
  name: string
  at: number
}

interface RegionSlot {
  key: string
  flagsAt: number
  rotationAt: number | null
  xAt: number
}

interface AttSpan {
  slot: number
  keyRef: number
  region: string
  type: number
  flags: number
  start: number
  nameEnd: number
  pathEnd: number
  extraEnd: number
  end: number
}

interface SkinSpan {
  name: string
  index: number
  headerStart: number
  headerEnd: number
  atts: AttSpan[]
}

export interface SkelLayout {
  bones: BoneSlot[]
  regions: RegionSlot[]
  tailAt: number
  nonessential: boolean
  stringsAt: number
  stringsEnd: number
  strings: string[]
  skinsAt: number
  skins: SkinSpan[]
}

const utf8 = new TextDecoder('utf-8')

class Input {
  index = 0
  readonly strings: string[] = []
  private readonly view: DataView

  constructor(readonly bytes: Uint8Array) {
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  }

  private need(n: number): void {
    if (n < 0 || this.index + n > this.bytes.length) throw new SkeletonError('parse', `unexpected end of data at ${this.index}`)
  }

  byte(): number {
    this.need(1)
    return this.view.getInt8(this.index++)
  }

  ubyte(): number {
    this.need(1)
    return this.view.getUint8(this.index++)
  }

  int32(): number {
    this.need(4)
    const v = this.view.getInt32(this.index)
    this.index += 4
    return v
  }

  float(): number {
    this.need(4)
    const v = this.view.getFloat32(this.index)
    this.index += 4
    return v
  }

  skip(n: number): void {
    this.need(n)
    this.index += n
  }

  bool(): boolean {
    return this.byte() !== 0
  }

  varint(optimizePositive = true): number {
    let b = this.byte()
    let result = b & 0x7f
    for (let shift = 7; b & 0x80 && shift <= 28; shift += 7) {
      b = this.byte()
      result |= (b & 0x7f) << shift
    }
    return optimizePositive ? result : (result >>> 1) ^ -(result & 1)
  }

  count(): number {
    const n = this.varint()
    if (n < 0) throw new SkeletonError('parse', `bad count at ${this.index}`)
    return n
  }

  string(): string | null {
    const n = this.varint()
    if (n === 0) return null
    if (n === 1) return ''
    this.need(n - 1)
    const s = utf8.decode(this.bytes.subarray(this.index, this.index + n - 1))
    this.index += n - 1
    return s
  }

  name(what: string): string {
    const s = this.string()
    if (!s) throw new SkeletonError('parse', `${what} name missing at ${this.index}`)
    return s
  }

  ref(): number {
    const i = this.varint()
    if (i < 0 || i > this.strings.length) throw new SkeletonError('parse', `bad string ref ${i}`)
    return i
  }

  stringRef(): string | null {
    const i = this.ref()
    return i === 0 ? null : this.strings[i - 1]
  }

  index0(max: number, what: string): number {
    const i = this.varint()
    if (i < 0 || i >= max) throw new SkeletonError('parse', `bad ${what} index ${i}`)
    return i
  }
}

function readVersion(bytes: Uint8Array): string {
  const tryRead = (skipHash: boolean): string | null => {
    try {
      const input = new Input(bytes)
      if (skipHash) input.skip(8)
      else input.string()
      const v = input.string()
      return v && /^\d+\.\d+/.test(v) ? v : null
    } catch {
      return null
    }
  }
  const v = tryRead(true) ?? tryRead(false)
  if (!v) throw new SkeletonError('parse', 'not a Spine binary skeleton')
  return v
}

function readSequence(input: Input): NonNullable<SpineAttachmentRef['sequence']> {
  const count = input.varint()
  const start = input.varint()
  const digits = input.varint()
  input.varint()
  return { count, start, digits }
}

function skipVertices(input: Input, weighted: boolean): number {
  const vertexCount = input.count()
  if (!weighted) {
    input.skip(vertexCount * 8)
    return vertexCount
  }
  for (let i = 0; i < vertexCount; i++) {
    const bones = input.count()
    for (let b = 0; b < bones; b++) {
      input.varint()
      input.skip(12)
    }
  }
  return vertexCount
}

function readSkin(input: Input, info: SpineSkeletonInfo, layout: SkelLayout, isDefault: boolean, nonessential: boolean, counts: number[]): boolean {
  let name = 'default'
  let slotCount: number
  const span: SkinSpan = { name, index: info.skins.length, headerStart: 0, headerEnd: 0, atts: [] }
  if (isDefault) {
    slotCount = input.count()
    if (!slotCount) return false
  } else {
    name = span.name = input.name('skin')
    if (nonessential) input.skip(4)
    span.headerStart = input.index
    const bones = input.count()
    for (let i = 0; i < bones; i++) input.index0(info.bones.length, 'bone')
    for (const n of counts) {
      const c = input.count()
      for (let i = 0; i < c; i++) input.index0(n, 'constraint')
    }
    span.headerEnd = input.index
    slotCount = input.count()
  }
  info.skins.push(name)
  layout.skins.push(span)
  for (let i = 0; i < slotCount; i++) {
    const slotIndex = input.index0(info.slots.length, 'slot')
    const slot = info.slots[slotIndex].name
    const atts = input.count()
    for (let a = 0; a < atts; a++) {
      const keyRef = input.ref()
      const key = keyRef ? input.strings[keyRef - 1] : null
      if (!key) throw new SkeletonError('parse', 'attachment name missing')
      const head = readAttachment(input, info, layout, name, slot, key, nonessential)
      if (head) span.atts.push({ ...head, slot: slotIndex, keyRef, end: input.index })
    }
  }
  return true
}

type AttHead = Omit<AttSpan, 'slot' | 'keyRef' | 'end'>

function readAttachment(input: Input, info: SpineSkeletonInfo, layout: SkelLayout, skin: string, slot: string, key: string, nonessential: boolean): AttHead | null {
  const flagsAt = input.index
  const flags = input.ubyte()
  const name = flags & 8 ? input.stringRef() : key
  if (!name) throw new SkeletonError('parse', 'attachment name missing')
  const nameEnd = input.index
  const head = (kind: SpineAttachmentKind): AttHead => {
    const path = flags & 16 ? input.stringRef() : null
    const pathEnd = input.index
    if (flags & 32) input.skip(4)
    const sequence = flags & 64 ? readSequence(input) : undefined
    const region = path ?? name
    info.attachments.push(sequence ? { skin, slot, name: key, region, kind, sequence } : { skin, slot, name: key, region, kind })
    return { region, type: flags & 7, flags, start: flagsAt, nameEnd, pathEnd, extraEnd: input.index }
  }
  switch (flags & 7) {
    case 0: {
      const span = head('region')
      const rotationAt = flags & 128 ? input.index : null
      if (rotationAt !== null) input.skip(4)
      const xAt = input.index
      input.skip(24)
      layout.regions.push({ key: attachmentKey(skin, slot, key), flagsAt, rotationAt, xAt })
      return span
    }
    case 1:
      skipVertices(input, (flags & 16) !== 0)
      if (nonessential) input.skip(4)
      return null
    case 2: {
      const span = head('mesh')
      const hull = input.varint()
      const vertexCount = skipVertices(input, (flags & 128) !== 0)
      input.skip(vertexCount * 8)
      const triangles = (vertexCount * 2 - hull - 2) * 3
      for (let i = 0; i < triangles; i++) input.varint()
      if (nonessential) {
        const edges = input.count()
        for (let i = 0; i < edges; i++) input.varint()
        input.skip(8)
      }
      return span
    }
    case 3: {
      const span = head('linkedmesh')
      input.varint()
      input.stringRef()
      if (nonessential) input.skip(8)
      return span
    }
    case 4: {
      const vertexCount = skipVertices(input, (flags & 64) !== 0)
      input.skip(Math.ceil((vertexCount * 2) / 6) * 4)
      if (nonessential) input.skip(4)
      return null
    }
    case 5:
      input.skip(12)
      if (nonessential) input.skip(4)
      return null
    case 6:
      input.index0(info.slots.length, 'slot')
      skipVertices(input, (flags & 16) !== 0)
      if (nonessential) input.skip(4)
      return null
    default:
      throw new SkeletonError('parse', `unknown attachment type ${flags & 7}`)
  }
}

function skipCurves(input: Input, frameCount: number, frameBytes: number, channels: number): void {
  input.skip(frameBytes)
  for (let f = 1; f < frameCount; f++) {
    input.skip(frameBytes)
    if (input.byte() === 2) input.skip(channels * 16)
  }
}

function skipAnimation(input: Input, eventAudio: boolean[]): void {
  input.varint()
  for (let i = 0, n = input.count(); i < n; i++) {
    input.varint()
    for (let t = 0, nn = input.count(); t < nn; t++) {
      const type = input.byte()
      const frames = input.count()
      if (type === 0) {
        for (let f = 0; f < frames; f++) {
          input.skip(4)
          input.stringRef()
        }
        continue
      }
      const shape = ({ 1: [8, 4], 2: [7, 3], 3: [11, 7], 4: [10, 6], 5: [5, 1] } as Record<number, [number, number]>)[type]
      if (!shape) continue
      input.varint()
      skipCurves(input, frames, shape[0], shape[1])
    }
  }
  for (let i = 0, n = input.count(); i < n; i++) {
    input.varint()
    for (let t = 0, nn = input.count(); t < nn; t++) {
      const type = input.byte()
      const frames = input.count()
      if (type === 10) {
        input.skip(frames * 5)
        continue
      }
      input.varint()
      if (type === 1 || type === 4 || type === 7) skipCurves(input, frames, 12, 2)
      else if (type >= 0 && type <= 9) skipCurves(input, frames, 8, 1)
    }
  }
  for (let i = 0, n = input.count(); i < n; i++) {
    input.varint()
    const frames = input.count()
    input.varint()
    let flags = input.byte()
    const values = (fl: number): number => (fl & 1 && fl & 2 ? 4 : 0) + (fl & 4 ? 4 : 0)
    input.skip(4 + values(flags))
    for (let f = 1; f < frames; f++) {
      flags = input.byte()
      input.skip(4 + values(flags))
      if (!(flags & 64) && flags & 128) input.skip(32)
    }
  }
  for (let i = 0, n = input.count(); i < n; i++) {
    input.varint()
    const frames = input.count()
    input.varint()
    skipCurves(input, frames, 28, 6)
  }
  for (let i = 0, n = input.count(); i < n; i++) {
    input.varint()
    for (let t = 0, nn = input.count(); t < nn; t++) {
      const type = input.byte()
      const frames = input.count()
      input.varint()
      if (type === 0 || type === 1) skipCurves(input, frames, 8, 1)
      else if (type === 2) skipCurves(input, frames, 16, 3)
    }
  }
  for (let i = 0, n = input.count(); i < n; i++) {
    input.varint()
    for (let t = 0, nn = input.count(); t < nn; t++) {
      const type = input.byte()
      const frames = input.count()
      if (type === 8) {
        input.skip(frames * 4)
        continue
      }
      input.varint()
      if ([0, 1, 2, 4, 5, 6, 7].includes(type)) skipCurves(input, frames, 8, 1)
    }
  }
  for (let i = 0, n = input.count(); i < n; i++) {
    input.varint()
    for (let s = 0, nn = input.count(); s < nn; s++) {
      input.varint()
      for (let a = 0, nnn = input.count(); a < nnn; a++) {
        input.stringRef()
        const type = input.byte()
        const frames = input.count()
        if (type === 0) {
          input.varint()
          input.skip(4)
          for (let f = 0; f < frames; f++) {
            const end = input.varint()
            if (end !== 0) {
              input.varint()
              input.skip(end * 4)
            }
            if (f === frames - 1) break
            input.skip(4)
            if (input.byte() === 2) input.skip(16)
          }
        } else if (type === 1) input.skip(frames * 12)
      }
    }
  }
  for (let i = 0, n = input.count(); i < n; i++) {
    input.skip(4)
    for (let o = 0, nn = input.count(); o < nn; o++) {
      input.varint()
      input.varint()
    }
  }
  for (let i = 0, n = input.count(); i < n; i++) {
    input.skip(4)
    const e = input.index0(eventAudio.length, 'event')
    input.varint(false)
    input.skip(4)
    input.string()
    if (eventAudio[e]) input.skip(8)
  }
}

export function parseSkeletonBinary(bytes: Uint8Array): { info: SpineSkeletonInfo; layout: SkelLayout } {
  const version = readVersion(bytes)
  if (!/^4\.2(\.|$)/.test(version)) throw new SkeletonError('version', version)
  try {
    return readAll(bytes, version)
  } catch (e) {
    if (e instanceof SkeletonError) throw e
    throw new SkeletonError('parse', (e as Error).message)
  }
}

function readAll(bytes: Uint8Array, version: string): { info: SpineSkeletonInfo; layout: SkelLayout } {
  const input = new Input(bytes)
  input.skip(8)
  input.string()
  input.skip(8)
  const width = input.float()
  const height = input.float()
  input.skip(4)
  const nonessential = input.bool()
  if (nonessential) {
    input.skip(4)
    input.string()
    input.string()
  }
  const info: SpineSkeletonInfo = { version, bones: [], slots: [], skins: [], animations: [], attachments: [], width, height }
  const layout: SkelLayout = { bones: [], regions: [], tailAt: 0, nonessential, stringsAt: input.index, stringsEnd: 0, strings: input.strings, skinsAt: 0, skins: [] }
  for (let i = 0, n = input.count(); i < n; i++) input.strings.push(input.name('string table'))
  layout.stringsEnd = input.index
  for (let i = 0, n = input.count(); i < n; i++) {
    const name = input.name('bone')
    const parent = i === 0 ? null : info.bones[input.index0(i, 'parent bone')].name
    info.bones.push({ name, parent })
    layout.bones.push({ name, at: input.index })
    // rotation x y scaleX scaleY shearX shearY length (8 floats), inherit byte, skinRequired bool
    input.skip(34)
    if (nonessential) {
      input.skip(4)
      input.string()
      input.skip(1)
    }
  }
  for (let i = 0, n = input.count(); i < n; i++) {
    const name = input.name('slot')
    const bone = info.bones[input.index0(info.bones.length, 'slot bone')].name
    input.skip(8)
    const attachment = input.stringRef()
    input.varint()
    if (nonessential) input.skip(1)
    info.slots.push({ name, bone, attachment })
  }
  const counts: number[] = []
  counts.push(skipIk(input, info))
  counts.push(skipTransforms(input, info))
  counts.push(skipPaths(input, info))
  counts.push(skipPhysics(input, info))
  readSkin(input, info, layout, true, nonessential, counts)
  layout.skinsAt = input.index
  for (let i = 0, n = input.count(); i < n; i++) readSkin(input, info, layout, false, nonessential, counts)
  layout.tailAt = input.index
  const eventAudio: boolean[] = []
  for (let i = 0, n = input.count(); i < n; i++) {
    input.name('event')
    input.varint(false)
    input.skip(4)
    input.string()
    const audio = input.string()
    eventAudio.push(!!audio)
    if (audio) input.skip(8)
  }
  for (let i = 0, n = input.count(); i < n; i++) {
    info.animations.push(input.name('animation'))
    skipAnimation(input, eventAudio)
  }
  return { info, layout }
}

function skipIk(input: Input, info: SpineSkeletonInfo): number {
  const n = input.count()
  for (let i = 0; i < n; i++) {
    input.name('ik constraint')
    input.varint()
    for (let b = 0, nn = input.count(); b < nn; b++) input.index0(info.bones.length, 'bone')
    input.index0(info.bones.length, 'bone')
    const flags = input.ubyte()
    input.skip((flags & 32 && flags & 64 ? 4 : 0) + (flags & 128 ? 4 : 0))
  }
  return n
}

function skipTransforms(input: Input, info: SpineSkeletonInfo): number {
  const n = input.count()
  const bits = (flags: number, from: number): number => {
    let c = 0
    for (let b = from; b < 8; b++) if (flags & (1 << b)) c++
    return c
  }
  for (let i = 0; i < n; i++) {
    input.name('transform constraint')
    input.varint()
    for (let b = 0, nn = input.count(); b < nn; b++) input.index0(info.bones.length, 'bone')
    input.index0(info.bones.length, 'bone')
    input.skip(bits(input.ubyte(), 3) * 4)
    input.skip(bits(input.ubyte() & 0x7f, 0) * 4)
  }
  return n
}

function skipPaths(input: Input, info: SpineSkeletonInfo): number {
  const n = input.count()
  for (let i = 0; i < n; i++) {
    input.name('path constraint')
    input.varint()
    input.skip(1)
    for (let b = 0, nn = input.count(); b < nn; b++) input.index0(info.bones.length, 'bone')
    input.index0(info.slots.length, 'slot')
    input.skip((input.ubyte() & 128 ? 4 : 0) + 20)
  }
  return n
}

function skipPhysics(input: Input, info: SpineSkeletonInfo): number {
  const n = input.count()
  for (let i = 0; i < n; i++) {
    input.name('physics constraint')
    input.varint()
    input.index0(info.bones.length, 'bone')
    const flags = input.ubyte()
    let floats = 0
    for (const bit of [2, 4, 8, 16, 32, 64, 128]) if (flags & bit) floats++
    input.skip(floats * 4 + 1 + 5 * 4)
    input.skip(input.ubyte() & 128 ? 4 : 0)
  }
  return n
}

const BONE_FIELDS = { rotation: 0, x: 4, y: 8, scaleX: 12, scaleY: 16 } as const
const REGION_FIELDS = { x: 0, y: 4, scaleX: 8, scaleY: 12 } as const

export function applyRigBinary(bytes: Uint8Array, rig: SpineRig): Uint8Array {
  if (rigIsEmpty(rig)) return bytes
  const { layout } = parseSkeletonBinary(bytes)
  const out = new Uint8Array(bytes)
  const view = new DataView(out.buffer)
  const inserts: Array<{ at: number; value: number }> = []
  for (const b of layout.bones) {
    const e = rig.bones[b.name]
    if (!e) continue
    for (const [f, off] of Object.entries(BONE_FIELDS)) {
      const v = e[f as keyof typeof BONE_FIELDS]
      if (v !== undefined) view.setFloat32(b.at + off, v)
    }
  }
  for (const r of layout.regions) {
    const e = rig.attachments[r.key]
    if (!e) continue
    for (const [f, off] of Object.entries(REGION_FIELDS)) {
      const v = e[f as keyof typeof REGION_FIELDS]
      if (v !== undefined) view.setFloat32(r.xAt + off, v)
    }
    if (e.rotation === undefined) continue
    if (r.rotationAt !== null) view.setFloat32(r.rotationAt, e.rotation)
    else {
      // Region flag bit 128 = rotation float present, stored right before x; set it and splice the float in.
      out[r.flagsAt] |= 128
      inserts.push({ at: r.xAt, value: e.rotation })
    }
  }
  if (!inserts.length) return out
  inserts.sort((a, b) => a.at - b.at)
  const result = new Uint8Array(out.length + inserts.length * 4)
  const rv = new DataView(result.buffer)
  let src = 0
  let dst = 0
  for (const ins of inserts) {
    result.set(out.subarray(src, ins.at), dst)
    dst += ins.at - src
    src = ins.at
    rv.setFloat32(dst, ins.value)
    dst += 4
  }
  result.set(out.subarray(src), dst)
  return result
}

class Output {
  private readonly chunks: Uint8Array[] = []
  private parts: number[] = []

  private flush(): void {
    if (!this.parts.length) return
    this.chunks.push(Uint8Array.from(this.parts))
    this.parts = []
  }

  byte(b: number): this {
    this.parts.push(b & 0xff)
    return this
  }

  bytes(b: Uint8Array | number[]): this {
    if (Array.isArray(b)) this.parts.push(...b)
    else {
      this.flush()
      this.chunks.push(b)
    }
    return this
  }

  varint(v: number): this {
    let n = v >>> 0
    while (n > 0x7f) {
      this.parts.push((n & 0x7f) | 0x80)
      n >>>= 7
    }
    this.parts.push(n)
    return this
  }

  string(s: string): this {
    const b = new TextEncoder().encode(s)
    return this.varint(b.length + 1).bytes(b)
  }

  done(): Uint8Array {
    this.flush()
    const out = new Uint8Array(this.chunks.reduce((n, c) => n + c.length, 0))
    let at = 0
    for (const c of this.chunks) {
      out.set(c, at)
      at += c.length
    }
    return out
  }
}

export function skinSource<T extends { name: string }>(skins: T[], hasAttachments: (s: T) => boolean): T | null {
  return skins.find((s) => s.name === 'default' && hasAttachments(s)) ?? skins.find(hasAttachments) ?? null
}

export function skinPath(skin: string, region: string): string {
  return `${skin}/${region}`
}

// Appends one skin per name, cloned from the default skin (or the first one) with every
// attachment path prefixed by "<skin>/". Meshes become linked meshes of the source mesh so
// deform timelines (bound to the source attachment) still drive them.
export function addSkinsBinary(bytes: Uint8Array, skins: string[]): Uint8Array {
  if (!skins.length) return bytes
  const { layout } = parseSkeletonBinary(bytes)
  const src = skinSource(layout.skins, (s) => s.atts.length > 0)
  if (!src) return bytes
  const added: string[] = []
  const refOf = (s: string): number => {
    const i = layout.strings.indexOf(s)
    if (i >= 0) return i + 1
    const j = added.indexOf(s)
    if (j >= 0) return layout.strings.length + j + 1
    added.push(s)
    return layout.strings.length + added.length
  }
  const blobs: Uint8Array[] = []
  for (const skin of skins) {
    const o = new Output().string(skin)
    if (layout.nonessential) o.bytes([0xff, 0xff, 0xff, 0xff])
    if (src.name === 'default') o.varint(0).varint(0).varint(0).varint(0).varint(0)
    else o.bytes(bytes.subarray(src.headerStart, src.headerEnd))
    const slots = [...new Set(src.atts.map((a) => a.slot))]
    o.varint(slots.length)
    for (const slot of slots) {
      const atts = src.atts.filter((a) => a.slot === slot)
      o.varint(slot).varint(atts.length)
      for (const a of atts) {
        o.varint(a.keyRef)
        const path = refOf(skinPath(skin, a.region))
        if (a.type === 2) {
          o.byte(3 | 16 | 128 | (a.flags & (8 | 32 | 64)))
          o.bytes(bytes.subarray(a.start + 1, a.nameEnd)).varint(path)
          o.bytes(bytes.subarray(a.pathEnd, a.extraEnd)).varint(src.index).varint(a.keyRef)
          if (layout.nonessential) o.bytes(bytes.subarray(a.end - 8, a.end))
        } else {
          o.byte(a.flags | 16)
          o.bytes(bytes.subarray(a.start + 1, a.nameEnd)).varint(path)
          o.bytes(bytes.subarray(a.pathEnd, a.end))
        }
      }
    }
    blobs.push(o.done())
  }
  const head = new Input(bytes)
  head.index = layout.stringsAt
  const strings = head.count()
  const tableStart = head.index
  head.index = layout.skinsAt
  const extra = head.count()
  const out = new Output()
    .bytes(bytes.subarray(0, layout.stringsAt))
    .varint(strings + added.length)
    .bytes(bytes.subarray(tableStart, layout.stringsEnd))
  for (const s of added) out.string(s)
  out.bytes(bytes.subarray(layout.stringsEnd, layout.skinsAt)).varint(extra + skins.length).bytes(bytes.subarray(head.index, layout.tailAt))
  for (const b of blobs) out.bytes(b)
  return out.bytes(bytes.subarray(layout.tailAt)).done()
}
