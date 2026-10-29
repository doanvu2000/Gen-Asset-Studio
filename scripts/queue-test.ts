import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import type { JobSpec, QueueJob } from '../src/shared/queue'
import type { RateLimits } from '../src/shared/types'
import { codexCurrentDir, codexHome } from '../src/main/paths'
import { CodexService, type TurnResult } from '../src/main/codex/service'
import type { CodexInstaller } from '../src/main/codex/installer'
import { PipelineClient } from '../src/main/pipeline/client'
import { JobQueue } from '../src/main/queue/JobQueue'
import type { CodexLike } from '../src/main/queue/GenJob'

const root = resolve(__dirname, '..')
const project = process.env['GAS_QUEUE_TEST_DIR'] || 'C:\\Users\\dauph\\AppData\\Local\\Temp\\gas-queue-test'
const source = join(root, 'spike/m0/in/btn_green.png')
const styleRef = join(root, 'resources/style-templates/candy-pop/preview-sm.png')
const template = JSON.parse(readFileSync(join(root, 'resources/style-templates/candy-pop/template.json'), 'utf8')) as { promptEn: string }
const realOnly = process.argv.includes('--real-only')
const offlineOnly = process.argv.includes('--offline-only')

const log = (m: string): void => console.log(`${new Date().toISOString().slice(11, 23)} ${m}`)

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`ASSERT: ${msg}`)
  log(`ok: ${msg}`)
}

function spec(asset: string, note?: string): JobSpec {
  return {
    projectPath: project,
    assetRelPath: asset,
    sourcePath: source,
    groupId: 'candy',
    stylePrompt: template.promptEn,
    styleImages: [styleRef],
    note,
    nineSlice: 'auto',
    edgeAnchored: 'auto'
  }
}

class FakeCodex {
  rateLimits: RateLimits | null = null
  calls = 0
  private listeners = new Map<string, Set<(...a: unknown[]) => void>>()
  on(ev: string, fn: (...a: unknown[]) => void): this {
    if (!this.listeners.has(ev)) this.listeners.set(ev, new Set())
    this.listeners.get(ev)?.add(fn)
    return this
  }
  off(ev: string, fn: (...a: unknown[]) => void): this {
    this.listeners.get(ev)?.delete(fn)
    return this
  }
  async interrupt(): Promise<void> {}
  async readRateLimits(): Promise<RateLimits> {
    this.rateLimits = {
      primary: { usedPercent: 40, windowDurationMins: 300, resetsAt: Math.floor(Date.now() / 1000) + 3600 },
      secondary: null,
      reachedType: null,
      planType: 'plus',
      updatedAt: Date.now()
    }
    return this.rateLimits
  }
  async generateImage(): Promise<TurnResult> {
    this.calls++
    return {
      threadId: 'fake',
      turnId: 'fake',
      status: 'completed',
      error: null,
      errorInfo: null,
      agentText: '',
      images: [
        {
          itemId: 'x',
          status: 'failed',
          savedPath: null,
          base64: null,
          revisedPrompt: null,
          failure: { type: 'usageLimitExceeded', limitId: 'codex', resetsAt: Math.floor(Date.now() / 1000) + 2 }
        }
      ],
      durationMs: 1
    }
  }
}

