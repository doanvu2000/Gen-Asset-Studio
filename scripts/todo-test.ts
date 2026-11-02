import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { parseSpineAtlas } from '../src/main/spine/atlas'
import { WorkspaceService } from '../src/main/workspace/service'
import { emptyProject, writeProject, type ProjectFile } from '../src/main/workspace/project'
import type { QueueJob } from '../src/shared/queue'
import type { TodoItem } from '../src/shared/workspace'

const base = join(process.env['TEMP'] ?? '.', 'gas-todo-test')
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

function put(p: string, body: string | object = 'x'): void {
  mkdirSync(join(p, '..'), { recursive: true })
  writeFileSync(p, typeof body === 'string' ? body : JSON.stringify(body))
}

async function project(name: string, kind: 'reskin' | 'sprite' | 'spine', extra: Record<string, unknown>): Promise<string> {
  const dir = join(base, 'ws', name)
  mkdirSync(dir, { recursive: true })
  await writeProject(dir, { ...emptyProject(name, kind), ...extra } as ProjectFile)
  return dir
}

const input = (id: string, rel: string): Record<string, unknown> => ({ id, root: 0, rel, w: 8, h: 8, alpha: true, size: 1, mtime: 1, hash: `h-${id}`, type: 'normal', kind: 'icon' })
const frame = (x: number): Record<string, unknown> => ({ name: `f${x}`, x: x * 64, y: 0, w: 64, h: 64 })
const sheet = (id: string): Record<string, unknown> => ({
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
})
const warn = { pass: true, checks: [{ id: 'edge', status: 'warn', value: 1, threshold: 0, message: 'm' }] }
const job = (projectPath: string, status: string, extra: Partial<QueueJob> = {}): QueueJob =>
  ({ id: Math.random().toString(36), projectPath, assetRelPath: 'icons/a.png', status, createdAt: 1, finishedAt: 5, ...extra }) as unknown as QueueJob

const find = (items: TodoItem[], rel: string, area: string, variantId?: string): TodoItem | undefined =>
  items.find((i) => i.projectRel === rel && i.area === area && (i.target.variantId ?? '') === (variantId ?? ''))
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

