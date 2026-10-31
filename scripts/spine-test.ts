import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { JobSpec } from '../src/shared/queue'
import { parseSpineAtlas } from '../src/main/spine/atlas'
import { parseSkeleton, applyRig, SkeletonError } from '../src/main/spine/skeleton'
import { applyRigBinary, parseSkeletonBinary } from '../src/main/spine/binary'
import { extractRegion, writeRegion } from '../src/main/spine/regions'
import { SpineService, regionAsset } from '../src/main/spine/service'
import { versionsDir } from '../src/main/queue/GenJob'
import { readProject, writeProject, emptyProject } from '../src/main/workspace/project'
import { createImage, decode } from '../src/main/pipeline/image'
import { savePng } from '../src/main/sprite/strip'
import { writeSkel } from './spine-skel-writer.mjs'

const root = resolve(__dirname, '..')
const sample = join(root, 'resources/spine-samples/hero')
const base = join(process.env['TEMP'] ?? '.', 'gas-spine-test')
const proj = join(base, 'Hero Spine')
let passed = 0
let failed = 0
function check(cond: unknown, msg: string): void {
  if (cond) {
    passed++
    console.log(`  ok   ${msg}`)
  } else {
    failed++
    console.log(`  FAIL ${msg}`)
  }
}

function diff(a: { data: Uint8Array }, b: { data: Uint8Array }): number {
  let n = 0
  for (let i = 0; i < a.data.length; i++) if (Math.abs(a.data[i] - b.data[i]) > 2) n++
  return n
}

function errCode(fn: () => unknown): string {
  try {
    fn()
    return 'none'
  } catch (e) {
    return e instanceof SkeletonError ? e.code : `other:${(e as Error).message}`
  }
}

const RICH = {
  skeleton: { spine: '4.2.40', x: -10, y: -20, width: 300, height: 400, images: './img/', audio: './snd/' },
  bones: [{ name: 'root' }, { name: 'a', parent: 'root', x: 3, y: 4, rotation: 10, scaleX: 2 }, { name: 'b', parent: 'a', length: 50, skin: true }],
  slots: [
    { name: 's1', bone: 'a', attachment: 'r1' },
    { name: 's2', bone: 'b', attachment: 'm1' },
    { name: 's3', bone: 'root' }
  ],
  skins: [
    {
      name: 'default',
      attachments: {
        s1: {
          r1: { x: 1, y: 2, width: 10, height: 20, rotation: 30, color: 'ff0000ff' },
          r2: { path: 'atlas/r2', name: 'r2name', x: 5, width: 10, height: 10, sequence: { count: 3, start: 1, digits: 2, setup: 0 } },
          pt: { type: 'point', x: 1, y: 1, rotation: 5 }
        },
        s2: {
          m1: { type: 'mesh', path: 'mesh/m1', uvs: [0, 0, 1, 0, 1, 1, 0, 1], vertices: [0, 0, 10, 0, 10, 10, 0, 10], triangles: [0, 1, 2, 2, 3, 0], hull: 4, edges: [0, 2, 2, 4], width: 10, height: 10 },
          mw: { type: 'mesh', uvs: [0, 0, 1, 0, 1, 1], vertices: [1, 1, 0, 0, 1, 1, 1, 5, 0, 1, 2, 1, 2, 5, 5, 0.5], triangles: [0, 1, 2], hull: 3 }
        },
        s3: { bb: { type: 'boundingbox', vertexCount: 3, vertices: [0, 0, 5, 0, 5, 5] } }
      }
    },
    {
      name: 'alt',
      attachments: {
        s1: { r1: { name: 'r1alt', x: 7, y: 8, width: 12, height: 12 } },
        s2: { lm: { type: 'linkedmesh', parent: 'm1', skin: 'default', path: 'mesh/lm', width: 10, height: 10 } }
      }
    }
  ],
  events: { hit: { int: -3, float: 1.5, string: 'boom' }, step: { audio: 'step.wav', volume: 0.5, balance: 0.1 } },
  animations: {
    swing: {
      slots: {
        s1: {
          attachment: [{ time: 0, name: 'r2' }, { time: 0.5, name: null }],
          rgba: [{ time: 0, color: 'ff00ffff', curve: [0.25, 0, 0.75, 1] }, { time: 1, color: '00ff0080', curve: 'stepped' }, { time: 2, color: 'ffffffff' }]
        }
      },
      bones: {
        a: { rotate: [{ value: 0, curve: [0.1, 0, 0.9, 30] }, { time: 1, value: 30 }], scale: [{ x: 1, y: 1 }, { time: 1, x: 2, y: 0.5 }] },
        b: { translate: [{ x: 0, y: 0, curve: 'stepped' }, { time: 0.5, x: 5, y: -5 }] }
      },
      drawOrder: [{ time: 0.5, offsets: [{ slot: 's1', offset: 1 }] }],
      events: [{ time: 0.2, name: 'hit' }, { time: 0.8, name: 'step', string: 'x' }]
    },
    empty: {}
  }
}

