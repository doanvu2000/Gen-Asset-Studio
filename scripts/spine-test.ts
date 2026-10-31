import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { JobSpec } from '../src/shared/queue'
import { parseSpineAtlas } from '../src/main/spine/atlas'
import { parseSkeleton, applyRig } from '../src/main/spine/skeleton'
import { extractRegion, writeRegion } from '../src/main/spine/regions'
import { SpineService, regionAsset } from '../src/main/spine/service'
import { versionsDir } from '../src/main/queue/GenJob'
import { readProject, writeProject, emptyProject } from '../src/main/workspace/project'
import { createImage, decode } from '../src/main/pipeline/image'
import { savePng } from '../src/main/sprite/strip'

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
  const skelOnly = join(base, 'x.skel')
  writeFileSync(skelOnly, 'bin')
  check((await svc.importPaths('Hero Spine', [skelOnly])).error === 'skel', 'binary .skel refused')
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
  console.log(`\n${passed} passed, ${failed} failed`)
  rmSync(base, { recursive: true, force: true })
  if (failed) process.exit(1)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
