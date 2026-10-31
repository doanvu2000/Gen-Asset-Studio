import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import type { JobSpec, QueueJob } from '../src/shared/queue'
import type { TurnResult } from '../src/main/codex/service'
import { SpriteService } from '../src/main/sprite/service'
import { runStripJob } from '../src/main/sprite/stripJob'
import { readProject, writeProject, emptyProject } from '../src/main/workspace/project'
import { pickChroma } from '../src/main/pipeline/chroma'
import { decode } from '../src/main/pipeline/image'
import type { CodexLike, PipelineLike } from '../src/main/queue/GenJob'

const root = resolve(__dirname, '..')
const base = join(process.env['TEMP'] ?? '.', 'gas-s2-test')
const proj = join(base, 'Hero')
const samples = join(root, 'resources/sprite-samples')
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

async function fakeImage(src: string): Promise<string> {
  const meta = await sharp(src).metadata()
  const out = src.replace(/-src\.png$/, '-fake.png')
  await sharp({ create: { width: meta.width ?? 1, height: meta.height ?? 1, channels: 3, background: { r: 0, g: 255, b: 0 } } })
    .composite([{ input: src }])
    .png()
    .toBuffer()
    .then((b) => sharp(b).resize((meta.width ?? 1) * 3, (meta.height ?? 1) * 3, { kernel: 'lanczos3' }).png().toFile(out))
  return out
}

const codex = {
  rateLimits: null,
  on: () => codex,
  off: () => codex,
  interrupt: async () => undefined,
  readRateLimits: async () => null,
  generateImage: async (_t: unknown, _p: string, images: string[]): Promise<TurnResult> => {
    const path = await fakeImage(images[0])
    return { threadId: 't', turnId: 'u', status: 'completed', error: null, errorInfo: null, agentText: '', durationMs: 1, images: [{ itemId: 'i', status: 'completed', savedPath: path, base64: null, revisedPrompt: null, failure: null }] } as unknown as TurnResult
  }
} as unknown as CodexLike

const pipeline = {
  pickChroma: async (a: { source: string; styleRefs: string[] }) => {
    const c = await pickChroma(a.source, a.styleRefs)
    return { ...c, name: 'green', hex: '#00FF00', promptName: 'pure green' }
  }
} as unknown as PipelineLike

async function diff(a: string, b: string): Promise<{ mean: number; changed: number }> {
  const [x, y] = await Promise.all([decode(a), decode(b)])
  if (x.width !== y.width || x.height !== y.height) return { mean: 999, changed: 1 }
  let sum = 0
  let changed = 0
  for (let i = 0; i < x.data.length; i += 4) {
    const ax = x.data[i + 3] / 255
    const ay = y.data[i + 3] / 255
    let d = Math.abs(ax - ay) * 255
    for (let k = 0; k < 3; k++) d += Math.abs(x.data[i + k] * ax - y.data[i + k] * ay) / 3
    sum += d
    if (d > 60) changed++
  }
  return { mean: sum / (x.width * x.height), changed: changed / (x.width * x.height) }
}