interface CoreAttachment {
  constructor: { name: string }
  parentMesh?: unknown
  path?: string
  x?: number
  y?: number
  rotation?: number
  scaleX?: number
  scaleY?: number
}

interface CoreSkel {
  version: string
  bones: Array<{ name: string; parent: { name: string } | null; x: number; y: number; rotation: number; scaleX: number; scaleY: number }>
  slots: Array<{ name: string; boneData: { name: string }; attachmentName: string | null }>
  skins: Array<{ name: string; getAttachments: () => Array<{ slotIndex: number; name: string; attachment: CoreAttachment }> }>
  animations: Array<{ name: string; duration: number }>
  events: Array<{ name: string }>
}

async function coreRead(bytes: Uint8Array): Promise<CoreSkel> {
  const core = await import('@esotericsoftware/spine-core')
  const region = (): never => ({ u: 0, v: 0, u2: 1, v2: 1, width: 1, height: 1, degrees: 0, offsetX: 0, offsetY: 0, originalWidth: 1, originalHeight: 1 }) as never
  const loader = {
    newRegionAttachment: (_s: unknown, n: string, p: string) => Object.assign(new core.RegionAttachment(n, p), { region: region() }),
    newMeshAttachment: (_s: unknown, n: string, p: string) => Object.assign(new core.MeshAttachment(n, p), { region: region() }),
    newBoundingBoxAttachment: (_s: unknown, n: string) => new core.BoundingBoxAttachment(n),
    newPathAttachment: (_s: unknown, n: string) => new core.PathAttachment(n),
    newPointAttachment: (_s: unknown, n: string) => new core.PointAttachment(n),
    newClippingAttachment: (_s: unknown, n: string) => new core.ClippingAttachment(n)
  }
  return new core.SkeletonBinary(loader as never).readSkeletonData(new Uint8Array(bytes)) as unknown as CoreSkel
}

function coreKinds(sd: CoreSkel): string {
  const out: string[] = []
  for (const sk of sd.skins) {
    for (const e of sk.getAttachments()) {
      const c = e.attachment.constructor.name
      const k = c === 'RegionAttachment' ? 'region' : c === 'MeshAttachment' ? (e.attachment.parentMesh ? 'linkedmesh' : 'mesh') : 'other'
      if (k !== 'other') out.push(`${sk.name}/${sd.slots[e.slotIndex].name}/${e.name}=${e.attachment.path}:${k}`)
    }
  }
  return out.sort().join()
}

function ourKinds(info: ReturnType<typeof parseSkeletonBinary>['info']): string {
  return info.attachments.map((a) => `${a.skin}/${a.slot}/${a.name}=${a.region}:${a.kind}`).sort().join()
}

function coreAtt(sd: CoreSkel, skin: number, slot: string, name?: string): CoreAttachment {
  return sd.skins[skin].getAttachments().find((e) => sd.slots[e.slotIndex].name === slot && (!name || e.name === name))!.attachment
}

