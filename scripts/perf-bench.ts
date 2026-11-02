import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { WorkspaceService } from '../src/main/workspace/service'
import { addCollected, buildView, checkInputs, emptyProject, readProject, writeProject } from '../src/main/workspace/project'
import { TodoIndex } from '../src/main/workspace/todo'

const base = join(process.env['TEMP'] ?? '.', 'gas-perf-bench')
const BIG = Number(process.env['BENCH_ASSETS'] ?? 400)
const SMALL = Number(process.env['BENCH_PROJECTS'] ?? 30)
const rows: Array<[string, number]> = []

async function time<T>(label: string, fn: () => Promise<T>): Promise<T> {
  const t = performance.now()
  const r = await fn()
  rows.push([label, Math.round(performance.now() - t)])
  return r
}

async function png(file: string, size: number, seed: number): Promise<void> {
  const raw = Buffer.alloc(size * size * 4)
  for (let i = 0; i < raw.length; i += 4) {
    const x = (i / 4) % size
    const y = Math.floor(i / 4 / size)
    const inside = (x - size / 2) ** 2 + (y - size / 2) ** 2 < (size * 0.4) ** 2
    raw[i] = (x * 255) / size
    raw[i + 1] = (y * 255) / size
    raw[i + 2] = (seed * 37) % 255
    raw[i + 3] = inside ? 255 : 0
  }
  await sharp(raw, { raw: { width: size, height: size, channels: 4 } }).png().toFile(file)
}

async function build(): Promise<void> {
  rmSync(base, { recursive: true, force: true })
  const assets = join(base, 'assets')
  mkdirSync(assets, { recursive: true })
  const sizes = [256, 512, 768, 1024]
  const files: string[] = []
  for (let i = 0; i < BIG; i++) {
    const f = join(assets, `item_${String(i).padStart(4, '0')}.png`)
    await png(f, sizes[i % sizes.length], i)
    files.push(f)
  }
  const ws = join(base, 'ws')
  const bigDir = join(ws, 'Big')
  mkdirSync(bigDir, { recursive: true })
  const data = emptyProject('Big', 'reskin')
  await time(`import/analyze ${BIG} assets`, () => addCollected(data, { folders: [{ dir: assets, files }], files: [], skipped: [] }))
  await writeProject(bigDir, data)
  const small = join(base, 'small')
  mkdirSync(small, { recursive: true })
  const sf = join(small, 'a.png')
  await png(sf, 128, 1)
  for (let p = 0; p < SMALL; p++) {
    const dir = join(ws, `P${String(p).padStart(2, '0')}`)
    mkdirSync(dir, { recursive: true })
    const d = emptyProject(`P${p}`, 'reskin')
    await addCollected(d, { folders: [], files: [sf], skipped: [] })
    await writeProject(dir, d)
  }
  writeFileSync(join(base, 'README.txt'), 'perf-bench workspace')
}

async function main(): Promise<void> {
  await build()
  const root = join(base, 'ws')
  const ws = new WorkspaceService(() => undefined)
  await time(`workspace scan (1 big + ${SMALL} small), cold`, () => ws.setRoot(root))
  await time('workspace rescan, thumbs absent for big', () => ws.rescan())
  const bigDir = join(root, 'Big')
  const data = await time('readProject (big)', () => readProject(bigDir))
  const { checked } = await time('checkInputs (big)', () => checkInputs(data))
  await time('buildView 1st (generates thumbs)', () => buildView(bigDir, 'Big', data, checked))
  await time('buildView 2nd (cached thumbs)', () => buildView(bigDir, 'Big', data, checked))
  await time('ws.open 1st-after-cache', async () => ws.open('Big'))
  await time('workspace rescan, cards with thumbs', () => ws.rescan())
  const todo = new TodoIndex()
  const projects = ws.snapshot().projects
  await time('todo collect cold', () => todo.collect(root, projects, []))
  await time('todo collect warm', () => todo.collect(root, projects, []))
  const pad = Math.max(...rows.map((r) => r[0].length))
  for (const [l, ms] of rows) console.log(`${l.padEnd(pad)}  ${String(ms).padStart(7)} ms`)
  await ws.dispose()
  rmSync(base, { recursive: true, force: true })
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