async function main(): Promise<void> {
  rmSync(base, { recursive: true, force: true })
  const T = Date.UTC(2026, 0, 1)

  const re = await project('R1', 'reskin', {
    roots: [join(base, 'src')],
    inputs: ['a', 'b', 'c', 'd', 'e'].map((n) => input(n, `${n}.png`)),
    review: {
      b: { decision: 'approved', selected: 2, updatedAt: T + 1000 },
      c: { decision: 'approved', selected: 1, updatedAt: T - 1000 },
      d: { decision: 'rejected', selected: 1, updatedAt: T }
    },
    export: { outDir: '', last: { at: new Date(T).toISOString(), assets: 1, files: 1, outDir: '' } }
  })
  put(join(re, 'versions', 'a', 'v1.png'))
  put(join(re, 'versions', 'a', 'v1.json'), { qa: warn })
  for (const n of ['b', 'c', 'd']) put(join(re, 'versions', n, 'v1.png'))
  put(join(re, 'versions', 'b', 'v2.png'))

  const sp = await project('S1', 'sprite', {
    sprite: {
      settings: { dirSet: 4, mirror: true },
      sheets: [sheet('a')],
      review: { 'a:walk_w': { decision: 'approved', selected: 1 } },
      lastExport: { at: 1700000000000, sheets: 1, frames: 4 }
    }
  })
  put(join(sp, 'versions', 'sprite', 'a', 'walk_s', 'v1.png'))
  put(join(sp, 'versions', 'sprite', 'a', 'walk_s', 'v1.json'), { stripQa: { pass: false, checks: [{ id: 'clipped', status: 'fail', value: 1, threshold: 0, frames: [0], message: 'm' }] } })
  put(join(sp, 'versions', 'sprite', 'a', 'walk_w', 'v1.png'))
  put(join(sp, 'versions', 'sprite', 'a', 'walk_e', 'v1.png'))

  const atlas = join(resolve(__dirname, '..'), 'resources/spine-samples/hero/hero.atlas')
  const names = parseSpineAtlas(readFileSync(atlas, 'utf8')).regions.map((r) => r.name)
  const pn = await project('P1', 'spine', {
    spine: {
      atlas: { path: atlas, hash: 'x' },
      review: { [names[1]]: { decision: 'approved', selected: 1, version: 1 } },
      variants: [{ id: 'red', name: 'Red', review: {} }]
    }
  })
  put(join(pn, 'versions', 'spine', names[0], 'v1.png'))
  put(join(pn, 'versions', 'spine', names[1], 'v1.png'))
  put(join(pn, 'versions', 'spine-red', names[0], 'v1.png'))

  const broken = join(base, 'ws', 'Broken')
  mkdirSync(broken, { recursive: true })
  writeFileSync(join(broken, 'project.json'), '{bad')
  await project('Empty', 'reskin', {})

  const ws = new WorkspaceService(() => undefined)
  await ws.setRoot(join(base, 'ws'))
  const jobs = [job(re, 'error'), job(re, 'error', { finishedAt: 9 }), job(re, 'done'), job(join(base, 'elsewhere'), 'error')]
  let items = await ws.todo(jobs)

  const r1 = (a: string): TodoItem | undefined => find(items, 'R1', a)
  check(r1('review')?.count === 1 && r1('review')?.target.assetId === 'a', `reskin: only undecided counts for review (${r1('review')?.count})`)
  check(r1('qa')?.count === 1 && r1('qa')?.target.assetId === 'a', 'reskin: qa warn on selected version')
  check(r1('export')?.count === 1 && r1('export')?.target.assetId === 'b', `reskin: approved after last export only (${r1('export')?.count})`)
  check(r1('queue')?.count === 2 && r1('queue')?.updatedAt === 9, 'reskin: error jobs counted per project, other statuses and foreign projects ignored')

  const s1 = (a: string): TodoItem | undefined => find(items, 'S1', a)
  check(s1('review')?.count === 1 && s1('review')?.target.stripKey === 'a:walk_s', 'sprite: pending strip, mirror strip ignored')
  check(s1('qa')?.count === 1, 'sprite: stripQa fail')
  check(s1('export')?.count === 1 && s1('export')?.target.stripKey === 'a:walk_w', 'sprite: approved version newer than lastExport')

  const p1 = (a: string, v?: string): TodoItem | undefined => find(items, 'P1', a, v)
  check(p1('review')?.target.region === names[0] && p1('review')?.count === 1, 'spine: base region pending')
  check(p1('export')?.target.region === names[1] && p1('export')?.count === 1, 'spine: approved, never exported')
  check(p1('review', 'red')?.count === 1 && p1('review', 'red')?.label.includes('Red'), 'spine: skin variant has its own row with variantId')

  check(!items.some((i) => i.projectRel === 'Broken' || i.projectRel === 'Empty'), 'broken project.json and empty project skipped without crash')

  put(join(re, 'versions', 'e', 'v1.png'))
  put(join(re, 'versions', 'b', 'v3.png'))
  await sleep(40)
  await ws.rescan()
  items = await ws.todo([])
  check(r1('review')?.count === 2, `new version appears after rescan (cache invalidated, ${r1('review')?.count})`)
  check(!r1('queue'), 'no jobs → no queue row')

  rmSync(join(re, 'versions', 'a'), { recursive: true, force: true })
  await ws.rescan()
  items = await ws.todo([])
  check(r1('review')?.count === 1 && !r1('qa'), 'deleted versions drop out')

  await ws.setRoot(null)
  check((await ws.todo(jobs)).length === 0, 'no workspace → empty list')
  const empty = join(base, 'empty-ws')
  mkdirSync(empty, { recursive: true })
  await ws.setRoot(empty)
  check((await ws.todo(jobs)).length === 0, 'empty workspace → empty list')
  await ws.dispose()

  rmSync(base, { recursive: true, force: true })
  console.log(`\n${passed} passed, ${failed} failed`)
  if (failed) process.exit(1)
}

void main()
