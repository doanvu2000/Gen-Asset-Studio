class Out {
  constructor() {
    this.chunks = []
  }
  bytes(b) {
    this.chunks.push(Buffer.from(b))
  }
  byte(v) {
    this.bytes([v & 0xff])
  }
  bool(v) {
    this.byte(v ? 1 : 0)
  }
  int32(v) {
    const b = Buffer.alloc(4)
    b.writeInt32BE(v | 0)
    this.bytes(b)
  }
  float(v) {
    const b = Buffer.alloc(4)
    b.writeFloatBE(v ?? 0)
    this.bytes(b)
  }
  varint(v, optimizePositive = true) {
    let n = optimizePositive ? v >>> 0 : ((v << 1) ^ (v >> 31)) >>> 0
    do {
      let b = n & 0x7f
      n >>>= 7
      if (n) b |= 0x80
      this.byte(b)
    } while (n)
  }
  string(s) {
    if (s === null || s === undefined) return this.varint(0)
    const b = Buffer.from(s, 'utf8')
    this.varint(b.length + 1)
    this.bytes(b)
  }
  done() {
    return Buffer.concat(this.chunks)
  }
}

const color = (hex, d = 0xffffffff) => (hex ? parseInt(hex.padEnd(8, 'f'), 16) | 0 : d | 0)