async function offlineTests(pipeline: PipelineClient): Promise<void> {
  const dir = join(project, 'offline')
  rmSync(dir, { recursive: true, force: true })
  mkdirSync(dir, { recursive: true })
  const statePath = join(dir, 'queue.json')
  const fake = new FakeCodex()
  const q = new JobQueue({ codex: fake as unknown as CodexLike, pipeline, log: (m) => log(`[fakeq] ${m}`), statePath, concurrency: 2, staggerMs: 100, maxAutoRetries: 0 })
  await q.load()
  let quotaEvents = 0
  q.on('quota', () => quotaEvents++)
  const [id] = q.enqueue([{ ...spec('quota/btn_green.png'), projectPath: dir }])
  await new Promise((r) => setTimeout(r, 1500))
  const s1 = q.snapshot()
  assert(s1.paused && s1.pauseReason === 'quota' && s1.quota?.resumeAt, 'quota failure pauses queue with resumeAt')
  assert(s1.jobs.find((j) => j.id === id)?.status === 'queued', 'quota-failed job goes back to queued')
  const callsAtPause = fake.calls
  await new Promise((r) => setTimeout(r, 9000))
  assert(quotaEvents >= 3, `countdown events emitted (${quotaEvents})`)
  assert(fake.calls > callsAtPause, 'queue auto-resumed after reset and retried the job')
  q.pause()
  await q.whenIdle()
  await q.dispose()

  const restored = JSON.parse(readFileSync(statePath, 'utf8')) as { jobs: QueueJob[] }
  restored.jobs.push({ ...restored.jobs[0], id: 'was-running', status: 'running', step: 'image', progress: 'waiting for image' })
  writeFileSync(statePath, JSON.stringify({ ...restored, paused: true, pauseReason: 'user', quota: null }))
  const q2 = new JobQueue({ codex: fake as unknown as CodexLike, pipeline, log: (m) => log(`[fakeq2] ${m}`), statePath })
  await q2.load()
  const r = q2.get('was-running')
  assert(r?.status === 'queued', 'running job restored as queued after restart')
  assert(q2.snapshot().paused, 'user pause persisted across restart')
  q2.cancelAll()
  assert(q2.snapshot().jobs.every((j) => j.status === 'canceled'), 'cancelAll cancels queued jobs')
  q2.retry('was-running')
  assert(q2.get('was-running')?.status === 'queued' && q2.get('was-running')?.attempt === 2, 'retry re-queues with attempt+1')
  q2.cancelAll()
  await q2.dispose()
}

async function checker(w: number, h: number): Promise<Buffer> {
  const s = 12
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><defs><pattern id="p" width="${s * 2}" height="${s * 2}" patternUnits="userSpaceOnUse"><rect width="${s * 2}" height="${s * 2}" fill="#fff"/><rect width="${s}" height="${s}" fill="#ccc"/><rect x="${s}" y="${s}" width="${s}" height="${s}" fill="#ccc"/></pattern></defs><rect width="${w}" height="${h}" fill="url(#p)"/></svg>`
  return sharp(Buffer.from(svg)).png().toBuffer()
}

async function tile(file: string, w: number, h: number): Promise<Buffer> {
  const img = await sharp(file).resize(w, h, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 }, kernel: 'nearest' }).png().toBuffer()
  const border = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" fill="none" stroke="#f00" stroke-width="1"/></svg>`
  return sharp(await checker(w, h))
    .composite([{ input: img }, { input: Buffer.from(border) }])
    .png()
    .toBuffer()
}

