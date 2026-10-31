import { existsSync, mkdirSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { SpineService } from '../src/main/spine/service'
import { flushSpriteCovers, SpriteService } from '../src/main/sprite/service'
import { sheetCoverPath } from '../src/main/sprite/strips'
import { WorkspaceService } from '../src/main/workspace/service'
import { emptyProject, readProject, thumbPath, writeProject, type ProjectFile } from '../src/main/workspace/project'
import type { ProjectSummary } from '../src/shared/workspace'

const base = join(process.env['TEMP'] ?? '.', 'gas-card-test')
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

const frame = (x: number): Record<string, unknown> => ({ name: `f${x}`, x: x * 64, y: 0, w: 64, h: 64 })

function sheet(id: string): Record<string, unknown> {
  return {
    id,
    path: join(base, `${id}.png`),
    w: 256,
    h: 64,
    hash: `h-${id}`,
    format: 'grid',
    frames: [0, 1, 2, 3].map(frame),
    anims: [
      { id: 'walk_s', name: 'walk', dir: 'S', frames: [0, 1] },
      { id: 'walk_w', name: 'walk', dir: 'W', frames: [2, 3] },
      { id: 'walk_e', name: 'walk', dir: 'E', frames: [2, 3] }
    ]
  }
}

function touch(p: string, mtime?: number): void {
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, 'x')
  if (mtime) utimesSync(p, mtime / 1000, mtime / 1000)
}

async function project(name: string, kind: 'sprite' | 'spine', extra: Record<string, unknown>): Promise<string> {
  const dir = join(base, 'ws', name)
  mkdirSync(dir, { recursive: true })
  const data = { ...emptyProject(name, kind), ...extra } as ProjectFile
  await writeProject(dir, data)
  return dir
}

