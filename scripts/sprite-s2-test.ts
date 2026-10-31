import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import type { JobSpec, QueueJob } from '../src/shared/queue'
import type { TurnResult } from '../src/main/codex/service'
import { flushSpriteCovers, SpriteService } from '../src/main/sprite/service'
import { sheetCoverPath } from '../src/main/sprite/strips'
import { runStripJob } from '../src/main/sprite/stripJob'
import { readProject, writeProject, emptyProject } from '../src/main/workspace/project'
import { pickChroma } from '../src/main/pipeline/chroma'
import { createImage, decode } from '../src/main/pipeline/image'
import { overflowCheck, staticCheck, trimBox, isTrimmed, mirrorNeedsCheck } from '../src/main/sprite/strip'
import type { FrameRect } from '../src/shared/sprite'
import type { RawImage } from '../src/main/pipeline/types'
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

function paint(img: RawImage, x: number, y: number, bw: number, bh: number): RawImage {
  for (let yy = y; yy < y + bh; yy++) for (let xx = x; xx < x + bw; xx++) img.data.set([200, 80, 40, 255], (yy * img.width + xx) * 4)
  return img
}

function blob(w: number, h: number, x: number, y: number, bw: number, bh: number): RawImage {
  return paint(createImage(w, h), x, y, bw, bh)
}

async function dataUrlSize(url: string | null): Promise<{ w: number; h: number; buf: Buffer | null }> {
  if (!url || !url.startsWith('data:image/png;base64,')) return { w: 0, h: 0, buf: null }
  const buf = Buffer.from(url.slice(22), 'base64')
  const m = await sharp(buf).metadata()
  return { w: m.width ?? 0, h: m.height ?? 0, buf }
}

