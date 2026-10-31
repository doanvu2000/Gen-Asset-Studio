import { existsSync, mkdirSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { join, resolve } from 'node:path'
import { SpineService } from '../src/main/spine/service'
import { WorkspaceService } from '../src/main/workspace/service'
import { emptyProject, readProject, writeProject, type ProjectFile } from '../src/main/workspace/project'
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

  rmSync(base, { recursive: true, force: true })
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
}

void main()