async function binaryTests(): Promise<void> {
  const heroSkel = readFileSync(join(sample, 'hero.skel'))
  const heroJson = readFileSync(join(sample, 'hero.json'), 'utf8')
  const bin = parseSkeletonBinary(heroSkel)
  check(JSON.stringify(bin.info) === JSON.stringify(parseSkeleton(heroJson).info), 'hero.skel parses to the same info as hero.json')
  const core = await coreRead(heroSkel)
  check(core.version === '4.2.11' && core.bones.map((b) => b.name).join() === bin.info.bones.map((b) => b.name).join() && coreKinds(core) === ourKinds(bin.info), 'spine-core reads hero.skel with the same bones / attachments')

  for (const nonessential of [false, true]) {
    const rich = writeSkel(RICH, { nonessential })
    const p = parseSkeletonBinary(rich)
    const sd = await coreRead(rich)
    const same =
      sd.bones.map((b) => `${b.name}<${b.parent?.name ?? ''}`).join() === p.info.bones.map((b) => `${b.name}<${b.parent ?? ''}`).join() &&
      sd.slots.map((x) => `${x.name}@${x.boneData.name}=${x.attachmentName}`).join() === p.info.slots.map((x) => `${x.name}@${x.bone}=${x.attachment}`).join() &&
      sd.skins.map((x) => x.name).join() === p.info.skins.join() &&
      sd.animations.map((x) => x.name).join() === p.info.animations.join() &&
      coreKinds(sd) === ourKinds(p.info)
    check(same && p.info.animations.join() === 'swing,empty' && p.info.skins.join() === 'default,alt', `rich skeleton (nonessential ${nonessential}) matches spine-core: skins, mesh, linkedmesh, sequence, events, timelines`)
    check(JSON.stringify(p.info) === JSON.stringify(parseSkeleton(JSON.stringify(RICH)).info), `rich skeleton (nonessential ${nonessential}) info = json reader`)
  }

  const rig = { bones: { head: { y: 70, rotation: 5 }, ghost: { x: 1 } }, attachments: { 'default/head/head': { scaleX: 1.2, rotation: 15 }, 'default/body/body': { x: 3 }, 'default/nope/nope': { y: 9 } } }
  const rigged = applyRigBinary(heroSkel, rig)
  const rs = await coreRead(rigged)
  const head = rs.bones.find((b) => b.name === 'head')
  check(head?.y === 70 && head.rotation === 5 && head.x === 0, 'rigged .skel: spine-core sees head bone y 70, rotation 5')
  const ha = coreAtt(rs, 0, 'head')
  check(Math.abs((ha.scaleX ?? 0) - 1.2) < 1e-6 && ha.rotation === 15 && ha.y === 48 && coreAtt(rs, 0, 'body').x === 3, 'rigged .skel: attachment scaleX / inserted rotation / x applied')
  check(rigged.length === heroSkel.length + 4, 'rotation float spliced in (+4 bytes)')
  check(rs.animations.map((a) => `${a.name}:${a.duration}`).join() === core.animations.map((a) => `${a.name}:${a.duration}`).join(), 'rigged .skel: animations intact')
  const tail = heroSkel.length - bin.layout.tailAt
  check(tail > 0 && Buffer.compare(Buffer.from(rigged.subarray(rigged.length - tail)), heroSkel.subarray(bin.layout.tailAt)) === 0, `bytes after skins (events + animations, ${tail} B) unchanged`)
  check(parseSkeletonBinary(rigged).layout.tailAt === bin.layout.tailAt + 4, 'rigged .skel re-parses with own reader')
  const twice = applyRigBinary(rigged, { bones: {}, attachments: { 'default/head/head': { rotation: -20 } } })
  check(twice.length === rigged.length && coreAtt(await coreRead(twice), 0, 'head').rotation === -20, 'second rotation edit overwrites in place')
  check(Buffer.compare(Buffer.from(applyRigBinary(heroSkel, { bones: { nope: { x: 1 } }, attachments: { 'x/y/z': { x: 1 } } })), heroSkel) === 0, 'rig on missing bone / attachment leaves bytes unchanged')
  check(applyRigBinary(heroSkel, { bones: {}, attachments: {} }) === heroSkel, 'empty rig returns input')

  const richBytes = writeSkel(RICH, { nonessential: true })
  const richRig = applyRigBinary(richBytes, { bones: { b: { scaleY: 3 } }, attachments: { 'default/s1/r2': { rotation: 45, y: 6 }, 'alt/s1/r1': { scaleY: 0.5 }, 'default/s2/m1': { x: 99 } } })
  const rsd = await coreRead(richRig)
  const r2 = coreAtt(rsd, 0, 's1', 'r2')
  check(rsd.bones[2].scaleY === 3 && r2.rotation === 45 && r2.y === 6 && coreAtt(rsd, 1, 's1', 'r1').scaleY === 0.5 && rsd.animations.length === 2 && rsd.events.length === 2, 'rig on rich skeleton (sequence region, non-default skin, mesh ignored)')

  check(errCode(() => parseSkeletonBinary(writeSkel({ ...RICH, skeleton: { ...RICH.skeleton, spine: '4.3.01' } }))) === 'version', 'binary 4.3 refused (version)')
  const old = Buffer.concat([Buffer.from([9]), Buffer.from('abcdefgh'), Buffer.from([7]), Buffer.from('4.1.24'), Buffer.alloc(40)])
  check(errCode(() => parseSkeletonBinary(old)) === 'version', 'binary 4.1 refused (version)')
  check(errCode(() => parseSkeletonBinary(Buffer.from(heroJson))) === 'parse' && errCode(() => parseSkeletonBinary(Buffer.alloc(0))) === 'parse', 'json / empty bytes → parse error')
  let bad = 0
  for (const src of [heroSkel, richBytes]) for (let n = 0; n < src.length; n++) if (errCode(() => parseSkeletonBinary(src.subarray(0, n))) !== 'parse') bad++
  check(bad === 0, `every truncation of .skel → SkeletonError parse (${bad} bad)`)
  let other = 0
  for (let i = 30; i < heroSkel.length; i += 7) {
    const c = Buffer.from(heroSkel)
    c[i] ^= 0xa5
    if (errCode(() => parseSkeletonBinary(c)).startsWith('other')) other++
  }
  check(other === 0, 'corrupted bytes never throw non-SkeletonError')
}