function unitChecks(): void {
  const trim = trimBox({ name: 'f', x: 0, y: 0, w: 20, h: 30, rotated: false, trimmed: true, srcX: 10, srcY: 5, srcW: 64, srcH: 64, pivotX: 0.5, pivotY: 1 })
  check(trim.x === 10 && trim.y === 5 && trim.width === 20 && trim.height === 30, 'trimBox upright rect')
  const rot = trimBox({ name: 'f', x: 0, y: 0, w: 30, h: 20, rotated: true, trimmed: true, srcX: 10, srcY: 5, srcW: 64, srcH: 64, pivotX: 0.5, pivotY: 1 })
  check(rot.width === 20 && rot.height === 30, 'trimBox rotated swaps w/h')
  check(!isTrimmed({ name: 'f', x: 0, y: 0, w: 64, h: 64, rotated: false, trimmed: false, srcX: 0, srcY: 0, srcW: 64, srcH: 64, pivotX: 0.5, pivotY: 1 }), 'full frame not trimmed')
  const inside = blob(64, 64, 10, 5, 20, 30)
  const little = blob(64, 64, 10, 6, 20, 30)
  const lot = blob(64, 64, 4, 6, 30, 28)
  const ok = overflowCheck([inside], [trim], [])
  check(ok.id === 'overflow' && ok.status === 'pass' && ok.value === 0, `overflow pass inside trim (${ok.value})`)
  const w = overflowCheck([inside, little], [trim, trim], [])
  check(w.status === 'warn' && w.frames.join() === '1' && w.value > 0.5 && w.value <= 5, `overflow warn small spill (${w.value}%)`)
  const f = overflowCheck([inside, lot], [trim, trim], [])
  check(f.status === 'fail' && f.frames.join() === '1' && f.value > 5, `overflow fail big spill (${f.value}%)`)
  check(overflowCheck([lot], [trim], [0]).status === 'pass', 'overflow skips missing frames')
  const rect = (x: number, y: number, w: number, h: number, rotated = false, srcW = 64, srcH = 64): FrameRect => ({ name: 'f', x: 0, y: 0, w: rotated ? h : w, h: rotated ? w : h, rotated, trimmed: true, srcX: x, srcY: y, srcW, srcH, pivotX: 0.5, pivotY: 1 })
  const full = rect(0, 0, 64, 64)
  const left = blob(64, 64, 4, 10, 20, 40)
  const mFit = overflowCheck([left], [], [], [{ dir: 'E', frames: [rect(40, 10, 20, 40)] }])
  check(mFit.status === 'pass' && mFit.value === 0 && /E mirror/.test(mFit.message), `mirror pass when flipped frame fits mirror trim (${mFit.message})`)
  const mBad = overflowCheck([left, left], [], [], [{ dir: 'E', frames: [rect(40, 10, 20, 40), rect(36, 10, 20, 40)] }])
  check(mBad.status === 'fail' && mBad.frames.join() === '1' && /^E \(mirror\): 1 frame/.test(mBad.message), `mirror overflow reported on mirror trim (${mBad.message})`)
  check(overflowCheck([left], [], [], [{ dir: 'E', frames: [rect(4, 10, 20, 40)] }]).status === 'fail', 'mirror check flips the frame (unflipped rect fails)')
  check(overflowCheck([left], [], [], [{ dir: 'E', frames: [rect(40, 10, 20, 40, true)] }]).status === 'pass', 'mirror rotated rect uses upright trim')
  check(overflowCheck([left], [], [], [{ dir: 'E', frames: [rect(40, 10, 20, 40, false, 64, 54)] }]).status === 'fail', 'mirror smaller canvas bottom-aligns like export')
  const both = overflowCheck([left, left], [rect(4, 10, 20, 40), rect(4, 12, 20, 40)].map(trimBox), [], [{ dir: 'NE', frames: [rect(36, 10, 20, 40), rect(40, 10, 20, 40)] }])
  check(both.status === 'fail' && both.frames.join() === '0,1' && /exceed.*; NE \(mirror\)/.test(both.message), `source + mirror overflow merged in one check (${both.message})`)
  check(overflowCheck([left], [], [0], [{ dir: 'E', frames: [rect(36, 10, 20, 40)] }]).status === 'pass', 'mirror skips missing frames')
  check(!mirrorNeedsCheck({ dir: 'E', frames: [full, null] }, [full]) && mirrorNeedsCheck({ dir: 'E', frames: [rect(40, 10, 20, 40)] }, [full]) && mirrorNeedsCheck({ dir: 'E', frames: [rect(0, 0, 64, 60, false, 64, 60)] }, [full]), 'mirrorNeedsCheck: trimmed or resized mirror only')
  const a = blob(64, 64, 20, 10, 20, 50)
  const b = blob(64, 64, 24, 10, 20, 50)
  const still = staticCheck([a, a, a], 'walk', [])
  check(still.id === 'static' && still.status === 'warn' && still.frames.join() === '1,2' && still.value === 0, `static warn identical walk (${still.message})`)
  const moving = staticCheck([a, b, a], 'walk', [])
  check(moving.status === 'pass' && moving.value > 5, `static pass moving walk (${moving.value}%)`)
  const c = paint(blob(64, 64, 20, 10, 20, 50), 40, 30, 4, 8)
  check(staticCheck([a, c], 'walk', []).status === 'warn' && staticCheck([a, c], 'idle', []).status === 'pass', 'idle tolerates less motion than walk')
  check(staticCheck([a, a], 'walk', [], [a, a]).status === 'pass', 'static pass when original is static too')
  check(staticCheck([a, a], 'walk', [], [a, b]).status === 'warn', 'static warn when original moves')
  check(staticCheck([a], 'walk', []).status === 'pass', 'static pass single frame')
  check(staticCheck([a, createImage(64, 64), a], 'walk', [1]).frames.length === 0, 'static skips missing frames')
}