function decodeUrl(u: string): string {
  return Buffer.from(new URL(u).pathname.replace(/^\//, ''), 'base64url').toString('utf8')
}

async function solid(p: string, w: number, h: number, c: [number, number, number]): Promise<void> {
  mkdirSync(join(p, '..'), { recursive: true })
  await sharp({ create: { width: w, height: h, channels: 4, background: { r: c[0], g: c[1], b: c[2], alpha: 1 } } }).png().toFile(p)
}

async function pixel(p: string, x: number, y: number): Promise<number[]> {
  const { data, info } = await sharp(p).raw().ensureAlpha().toBuffer({ resolveWithObject: true })
  const i = (y * info.width + x) * 4
  return [data[i], data[i + 1], data[i + 2], data[i + 3]]
}

async function coverChecks(settings: Record<string, unknown>): Promise<void> {
  const rec = { ...sheet('c'), path: join(base, 'cover-src.png') }
  await solid(rec.path as string, 256, 64, [128, 128, 128])
  const dir = await project('S5-cover', 'sprite', { sprite: { settings, sheets: [rec] } })
  const logs: string[] = []
  const svc = new SpriteService({ projectDir: () => dir, run: (fn) => fn(), allow: () => undefined, log: (m) => logs.push(m), readProject, writeProject })
  const cover = sheetCoverPath(dir, 'c')
  const open = async (): Promise<void> => {
    await svc.open('S5-cover')
    await flushSpriteCovers(dir)
  }
  const review = async (patch: Parameters<SpriteService['review']>[1]): Promise<void> => {
    await svc.review('S5-cover', patch)
    await flushSpriteCovers(dir)
  }
  const ver = (anim: string, v: number): string => join(dir, 'versions', 'sprite', 'c', anim, `v${v}.png`)
  const card = async (): Promise<string> => {
    const ws = new WorkspaceService(() => undefined)
    await ws.setRoot(join(base, 'ws'))
    const t = ws.snapshot().projects.find((p) => p.name === 'S5-cover')?.thumbs[0] ?? ''
    await ws.dispose()
    return t
  }

  await open()
  const before = await card()
  check(!existsSync(cover) && !!before && decodeUrl(before) === thumbPath(dir, 'h-c'), `before gen → thumb is original sheet (${before ? decodeUrl(before) : 'none'})`)

  await solid(ver('walk_s', 1), 128, 64, [255, 0, 0])
  await open()
  const after = await card()
  check(existsSync(cover) && decodeUrl(after) === cover && /\?v=c-/.test(after), `after gen → thumb is cover, versioned (${after})`)
  const px = await pixel(cover, 10, 10)
  check(px[0] === 255 && px[1] === 0 && (await pixel(cover, 200, 10))[0] === 128, `cover has new frames, rest original (${px.join()})`)
  const m1 = statSync(cover).mtimeMs
  await new Promise((r) => setTimeout(r, 30))
  await open()
  check(statSync(cover).mtimeMs === m1 && (await card()) === after, 'same selection → cover not rewritten, same url')

  await solid(ver('walk_s', 2), 128, 64, [0, 0, 255])
  await open()
  check((await pixel(cover, 10, 10))[2] === 255 && (await card()) !== after, 'new version → cover uses latest, url changes')
  await review({ 'c:walk_s': { selected: 1, decision: 'approved' } })
  check((await pixel(cover, 10, 10))[0] === 255, 'approved older version wins over latest')
  await review({ 'c:walk_s': { selected: 2 } })
  check((await pixel(cover, 10, 10))[2] === 255, 'approval cleared → latest again')

  await solid(ver('walk_w', 1), 128, 64, [0, 255, 0])
  await open()
  check((await pixel(cover, 140, 10))[1] === 255, 'mirror source strip lands in sheet')

  writeFileSync(cover, 'broken')
  await open()
  const meta = await sharp(cover).metadata().catch(() => null)
  check(meta?.width === 256 && meta.height === 64, `corrupt cover rebuilt (${meta?.width}x${meta?.height})`)

  rmSync(join(dir, 'versions'), { recursive: true, force: true })
  await open()
  const gone = await card()
  check(!existsSync(cover) && decodeUrl(gone) === thumbPath(dir, 'h-c'), 'versions deleted → cover removed, original thumb back')
  check(logs.every((l) => !/cover/.test(l)), `no cover errors logged (${logs.filter((l) => /cover/.test(l)).join(' | ')})`)
}

async function main(): Promise<void> {
  rmSync(base, { recursive: true, force: true })
  const settings = { dirSet: 4, mirror: true }
  await project('S0-empty', 'sprite', { sprite: { settings, sheets: [] } })
  await project('S1-fresh', 'sprite', { sprite: { settings, sheets: [sheet('a')] } })
  const s2 = await project('S2-gen', 'sprite', { sprite: { settings, sheets: [sheet('a')], review: { 'a:walk_s': { decision: 'approved', selected: 1, version: 1 } } } })
  touch(join(s2, 'versions', 'sprite', 'a', 'walk_s', 'v1.png'))
  const s3 = await project('S3-stale', 'sprite', { sprite: { settings, sheets: [sheet('a')], review: { 'a:walk_s': { decision: 'approved', selected: 0, version: 1 } } } })
  touch(join(s3, 'versions', 'sprite', 'a', 'walk_s', 'v1.png'))
  touch(join(s3, 'versions', 'sprite', 'a', 'walk_s', 'v2.png'))
  touch(join(s3, 'versions', 'sprite', 'a', 'walk_s', 'v2.json'))
  touch(join(s3, 'versions', 'sprite', 'a', 'walk_e', 'v1.png'))
  const s4 = await project('S4-exported', 'sprite', { sprite: { settings, sheets: [sheet('a')], review: { 'a:walk_w': { decision: 'approved', selected: 1 } }, lastExport: { at: 1700000000000, sheets: 1, frames: 4 } } })
  touch(join(s4, 'versions', 'sprite', 'a', 'walk_w', 'v1.png'))

  const atlas = { path: join(base, 'hero.atlas'), hash: 'atlas-v2' }
  const pages = { 'hero.png': { path: join(base, 'hero.png'), hash: 'page-v2' } }
  const sig = createHash('sha1').update(['atlas-v2', 'page-v2'].join('|')).digest('hex').slice(0, 10)
  const p1 = await project('P1-reimport', 'spine', { spine: { atlas, pages } })
  touch(join(p1, '.cache', 'spine', '0000000000', 'board.png'), Date.now())
  touch(join(p1, '.cache', 'spine', sig, 'board.png'), Date.now() - 60_000)
  touch(join(p1, '.cache', 'spine', 'zzzzzzzzzz', 'board.png'), Date.now() - 30_000)
  const p2 = await project('P2-nosig', 'spine', { spine: {} })
  touch(join(p2, '.cache', 'spine', 'aaaaaaaaaa', 'board.png'), Date.now() - 60_000)
  touch(join(p2, '.cache', 'spine', 'bbbbbbbbbb', 'board.png'), Date.now())
  mkdirSync(join(p2, '.cache', 'spine', 'cccccccccc'), { recursive: true })
  const p3 = await project('P3-staleSig', 'spine', { spine: { atlas, pages } })
  touch(join(p3, '.cache', 'spine', 'aaaaaaaaaa', 'board.png'), Date.now() - 60_000)
  touch(join(p3, '.cache', 'spine', 'bbbbbbbbbb', 'board.png'), Date.now())
  await project('P4-nocache', 'spine', { spine: { atlas, pages } })
  const real = await project('P5-real', 'spine', {})
  const spine = new SpineService({
    projectDir: () => real,
    run: (fn) => fn(),
    allow: () => undefined,
    log: () => undefined,
    readProject,
    writeProject,
    enqueue: () => (specs) => specs.map(() => 'j'),
    template: async () => null
  })
  await spine.importPaths('P5-real', [join(resolve(__dirname, '..'), 'resources/spine-samples/hero/hero.json')])
  await spine.open('P5-real')
  const realSig = readdirSync(join(real, '.cache', 'spine')).find((d) => existsSync(join(real, '.cache', 'spine', d, 'board.png'))) ?? ''
  touch(join(real, '.cache', 'spine', '0000000000', 'board.png'), Date.now() + 60_000)

  const ws = new WorkspaceService(() => undefined)
  await ws.setRoot(join(base, 'ws'))
  const by = new Map<string, ProjectSummary>(ws.snapshot().projects.map((p) => [p.name, p]))
  await ws.dispose()

  const e0 = by.get('S0-empty')
  check(e0?.status === 'new' && e0.strips?.total === 0, `sprite without sheets → new (${e0?.status})`)
  const e1 = by.get('S1-fresh')
  check(e1?.status === 'draft' && e1.strips?.total === 2 && e1.strips.generated === 0 && e1.approved === 0, `fresh sheet → draft, mirror strip not counted (${JSON.stringify(e1?.strips)})`)
  const e2 = by.get('S2-gen')
  check(e2?.status === 'review' && e2.strips?.generated === 1 && e2.strips.approved === 1 && e2.approved === 1, `version without json + approved → review 1/1 (${e2?.status} ${JSON.stringify(e2?.strips)})`)
  const e3 = by.get('S3-stale')
  check(e3?.status === 'review' && e3.strips?.generated === 1 && e3.strips.approved === 0, `approval on older version not counted, mirror dir ignored (${JSON.stringify(e3?.strips)})`)
  const e4 = by.get('S4-exported')
  check(e4?.status === 'exported' && e4.exported === 1 && e4.exportedAt === 1700000000000 && e4.approved === 1, `sprite lastExport → exported (${e4?.status} ${e4?.exported})`)

  const thumbDir = (n: string): string | null => {
    const t = by.get(n)?.thumbs[0]
    return t ? decodeUrl(t) : null
  }
  check(thumbDir('P1-reimport')?.includes(sig) === true, `spine thumb uses current sig over newer stale dirs (${thumbDir('P1-reimport')})`)
  check(thumbDir('P2-nosig')?.includes('bbbbbbbbbb') === true, `spine without sig → newest board (${thumbDir('P2-nosig')})`)
  check(thumbDir('P3-staleSig')?.includes('bbbbbbbbbb') === true, `spine sig dir missing → newest board (${thumbDir('P3-staleSig')})`)
  check(!!realSig && thumbDir('P5-real')?.includes(realSig) === true, `sig matches SpineService cache dir (${realSig})`)
  check(by.get('P4-nocache')?.thumbs.length === 0, 'spine without .cache → no thumb')
  check(/\?v=/.test(by.get('P1-reimport')?.thumbs[0] ?? ''), 'spine thumb url versioned')

  await coverChecks(settings)

  rmSync(base, { recursive: true, force: true })
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
}

void main()
