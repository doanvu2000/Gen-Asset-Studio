import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { JobSpec } from '../src/shared/queue'
import { parseSpineAtlas } from '../src/main/spine/atlas'
import { parseSkeleton, applyRig, SkeletonError } from '../src/main/spine/skeleton'
import { applyRigBinary, parseSkeletonBinary } from '../src/main/spine/binary'
import { extractRegion, premultiply, writeRegion } from '../src/main/spine/regions'
import { SpineService, assignAssets, refersTo, regionAsset } from '../src/main/spine/service'
import { AtlasError } from '../src/main/spine/atlas'
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
  const cache = join(proj, '.cache', 'spine', readdirSync(join(proj, '.cache', 'spine'))[0] ?? '')
  check(diff(await decode(join(cache, 'board.png')), await decode(join(cache, 'parts-board.png'))) === 0, 'cover board = original parts board before any generation')
  check((await svc.enqueue('Hero Spine', ['head'])) === -1, 'enqueue refused until style locked')
  await svc.setStyle('Hero Spine', { promptEn: 'candy', locked: true })
  check((await svc.enqueue('Hero Spine', atlas.regions.map((x) => x.name))) === 6, '6 regions enqueued')
  check(queued.every((q) => existsSync(q.sourcePath) && (q.refImages ?? []).some((p) => p.endsWith('parts-board.png')) && /Spine skeletal character/.test(q.note ?? '')), 'jobs carry source, parts board, region note')
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
  check(diff(await decode(join(cache, 'board.png')), await decode(join(cache, 'parts-board.png'))) > 0, 'cover board follows selected versions, reference board stays original')
  const coverAt = statSync(join(cache, 'board.png')).mtimeMs
  await svc.open('Hero Spine')
  check(statSync(join(cache, 'board.png')).mtimeMs === coverAt && existsSync(join(cache, 'board.key')), 'cover board not rebuilt when selection unchanged')
  await skelProject(page)
  await backendFixes(page)
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

type Raw = Awaited<ReturnType<typeof decode>>

function region(img: Raw, x: number, y: number, w: number, h: number): number[] {
  const out: number[] = []
  for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) out.push(...img.data.subarray((j * img.width + i) * 4, (j * img.width + i) * 4 + 4))
  return out
}

function sameish(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => Math.abs(v - b[i]) <= 2)
}