// Minimal Spine 4.2 binary writer (JSON subset → .skel) mirroring spine-core SkeletonBinary, for samples and tests.
export function writeSkel(sk, { nonessential = false } = {}) {
  const strings = []
  const ref = (s) => {
    if (s === null || s === undefined) return 0
    let i = strings.indexOf(s)
    if (i < 0) i = strings.push(s) - 1
    return i + 1
  }
  const boneIndex = (n) => sk.bones.findIndex((b) => b.name === n)
  const slotIndex = (n) => sk.slots.findIndex((s) => s.name === n)
  const skins = (sk.skins ?? []).map((s) => ({ name: s.name, attachments: s.attachments ?? {} }))

  const bones = new Out()
  for (const [i, b] of sk.bones.entries()) {
    bones.string(b.name)
    if (i > 0) bones.varint(boneIndex(b.parent))
    for (const k of ['rotation', 'x', 'y']) bones.float(b[k] ?? 0)
    bones.float(b.scaleX ?? 1)
    bones.float(b.scaleY ?? 1)
    for (const k of ['shearX', 'shearY', 'length']) bones.float(b[k] ?? 0)
    bones.byte(0)
    bones.bool(b.skin)
    if (nonessential) {
      bones.int32(color(b.color, 0x9b9b9bff))
      bones.string(b.icon ?? null)
      bones.bool(true)
    }
  }

  const slots = new Out()
  for (const s of sk.slots) {
    slots.string(s.name)
    slots.varint(boneIndex(s.bone))
    slots.int32(color(s.color))
    slots.int32(-1)
    slots.varint(ref(s.attachment))
    slots.varint(0)
    if (nonessential) slots.bool(true)
  }

  const writeAttachment = (w, key, a) => {
    const type = { region: 0, boundingbox: 1, mesh: 2, linkedmesh: 3, point: 5 }[a.type ?? 'region']
    const weighted = type === 2 && a.vertices.length > a.uvs.length
    let flags = type
    if (a.name && a.name !== key) flags |= 8
    if (type === 0 || type === 2 || type === 3) {
      if (a.path) flags |= 16
      if (a.color) flags |= 32
      if (a.sequence) flags |= 64
    }
    if ((type === 0 && a.rotation !== undefined) || weighted || (type === 3 && a.timelines !== false)) flags |= 128
    w.byte(flags)
    if (flags & 8) w.varint(ref(a.name))
    if (type === 0 || type === 2 || type === 3) {
      if (flags & 16) w.varint(ref(a.path))
      if (flags & 32) w.int32(color(a.color))
      if (flags & 64) for (const k of ['count', 'start', 'digits', 'setup']) w.varint(a.sequence[k] ?? (k === 'start' ? 1 : 0))
    }
    const vertices = (count, list, isWeighted) => {
      w.varint(count)
      if (!isWeighted) return list.forEach((v) => w.float(v))
      for (let i = 0; i < list.length; ) {
        const n = list[i++]
        w.varint(n)
        for (let b = 0; b < n; b++) {
          w.varint(list[i++])
          w.float(list[i++])
          w.float(list[i++])
          w.float(list[i++])
        }
      }
    }
    if (type === 0) {
      if (flags & 128) w.float(a.rotation)
      w.float(a.x ?? 0)
      w.float(a.y ?? 0)
      w.float(a.scaleX ?? 1)
      w.float(a.scaleY ?? 1)
      w.float(a.width ?? 32)
      w.float(a.height ?? 32)
    } else if (type === 1) {
      vertices(a.vertexCount, a.vertices, false)
      if (nonessential) w.int32(0)
    } else if (type === 2) {
      w.varint(a.hull)
      vertices(a.uvs.length / 2, a.vertices, weighted)
      a.uvs.forEach((v) => w.float(v))
      a.triangles.forEach((v) => w.varint(v))
      if (nonessential) {
        const edges = a.edges ?? []
        w.varint(edges.length)
        edges.forEach((v) => w.varint(v))
        w.float(a.width ?? 0)
        w.float(a.height ?? 0)
      }
    } else if (type === 3) {
      w.varint(Math.max(0, skins.findIndex((s) => s.name === (a.skin ?? 'default'))))
      w.varint(ref(a.parent))
      if (nonessential) {
        w.float(a.width ?? 0)
        w.float(a.height ?? 0)
      }
    } else if (type === 5) {
      w.float(a.rotation ?? 0)
      w.float(a.x ?? 0)
      w.float(a.y ?? 0)
      if (nonessential) w.int32(0)
    }
  }
  const writeSkinSlots = (w, attachments) => {
    const entries = Object.entries(attachments)
    w.varint(entries.length)
    for (const [slot, atts] of entries) {
      w.varint(slotIndex(slot))
      const list = Object.entries(atts)
      w.varint(list.length)
      for (const [key, a] of list) {
        w.varint(ref(key))
        writeAttachment(w, key, a)
      }
    }
  }
  const skinOut = new Out()
  const def = skins.find((s) => s.name === 'default')
  if (def) writeSkinSlots(skinOut, def.attachments)
  else skinOut.varint(0)
  const others = skins.filter((s) => s !== def)
  skinOut.varint(others.length)
  for (const s of others) {
    skinOut.string(s.name)
    if (nonessential) skinOut.int32(-1)
    for (let i = 0; i < 5; i++) skinOut.varint(0)
    writeSkinSlots(skinOut, s.attachments)
  }

  const events = Object.entries(sk.events ?? {})
  const eventOut = new Out()
  eventOut.varint(events.length)
  for (const [name, e] of events) {
    eventOut.string(name)
    eventOut.varint(e.int ?? 0, false)
    eventOut.float(e.float ?? 0)
    eventOut.string(e.string ?? null)
    eventOut.string(e.audio ?? null)
    if (e.audio) {
      eventOut.float(e.volume ?? 1)
      eventOut.float(e.balance ?? 0)
    }
  }

  const curve = (w, c, channels) => {
    if (c === 'stepped') return w.byte(1)
    if (!Array.isArray(c)) return w.byte(0)
    w.byte(2)
    for (let ch = 0; ch < channels; ch++) for (let i = 0; i < 4; i++) w.float(c[ch * 4 + i] ?? c[i])
  }
  const beziers = (keys, channels) => keys.slice(0, -1).filter((k) => Array.isArray(k.curve)).length * channels
  const timeline = (w, keys, fields, defaults) => {
    w.varint(keys.length)
    w.varint(beziers(keys, fields.length))
    keys.forEach((k, i) => {
      w.float(k.time ?? 0)
      fields.forEach((f, fi) => w.float(k[f] ?? defaults[fi]))
      if (i > 0) curve(w, keys[i - 1].curve, fields.length)
    })
  }
  const animOut = new Out()
  const anims = Object.entries(sk.animations ?? {})
  animOut.varint(anims.length)
  for (const [name, a] of anims) {
    animOut.string(name)
    const w = new Out()
    let timelines = 0
    const slotTl = Object.entries(a.slots ?? {})
    w.varint(slotTl.length)
    for (const [slot, tls] of slotTl) {
      w.varint(slotIndex(slot))
      const list = Object.entries(tls)
      w.varint(list.length)
      for (const [type, keys] of list) {
        timelines++
        if (type === 'attachment') {
          w.byte(0)
          w.varint(keys.length)
          for (const k of keys) {
            w.float(k.time ?? 0)
            w.varint(ref(k.name ?? null))
          }
        } else if (type === 'rgba') {
          w.byte(1)
          w.varint(keys.length)
          w.varint(beziers(keys, 4))
          keys.forEach((k, i) => {
            w.float(k.time ?? 0)
            w.bytes(Buffer.from((k.color ?? 'ffffffff').padEnd(8, 'f'), 'hex'))
            if (i > 0) curve(w, keys[i - 1].curve, 4)
          })
        }
      }
    }
    const boneTl = Object.entries(a.bones ?? {})
    w.varint(boneTl.length)
    for (const [bone, tls] of boneTl) {
      w.varint(boneIndex(bone))
      const list = Object.entries(tls)
      w.varint(list.length)
      for (const [type, keys] of list) {
        timelines++
        if (type === 'rotate') {
          w.byte(0)
          timeline(w, keys, ['value'], [0])
        } else if (type === 'translate') {
          w.byte(1)
          timeline(w, keys, ['x', 'y'], [0, 0])
        } else if (type === 'scale') {
          w.byte(4)
          timeline(w, keys, ['x', 'y'], [1, 1])
        }
      }
    }
    for (let i = 0; i < 5; i++) w.varint(0)
    const draw = a.drawOrder ?? []
    w.varint(draw.length)
    for (const d of draw) {
      w.float(d.time ?? 0)
      w.varint(d.offsets.length)
      for (const off of d.offsets) {
        w.varint(slotIndex(off.slot))
        w.varint(off.offset)
      }
    }
    const ev = a.events ?? []
    w.varint(ev.length)
    for (const e of ev) {
      const data = sk.events[e.name]
      w.float(e.time ?? 0)
      w.varint(events.findIndex(([n]) => n === e.name))
      w.varint(e.int ?? data.int ?? 0, false)
      w.float(e.float ?? data.float ?? 0)
      w.string(e.string ?? null)
      if (data.audio) {
        w.float(e.volume ?? 1)
        w.float(e.balance ?? 0)
      }
    }
    if (draw.length) timelines++
    if (ev.length) timelines++
    animOut.varint(timelines)
    animOut.bytes(w.done())
  }

  const s = sk.skeleton
  const o = new Out()
  o.int32(0x01234567)
  o.int32(0x89abcdef)
  o.string(s.spine)
  for (const k of ['x', 'y', 'width', 'height']) o.float(s[k] ?? 0)
  o.float(s.referenceScale ?? 100)
  o.bool(nonessential)
  if (nonessential) {
    o.float(s.fps ?? 30)
    o.string(s.images ?? null)
    o.string(s.audio ?? null)
  }
  o.varint(strings.length)
  for (const str of strings) o.string(str)
  o.varint(sk.bones.length)
  o.bytes(bones.done())
  o.varint(sk.slots.length)
  o.bytes(slots.done())
  for (let i = 0; i < 4; i++) o.varint(0)
  o.bytes(skinOut.done())
  o.bytes(eventOut.done())
  o.bytes(animOut.done())
  return o.done()
}