async function main(): Promise<void> {
  rmSync(base, { recursive: true, force: true })
  mkdirSync(proj, { recursive: true })
  const atlas = parseSpineAtlas(readFileSync(join(sample, 'hero.atlas'), 'utf8'))
  check(atlas.pages.length === 1 && atlas.pages[0].w === 512 && atlas.regions.length === 6, 'atlas: 1 page 512 wide, 6 regions')
  const arm = atlas.regions.find((r) => r.name === 'arm_l')
  const body = atlas.regions.find((r) => r.name === 'body')
  check(arm?.degrees === 90 && arm.w === 30 && arm.h === 80, 'arm_l rotate:90 with upright bounds 30x80')
  check(body?.offsetX === 8 && body.offsetY === 6 && body.origW === 96 && body.origH === 112, 'body offsets parsed')
  const old = parseSpineAtlas('\nold.png\nsize: 64,64\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\nhat\n  rotate: true\n  xy: 2, 2\n  size: 10, 20\n  orig: 12, 22\n  offset: 1, 1\n  index: -1\n')
  check(old.regions[0]?.degrees === 90 && old.regions[0].w === 10 && old.regions[0].origW === 12, 'legacy atlas format')

  const page = await decode(join(sample, 'hero.png'))
  const up = await extractRegion(page, arm as never)
  check(up.width === 30 && up.height === 80, `arm_l extracted upright ${up.width}x${up.height}`)
  const blank = createImage(page.width, page.height)
  for (const r of atlas.regions) await writeRegion(blank, r, await extractRegion(page, r))
  check(diff(blank, page) === 0, 'extract → write round-trip reproduces the page exactly')

  const sk = parseSkeleton(readFileSync(join(sample, 'hero.json'), 'utf8'))
  check(sk.info.version.startsWith('4.2') && sk.info.bones.length === 8 && sk.info.animations.join() === 'idle,walk', 'skeleton 4.2 info')
  let threw = ''
  try {
    parseSkeleton(JSON.stringify({ skeleton: { spine: '4.1.20' } }))
  } catch (e) {
    threw = (e as { code: string }).code
  }
  check(threw === 'version', 'spine 4.1 refused')
  const rigged = JSON.parse(applyRig(readFileSync(join(sample, 'hero.json'), 'utf8'), { bones: { head: { y: 70, rotation: 5 } }, attachments: { 'default/head/head': { scaleX: 1.2 } } }))
  check(rigged.bones.find((b: { name: string }) => b.name === 'head').y === 70 && rigged.skins[0].attachments.head.head.scaleX === 1.2, 'applyRig edits bone + attachment')
  await binaryTests()

  await writeProject(proj, emptyProject('Hero Spine', 'spine'))
  const queued: JobSpec[] = []
  const svc = new SpineService({
    projectDir: () => proj,
    run: (fn) => fn(),
    allow: () => undefined,
    log: () => undefined,
    readProject,
    writeProject,
    enqueue: () => (specs) => {
      queued.push(...specs)
      return specs.map(() => 'j')
    },
    template: async () => null
  })
  const junk = join(base, 'junk')
  mkdirSync(junk)
  writeFileSync(join(junk, 'x.skel'), 'bin')
  copyFileSync(join(sample, 'hero.atlas'), join(junk, 'x.atlas'))
  copyFileSync(join(sample, 'hero.png'), join(junk, 'hero.png'))
  check((await svc.importPaths('Hero Spine', [join(junk, 'x.skel')])).error?.startsWith('parse') === true, 'garbage .skel → parse error')
  const r = await svc.importPaths('Hero Spine', [join(sample, 'hero.json')])
  check(!r.error && r.view?.loaded && r.view.regions.length === 6 && r.view.regions.every((x) => !!x.sourceUrl && x.used), `import json → atlas + page found (${r.error})`)
  check(r.view?.regions.find((x) => x.name === 'head')?.slots.join() === 'head', 'region ↔ slot mapping')
  check((await svc.enqueue('Hero Spine', ['head'])) === -1, 'enqueue refused until style locked')
  await svc.setStyle('Hero Spine', { promptEn: 'candy', locked: true })
  check((await svc.enqueue('Hero Spine', atlas.regions.map((x) => x.name))) === 6, '6 regions enqueued')
  check(queued.every((q) => existsSync(q.sourcePath) && (q.refImages ?? []).some((p) => p.endsWith('board.png')) && /Spine skeletal character/.test(q.note ?? '')), 'jobs carry source, parts board, region note')
  for (const q of queued) {
    const vdir = versionsDir(proj, q.assetRelPath)
    mkdirSync(vdir, { recursive: true })
    copyFileSync(q.sourcePath, join(vdir, 'v1.png'))
  }
  const assetsNew = await svc.assets('Hero Spine', 'new')
  check(!!assetsNew && Object.keys(assetsNew.pages).join() === 'hero.png' && assetsNew.pages['hero.png'].startsWith('data:image/png;base64,'), 'assets(new) with composed page')
  const patch: Record<string, { decision: 'approved' }> = {}
  for (const x of atlas.regions) patch[x.name] = { decision: 'approved' }
  await svc.review('Hero Spine', patch)
  check((await svc.exportRun('Hero Spine', sample)).error === 'outIsSource', 'export into source folder refused')
  const out = join(base, 'out')
  let ex = await svc.exportRun('Hero Spine', out)
  check(ex.ok && ex.pages[0]?.regions === 6 && !ex.rigChanged, `export 6 regions, rig unchanged (${ex.error})`)
  check(diff(await decode(join(out, 'hero.png')), page) === 0, 'identity versions → exported page identical to source')
  check(readFileSync(join(out, 'hero.json'), 'utf8') === readFileSync(join(sample, 'hero.json'), 'utf8') && existsSync(join(out, 'hero.atlas')), 'json + atlas copied unchanged')
  await svc.setRig('Hero Spine', { bones: { head: { y: 66 } }, attachments: {} })
  ex = await svc.exportRun('Hero Spine', out)
  const j = JSON.parse(readFileSync(join(out, 'hero.json'), 'utf8'))
  check(ex.rigChanged && j.bones.find((b: { name: string }) => b.name === 'head').y === 66 && existsSync(join(out, 'hero.original.json')) && !!ex.backupDir, 'rig export writes new json + original + backup')
  const red = createImage(30, 80)
  red.data.fill(255)
  await savePng(red, join(versionsDir(proj, regionAsset('arm_l')), 'v2.png'))
  const v = await svc.open('Hero Spine')
  check(v?.regions.find((x) => x.name === 'arm_l')?.selected === 2 && v.regions.find((x) => x.name === 'arm_l')?.decision === null, 'new version becomes selected, needs review again')
  await skelProject(page)
  console.log(`\n${passed} passed, ${failed} failed`)
  rmSync(base, { recursive: true, force: true })
  if (failed) process.exit(1)
}