async function contactSheet(jobs: QueueJob[]): Promise<string> {
  const cellW = 512
  const cellH = 192
  const pad = 16
  const rows = jobs.filter((j) => j.result)
  const cols = 3
  const W = pad + cols * (cellW + pad)
  const H = pad + rows.length * (cellH + pad)
  const comps: sharp.OverlayOptions[] = []
  for (let r = 0; r < rows.length; r++) {
    const res = rows[r].result
    if (!res) continue
    const y = pad + r * (cellH + pad)
    const files = [source, res.rawPath, res.versionPath]
    for (let c = 0; c < cols; c++) {
      const fit = c === 1 ? { fit: 'contain' as const } : null
      const buf = fit
        ? await sharp(await checker(cellW, cellH))
            .composite([{ input: await sharp(files[c]).resize(cellW, cellH, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toBuffer() }])
            .png()
            .toBuffer()
        : await tile(files[c], cellW, cellH)
      comps.push({ input: buf, left: pad + c * (cellW + pad), top: y })
    }
  }
  const out = join(project, 'contact-sheet.png')
  await sharp({ create: { width: W, height: Math.max(H, 64), channels: 4, background: { r: 40, g: 40, b: 48, alpha: 1 } } })
    .composite(comps)
    .png()
    .toFile(out)
  return out
}

async function realTest(pipeline: PipelineClient): Promise<void> {
  const exe = join(codexCurrentDir, 'bin', 'codex.exe')
  assert(existsSync(exe), `codex.exe present at ${exe}`)
  log(`CODEX_HOME=${codexHome}`)
  const installer = { exePath: () => exe } as unknown as CodexInstaller
  const codex = new CodexService(installer, (m) => log(`[codex] ${m}`))
  await codex.ensureStarted()
  const acc = await codex.readAccount()
  assert(acc.loggedIn, `logged in (${acc.planType ?? '?'})`)
  const before = await codex.readRateLimits()
  log(`rate limits before: 5h ${before.primary?.usedPercent}% week ${before.secondary?.usedPercent}% reached=${before.reachedType}`)

  rmSync(join(project, 'versions'), { recursive: true, force: true })
  const statePath = join(project, 'queue.json')
  rmSync(statePath, { force: true })
  const q = new JobQueue({
    codex,
    pipeline,
    log: (m) => log(`[queue] ${m}`),
    statePath,
    concurrency: 2,
    staggerMs: 2000,
    maxAutoRetries: 0,
    genSettings: () => ({ model: 'gpt-6-luna', effort: 'medium' })
  })
  await q.load()
  q.on('job', (e: { type: string; job: QueueJob }) => log(`[job] ${e.type} ${e.job.assetRelPath} ${e.job.status} ${e.job.step} ${e.job.progress}`))
  q.enqueue([spec('ui/buttons/btn_green.png'), spec('ui/buttons/btn_play.png', 'Make it a bit more mint green, still a confirm button.')])
  await q.whenIdle()
  let snap = q.snapshot()
  const failed = snap.jobs.filter((j) => j.status === 'error')
  if (failed.length > 0) {
    log(`retrying 1 failed job: ${failed[0].error?.code} ${failed[0].error?.message}`)
    q.retry(failed[0].id)
    await new Promise((r) => setTimeout(r, 300))
    await q.whenIdle()
    snap = q.snapshot()
  }
  await q.flush()
  for (const j of snap.jobs) {
    log(`${j.assetRelPath}: ${j.status} attempt=${j.attempt} ${j.error ? `${j.error.code}: ${j.error.message}` : ''}`)
    if (j.result) {
      const meta = await sharp(j.result.versionPath).metadata()
      const rec = JSON.parse(readFileSync(j.result.metaPath, 'utf8')) as Record<string, unknown>
      log(`  v${j.result.version} ${meta.width}x${meta.height} alpha=${meta.hasAlpha} chroma=${(rec['chroma'] as { hex: string }).hex} thread=${String(rec['threadId'])}`)
      log(`  qa pass=${j.result.qa.pass} ${j.result.qa.checks.map((c) => `${c.id}:${c.status}=${c.value}`).join(' ')}`)
      log(`  timings ${JSON.stringify(rec['timings'])}`)
    }
  }
  const sheet = await contactSheet(snap.jobs)
  log(`contact sheet: ${sheet}`)
  const after = await codex.readRateLimits().catch(() => null)
  log(`rate limits after: 5h ${after?.primary?.usedPercent}% week ${after?.secondary?.usedPercent}%`)
  await q.dispose()
  await codex.stop()
}

async function main(): Promise<void> {
  mkdirSync(project, { recursive: true })
  const pipeline = new PipelineClient(resolve(root, 'src/main/pipeline/worker.ts'), { execArgv: ['--import', 'tsx'], size: 2 })
  try {
    if (!realOnly) await offlineTests(pipeline)
    if (!offlineOnly) await realTest(pipeline)
  } finally {
    await pipeline.close()
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