async function main(): Promise<void> {
  unitChecks()
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
  const tpId = view?.sheets.find((x) => /tp/.test(x.name))?.id as string
  const gridId = view?.sheets.find((x) => /grid/.test(x.name))?.id as string
  const pv0 = await dataUrlSize(await svc.previewSheet('Hero', tpId))
  const tpMeta = await sharp(join(samples, 'hero_4dir_tp.png')).metadata()
  check(pv0.w === tpMeta.width && pv0.h === tpMeta.height, `preview before gen = original size ${pv0.w}x${pv0.h}`)
  check((await svc.previewSheet('Hero', 'nope')) === null, 'preview unknown sheet -> null')
  const n = await svc.enqueue('Hero', [lock as string])
  check(n === 1 && queued[0].sprite?.lockImages.length === 0, 'lock strip enqueued without lock image')

  const runAll = async (): Promise<void> => {
    while (queued.length) {
      const spec = queued.shift() as JobSpec
      const job = { ...spec, id: 'x', attempt: 1, status: 'running', step: 'waiting', progress: '', error: null, result: null, createdAt: 0, startedAt: 0, finishedAt: null, notBefore: null } as QueueJob
      const r = await runStripJob(job, { codex, pipeline, log: () => undefined, model: 'm', effort: 'e', timeoutMs: 1000, signal: new AbortController().signal, onStep: () => undefined })
      const ids = r.qa.checks.map((c) => c.id)
      const own = spec.sprite?.frames ?? []
      const trimmed = own.some(isTrimmed) || (spec.sprite?.mirrors ?? []).some((mm) => mirrorNeedsCheck(mm, own))
      check(ids.includes('static') && ids.includes('overflow') === trimmed, `${spec.assetRelPath} static check, overflow ${trimmed ? 'on' : 'off'}`)
      const fails = r.qa.checks.filter((c) => c.status !== 'pass').map((c) => `${c.id}=${c.value}`)
      check(r.qa.pass && fails.length === 0, `${spec.assetRelPath} v${r.version} qa clean ${fails.join(' ')}`)
    }
  }
  await flushSpriteCovers(proj)
  check(!existsSync(sheetCoverPath(proj, tpId)) && !existsSync(sheetCoverPath(proj, gridId)), 'no cover before any strip is generated')
  await runAll()
  const lockSheet = view?.strips.find((s) => s.key === lock)?.sheetId as string
  const lockCover = sheetCoverPath(proj, lockSheet)
  const otherCover = sheetCoverPath(proj, lockSheet === tpId ? gridId : tpId)
  const cm = existsSync(lockCover) ? await sharp(lockCover).metadata() : null
  check(!!cm && Math.max(cm.width ?? 0, cm.height ?? 0) <= 512 && !existsSync(otherCover), `strip job writes cover of its sheet only, long side <= 512 (${cm?.width}x${cm?.height})`)
  const lockMtime = existsSync(lockCover) ? statSync(lockCover).mtimeMs : 0
  view = await svc.review('Hero', { [lock as string]: { decision: 'approved' } })
  await flushSpriteCovers(proj)
  check(statSync(lockCover).mtimeMs === lockMtime, 'approving the shown version keeps cover untouched')
  const rest = (view?.strips ?? []).filter((s) => s.key !== lock && !s.mirrorOf).map((s) => s.key)
  const m = await svc.enqueue('Hero', rest)
  check(m === rest.length && queued.every((q) => q.sprite?.lockImages.length === 1), `rest enqueued with lock image (${m})`)
  const withMirror = queued.filter((q) => q.sprite?.mirrors?.length).map((q) => `${q.sprite?.dir}->${q.sprite?.mirrors?.map((x) => x.dir).join('')}`)
  check(withMirror.sort().join() === 'NW->NE,SW->SE,W->E,W->E', `mirror rects passed with source spec (${withMirror.join()})`)
  await runAll()
  view = await svc.open('Hero')
  const patch: Record<string, { decision: 'approved' }> = {}
  for (const s of view?.strips ?? []) if (!s.mirrorOf) patch[s.key] = { decision: 'approved' }
  view = await svc.review('Hero', patch)
  check(view?.strips.every((s) => s.decision === 'approved'), 'all strips approved (mirrors follow source)')
  const pvLatest = await dataUrlSize(await svc.previewSheet('Hero', gridId))
  const gridMeta = await sharp(join(samples, 'hero_8dir_grid.png')).metadata()
  check(pvLatest.w === gridMeta.width && pvLatest.h === gridMeta.height, `preview with latest (unapproved) versions ${pvLatest.w}x${pvLatest.h}`)
  await flushSpriteCovers(proj)
  check([tpId, gridId].every((id) => existsSync(sheetCoverPath(proj, id))), 'every sheet with strips has a cover')
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
  for (const [id, name] of [[tpId, 'hero_4dir_tp.png'], [gridId, 'hero_8dir_grid.png']]) {
    const pv = await dataUrlSize(await svc.previewSheet('Hero', id))
    const exported = await decode(join(out, name))
    const prev = pv.buf ? await decode(pv.buf) : null
    check(!!prev && prev.width === exported.width && Buffer.compare(Buffer.from(prev.data), Buffer.from(exported.data)) === 0, `${name} preview identical to export once approved`)
  }
  check(!existsSync(join(proj, 'output')), 'preview writes no output files')
  const again = await svc.exportRun('Hero', out)
  check(again.ok && !!again.backupDir && existsSync(join(again.backupDir as string, 'hero_8dir_grid.png')), 'second export backs up previous files')
  console.log(`\n${passed} passed, ${failed} failed  (out: ${out})`)
  if (failed) process.exit(1)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