async function skelProject(page: Awaited<ReturnType<typeof decode>>): Promise<void> {
  const dir = join(base, 'Hero Skel')
  mkdirSync(dir, { recursive: true })
  await writeProject(dir, emptyProject('Hero Skel', 'spine'))
  const svc = new SpineService({ projectDir: () => dir, run: (fn) => fn(), allow: () => undefined, log: () => undefined, readProject, writeProject, enqueue: () => (specs) => specs.map(() => 'j'), template: async () => null })
  const heroSkel = readFileSync(join(sample, 'hero.skel'))
  const r = await svc.importPaths('Hero Skel', [join(sample, 'hero.skel')])
  check(!r.error && r.view?.loaded && r.view.skeletonFormat === 'binary' && r.view.skeletonName === 'hero.skel' && r.view.regions.length === 6 && r.view.regions.every((x) => x.used), `import .skel → atlas + page found (${r.error})`)
  check(r.view?.skeleton?.animations.join() === 'idle,walk' && r.view.regions.find((x) => x.name === 'arm_l')?.slots.join() === 'arm_l', '.skel skeleton info + region ↔ slot')
  const viaAtlas = await svc.importPaths('Hero Skel', [join(sample, 'hero.atlas')])
  check(viaAtlas.view?.skeletonFormat === 'json', 'atlas only → json preferred when both exist')
  await svc.importPaths('Hero Skel', [join(sample, 'hero.skel')])
  const orig = await svc.assets('Hero Skel', 'orig')
  check(orig?.format === 'binary' && orig.json === '' && Buffer.from(orig.skelBase64 ?? '', 'base64').equals(heroSkel), 'assets(orig): binary format + exact skel bytes')
  const atlas = parseSpineAtlas(readFileSync(join(sample, 'hero.atlas'), 'utf8'))
  for (const x of ['head', 'arm_l']) {
    const vdir = versionsDir(dir, regionAsset(x))
    mkdirSync(vdir, { recursive: true })
    await savePng(await extractRegion(page, atlas.regions.find((q) => q.name === x)!), join(vdir, 'v1.png'))
  }
  await svc.review('Hero Skel', { head: { decision: 'approved' }, arm_l: { decision: 'approved' } })
  const out = join(base, 'out-skel')
  let ex = await svc.exportRun('Hero Skel', out)
  check(ex.ok && ex.pages[0]?.regions === 2 && !ex.rigChanged && readFileSync(join(out, 'hero.skel')).equals(heroSkel) && !existsSync(join(out, 'hero.original.skel')), `export .skel without rig → copied unchanged (${ex.error})`)
  await svc.setRig('Hero Skel', { bones: { head: { y: 66 } }, attachments: { 'default/arm_l/arm_l': { rotation: 12 } } })
  const assetsNew = await svc.assets('Hero Skel', 'new')
  const sd = await coreRead(Buffer.from(assetsNew?.skelBase64 ?? '', 'base64'))
  check(assetsNew?.format === 'binary' && sd.bones.find((b) => b.name === 'head')?.y === 66 && coreAtt(sd, 0, 'arm_l').rotation === 12, 'assets(new): rigged skel readable by spine-core')
  ex = await svc.exportRun('Hero Skel', out)
  const outSd = await coreRead(readFileSync(join(out, 'hero.skel')))
  check(ex.rigChanged && ex.skeleton === 'hero.skel' && outSd.bones.find((b) => b.name === 'head')?.y === 66 && readFileSync(join(out, 'hero.original.skel')).equals(heroSkel), 'rig export writes new .skel + .original.skel')
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