async function main(): Promise<void> {
  rmSync(base, { recursive: true, force: true })
  mkdirSync(proj, { recursive: true })
  await writeProject(proj, emptyProject('Hero', 'sprite'))
  const queued: JobSpec[] = []
  const svc = new SpriteService({
    projectDir: () => proj,
    run: (fn) => fn(),
    allow: () => undefined,
    log: () => undefined,
    readProject,
    writeProject,
    enqueue: () => (specs) => {
      queued.push(...specs)
      return specs.map((_, i) => `j${i}`)
    },
    template: async () => null
  })
  const add = await svc.addPaths('Hero', [join(samples, 'hero_8dir_grid.png'), join(samples, 'hero_4dir_tp.json')])
  check(add.added === 2, `added 2 sheets (${add.added})`)
  let view = add.view
  check(!!view && view.strips.length === 12, `12 strips (${view?.strips.length})`)
  const mirrors = view?.strips.filter((s) => s.mirrorOf) ?? []
  check(mirrors.length === 4, `4 mirror strips (grid E/NE/SE + tp E) (${mirrors.map((m) => m.dir).join(',')})`)
  check(view?.strips.every((s) => !!s.origUrl), 'orig strips cached')
  const lock = view?.lockKey
  check(view?.strips.find((s) => s.key === lock)?.dir === 'S', `lock strip is S (${lock})`)
  check((await svc.enqueue('Hero', [lock as string])) === -1, 'enqueue refused until style locked')
  view = await svc.setStyle('Hero', { promptEn: 'candy style', locked: true })
  check(view?.style.locked === true, 'style locked')
  const n = await svc.enqueue('Hero', [lock as string])
  check(n === 1 && queued[0].sprite?.lockImages.length === 0, 'lock strip enqueued without lock image')

  const runAll = async (): Promise<void> => {
    while (queued.length) {
      const spec = queued.shift() as JobSpec
      const job = { ...spec, id: 'x', attempt: 1, status: 'running', step: 'waiting', progress: '', error: null, result: null, createdAt: 0, startedAt: 0, finishedAt: null, notBefore: null } as QueueJob
      const r = await runStripJob(job, { codex, pipeline, log: () => undefined, model: 'm', effort: 'e', timeoutMs: 1000, signal: new AbortController().signal, onStep: () => undefined })
      const fails = r.qa.checks.filter((c) => c.status !== 'pass').map((c) => `${c.id}=${c.value}`)
      check(r.qa.pass && fails.length === 0, `${spec.assetRelPath} v${r.version} qa clean ${fails.join(' ')}`)
    }
  }
  await runAll()
  view = await svc.review('Hero', { [lock as string]: { decision: 'approved' } })
  const rest = (view?.strips ?? []).filter((s) => s.key !== lock && !s.mirrorOf).map((s) => s.key)
  const m = await svc.enqueue('Hero', rest)
  check(m === rest.length && queued.every((q) => q.sprite?.lockImages.length === 1), `rest enqueued with lock image (${m})`)
  await runAll()
  view = await svc.open('Hero')
  const patch: Record<string, { decision: 'approved' }> = {}
  for (const s of view?.strips ?? []) if (!s.mirrorOf) patch[s.key] = { decision: 'approved' }
  view = await svc.review('Hero', patch)
  check(view?.strips.every((s) => s.decision === 'approved'), 'all strips approved (mirrors follow source)')
  const vers = await svc.versions('Hero', lock as string)
  check(vers.length === 1 && !!vers[0].qa, 'versions list with qa')

  const out = join(base, 'out')
  const bad = await svc.exportRun('Hero', samples)
  check(!bad.ok && bad.error === 'outIsSource', 'export into source folder refused')
  const res = await svc.exportRun('Hero', out)
  check(res.ok && res.sheets.length === 2, `exported ${res.sheets.length} sheets`)
  for (const s of res.sheets) {
    const orig = join(samples, s.name)
    const metaA = await sharp(orig).metadata()
    const metaB = await sharp(s.file).metadata()
    check(metaA.width === metaB.width && metaA.height === metaB.height, `${s.name} same size ${metaB.width}x${metaB.height}`)
    const d = await diff(orig, s.file)
    console.log(`       ${s.name}: frames ${s.frames} kept ${s.kept} atlas ${s.atlas} mean diff ${d.mean.toFixed(2)} changed ${(d.changed * 100).toFixed(2)}%`)
    check(d.mean < 10 && d.changed < 0.07, `${s.name} round-trip close to original`)
  }
  check(existsSync(join(out, 'hero_4dir_tp.json')), 'atlas copied next to sheet')
  const again = await svc.exportRun('Hero', out)
  check(again.ok && !!again.backupDir && existsSync(join(again.backupDir as string, 'hero_8dir_grid.png')), 'second export backs up previous files')
  console.log(`\n${passed} passed, ${failed} failed  (out: ${out})`)
  if (failed) process.exit(1)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