async function backendFixes(page: Raw): Promise<void> {
  const straight = { data: page.data.slice(), width: page.width, height: page.height }
  for (let i = 0; i < straight.data.length; i += 4) if (straight.data[i + 3]) straight.data[i + 3] = 1 + ((i >> 2) % 255)
  const pmaPage = premultiply({ data: straight.data.slice(), width: page.width, height: page.height })
  const atlas = parseSpineAtlas(readFileSync(join(sample, 'hero.atlas'), 'utf8'))
  const rebuilt = createImage(page.width, page.height)
  let semi = true
  for (const r of atlas.regions) {
    const up = await extractRegion(pmaPage, r, true)
    const ref = await extractRegion(straight, r)
    for (let i = 0; i < up.data.length; i += 4) if (ref.data[i + 3] >= 128 && !sameish([...up.data.subarray(i, i + 4)], [...ref.data.subarray(i, i + 4)])) semi = false
    await writeRegion(rebuilt, r, up, true)
  }
  check(semi, 'pma extract → straight colours (alpha ≥ 128, ≤ 2)')
  check(diff(rebuilt, pmaPage) === 0, 'pma extract → write round-trip with semi-transparent pixels (≤ 2)')

  const src = join(base, 'src16')
  mkdirSync(join(src, 'img'), { recursive: true })
  copyFileSync(join(sample, 'hero.json'), join(src, 'hero.json'))
  const atlasText = readFileSync(join(sample, 'hero.atlas'), 'utf8').replace(/\r/g, '').replace('hero.png\n', 'img/hero.png\npma:true\n')
  writeFileSync(join(src, 'hero.atlas'), atlasText)
  await savePng(pmaPage, join(src, 'img', 'hero.png'))
  const dir = join(base, 'Fix16')
  mkdirSync(dir, { recursive: true })
  await writeProject(dir, emptyProject('Fix16', 'spine'))
  const svc = new SpineService({ projectDir: () => dir, run: (fn) => fn(), allow: () => undefined, log: () => undefined, readProject, writeProject, enqueue: () => (specs) => specs.map(() => 'j'), template: async () => null })
  const r = await svc.importPaths('Fix16', [join(src, 'hero.json')])
  check(!r.error && r.view?.status === 'ok' && r.view.pages[0]?.pma === true, `pma atlas with page in subfolder imported (${r.error})`)
  const srcHead = await decode(join(dir, '.cache', 'spine', readdirSync(join(dir, '.cache', 'spine'))[0], 'src', 'head.png'))
  const head = atlas.regions.find((x) => x.name === 'head')!
  check(sameish([...srcHead.data].filter((_, i) => i % 4 === 3), region(straight, head.x, head.y, head.w, head.h).filter((_, i) => i % 4 === 3)), 'region source sent to AI keeps alpha, un-premultiplied')
  for (const x of atlas.regions) {
    const vdir = versionsDir(dir, regionAsset(x.name))
    mkdirSync(vdir, { recursive: true })
    await savePng(await extractRegion(pmaPage, x, true), join(vdir, 'v1.png'))
  }
  const all: Record<string, { decision: 'approved' }> = {}
  for (const x of atlas.regions) all[x.name] = { decision: 'approved' }
  await svc.review('Fix16', all)
  const out = join(base, 'out16')
  let ex = await svc.exportRun('Fix16', out)
  check(ex.ok && ex.pages[0]?.name === 'img/hero.png' && existsSync(join(out, 'img', 'hero.png')) && !existsSync(join(out, 'hero.png')), `export keeps page sub-path img/hero.png (${ex.error})`)
  check(diff(await decode(join(out, 'img', 'hero.png')), pmaPage) === 0, 'pma export: identity versions → premultiplied page reproduced (≤ 2)')
  ex = await svc.exportRun('Fix16', out)
  check(!!ex.backupDir && existsSync(join(ex.backupDir, 'img', 'hero.png')), '_backup keeps page sub-path')

  const red = createImage(head.w, head.h)
  red.data.fill(255)
  await savePng(red, join(versionsDir(dir, regionAsset('head')), 'v2.png'))
  await svc.review('Fix16', { head: { decision: 'rejected' } })
  const decodeData = async (u: string | undefined): Promise<Raw> => decode(Buffer.from((u ?? '').split(',')[1] ?? '', 'base64'))
  let prev = await decodeData((await svc.assets('Fix16', 'new'))?.pages['img/hero.png'])
  check(sameish(region(prev, head.x, head.y, head.w, head.h), region(pmaPage, head.x, head.y, head.w, head.h)), 'preview: rejected version not composed, original kept')
  await svc.review('Fix16', { head: { decision: null } })
  prev = await decodeData((await svc.assets('Fix16', 'new'))?.pages['img/hero.png'])
  check(region(prev, head.x, head.y, 1, 1).join() === '255,255,255,255', 'preview: pending version is composed')
  ex = await svc.exportRun('Fix16', out)
  check(ex.ok && ex.pages[0]?.regions === 5, 'export still approved-only (pending head skipped)')

  await svc.review('Fix16', { head: { selected: 1, decision: 'approved' } })
  let v = await svc.open('Fix16')
  check(v?.regions.find((x) => x.name === 'head')?.selected === 1 && v.regions.find((x) => x.name === 'head')?.decision === 'approved', 'pinned v1 stays while no newer version')
  await savePng(red, join(versionsDir(dir, regionAsset('head')), 'v3.png'))
  v = await svc.open('Fix16')
  check(v?.regions.find((x) => x.name === 'head')?.selected === 3 && v.regions.find((x) => x.name === 'head')?.decision === null, 'new version unpins selection → latest, pending')
  await svc.review('Fix16', { head: { decision: 'approved' } })
  v = await svc.open('Fix16')
  const pj = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  check(v?.regions.find((x) => x.name === 'head')?.selected === 3 && v.regions.find((x) => x.name === 'head')?.decision === 'approved' && pj.spine.review.head.selected === 0, 'approving after unpin approves the latest, pin cleared')

  const pagePath = join(src, 'img', 'hero.png')
  const before = statSync(join(dir, 'project.json')).mtimeMs
  await svc.open('Fix16')
  check(statSync(join(dir, 'project.json')).mtimeMs === before, 'open with unchanged sources does not rewrite project')
  const t = new Date(Date.now() + 5000)
  const { utimesSync } = await import('node:fs')
  utimesSync(pagePath, t, t)
  v = await svc.open('Fix16')
  const pj2 = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  check(v?.status === 'ok' && Math.abs(pj2.spine.pages['img/hero.png'].mtime - t.getTime()) < 2, 'touched page (same bytes) → ok, new mtime stored')
  const p3 = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  delete p3.spine.skeleton.mtime
  delete p3.spine.skeleton.size
  delete p3.spine.assets
  p3.updatedAt = '2020-01-01T00:00:00.000Z'
  writeFileSync(join(dir, 'project.json'), JSON.stringify(p3))
  v = await svc.open('Fix16')
  const p3b = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  check(v?.status === 'ok' && typeof p3b.spine.skeleton.mtime === 'number', 'legacy project without mtime → rehash once, ok, stats stored')
  check(p3b.updatedAt === '2020-01-01T00:00:00.000Z' && p3b.spine.assets.head === 'spine/head' && v?.regions.find((x) => x.name === 'head')?.versions.length === 3, 'open-time migration (stats + asset map) does not bump updatedAt')
  await savePng(red, pagePath)
  v = await svc.open('Fix16')
  check(v?.status === 'changed' && v.error === 'sourceChanged' && v.changedFiles?.length === 1 && v.regions.length === 0, 'page replaced in place → status changed / sourceChanged')
  await svc.setStyle('Fix16', { promptEn: 'x', locked: true })
  check((await svc.exportRun('Fix16', out)).error === 'sourceChanged' && (await svc.enqueue('Fix16', ['head'])) === 0, 'export / enqueue refused while sources changed')
  await savePng(pmaPage, pagePath)
  writeFileSync(join(src, 'hero.atlas'), atlasText.replace('head\nbounds:2,2,100,100', 'head\nbounds:2,2,100,99'))
  const re = await svc.importPaths('Fix16', [join(src, 'hero.json')])
  const pj4 = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  check(re.view?.status === 'ok' && !pj4.spine.review.head && pj4.spine.review.body?.decision === 'approved' && re.view.regions.find((x) => x.name === 'head')?.versions.length === 3, 're-import with re-packed atlas: resized region review reset, versions + other reviews kept')

  writeFileSync(join(src, 'hero.atlas'), atlasText.replace('head\nbounds:2,2,100,100', 'Head\nbounds:2,2,10,10\nhead\nbounds:2,2,100,100'))
  const coll = await svc.importPaths('Fix16', [join(src, 'hero.json')])
  const pj5 = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  check(!coll.error && pj5.spine.assets.head === 'spine/head' && pj5.spine.assets.Head.startsWith('spine/Head-') && coll.view?.regions.find((x) => x.name === 'head')?.versions.length === 3, 'colliding region added before an existing one → existing asset dir kept')
  writeFileSync(join(src, 'hero.atlas'), atlasText.replace('rotate:90', 'rotate:180'))
  await svc.review('Fix16', { head: { decision: 'approved' }, nope: { decision: 'approved' } })
  const pj6 = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8'))
  check(pj6.spine.review.head.version === 3 && pj6.spine.review.head.seen === 3 && !pj6.spine.review.nope.version && !pj6.spine.review.nope.seen, 'review uses stored asset map (atlas unparseable), unknown region gets no version/seen')
  copyFileSync(join(src, 'img', 'hero.png'), join(base, 'evil.png'))
  writeFileSync(join(src, 'hero.atlas'), atlasText.replace('img/hero.png\n', '../evil.png\n'))
  const evil = await svc.importPaths('Fix16', [join(src, 'hero.json')])
  const exEvil = await svc.exportRun('Fix16', join(base, 'out-evil'))
  check(!evil.error && exEvil.error === 'pagePath:../evil.png' && !existsSync(join(base, 'out-evil', 'evil.png')), `page path escaping outDir → ${exEvil.error}`)

  let code = ''
  try {
    parseSpineAtlas('p.png\nsize:8,8\nr\nbounds:0,0,2,2\nrotate:180\n')
  } catch (e) {
    code = e instanceof AtlasError ? e.code : 'other'
  }
  check(code === 'unsupportedRotate', 'rotate 180 → AtlasError unsupportedRotate')
  writeFileSync(join(src, 'hero.atlas'), atlasText.replace('rotate:90', 'rotate:270'))
  const rot = await svc.importPaths('Fix16', [join(src, 'hero.json')])
  check(rot.error?.startsWith('unsupportedRotate:') === true, `import with rotate 270 → ${rot.error}`)

  const seq = { skin: 'default', slot: 's', name: 'fx', region: 'seq/fx', kind: 'region' as const, sequence: { count: 3, start: 1, digits: 2 } }
  check(refersTo(seq, 'seq/fx01') && refersTo(seq, 'seq/fx03') && !refersTo(seq, 'seq/fx04') && !refersTo(seq, 'seq/fx1') && !refersTo(seq, 'seq/fx00') && refersTo(seq, 'seq/fx'), 'sequence attachment matches padded frame regions')
  const r2 = parseSkeletonBinary(writeSkel(RICH, { nonessential: false })).info.attachments.find((a) => a.name === 'r2')
  check(r2?.sequence?.count === 3 && r2.sequence.start === 1 && r2.sequence.digits === 2, 'binary reader keeps sequence count/start/digits')

  const m = assignAssets(['a b', 'a_b', 'c', 'Head', 'head', 'x y', 'x:y'], {})
  check(m['a b'] === 'spine/a_b' && m['a_b'].startsWith('spine/a_b-') && m.c === 'spine/c' && m.Head === 'spine/Head' && m.head.startsWith('spine/head-') && m['x y'] === 'spine/x_y' && m['x:y'] !== m['x y'] && new Set(Object.values(m)).size === 7, 'assignAssets: first in atlas order keeps the legacy name, suffix only on collisions')
  const m2 = assignAssets(['Head', 'head', 'a b'], { head: 'spine/head', gone: 'spine/a_b' })
  check(m2.head === 'spine/head' && m2.Head.startsWith('spine/Head-') && m2['a b'].startsWith('spine/a_b-') && m2.gone === 'spine/a_b', 'assignAssets: stored mapping never changes, new names avoid it')
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
