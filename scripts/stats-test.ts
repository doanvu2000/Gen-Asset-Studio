import { EventEmitter } from 'node:events'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { QueueJob, QueueJobEvent } from '../src/shared/queue'
import type { StatsRecord } from '../src/shared/stats'
import { dayKey, summarize } from '../src/main/stats/aggregate'
import { attachStatsRecorder, parseLines, pruneStats, readRecords, statsFileName, toRecord } from '../src/main/stats/recorder'

let fails = 0
function check(cond: unknown, msg: string): void {
  if (!cond) fails++
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`)
}

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

function job(over: Partial<QueueJob> = {}): QueueJob {
  return {
    id: 'j1',
    projectPath: 'C:\\work\\Alpha',
    assetRelPath: 'ui/a.png',
    sourcePath: 'x',
    groupId: 'ui',
    stylePrompt: '',
    styleImages: [],
    attempt: 1,
    status: 'done',
    step: 'waiting',
    progress: '',
    error: null,
    result: { version: 1, versionPath: '', rawPath: '', metaPath: '', qa: { pass: true, checks: [] } },
    createdAt: 1,
    startedAt: 1000,
    finishedAt: 5000,
    notBefore: null,
    ...over
  }
}

function rec(over: Partial<StatsRecord> = {}): StatsRecord {
  return { ts: 0, id: 'r', project: 'C:\\work\\Alpha', asset: 'a', kind: 'asset', style: 'ui', status: 'done', attempt: 1, regen: false, qaPass: true, err: null, ms: 1, ...over }
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'gas-stats-'))
  const sdir = join(dir, 'stats')
  const q = new EventEmitter()
  attachStatsRecorder(q, sdir, (m) => console.log('log:', m))
  const emit = (j: QueueJob, type: QueueJobEvent['type'] = 'finished'): boolean => q.emit('job', { type, job: j } satisfies QueueJobEvent)

  check(!existsSync(sdir), 'no stats dir before first record')
  check((await readRecords(sdir, 0, Date.now())).length === 0, 'missing dir reads as empty')

  const t0 = new Date(2026, 0, 31, 23, 30).getTime()
  const t1 = new Date(2026, 1, 1, 0, 30).getTime()
  emit(job({ id: 'a', finishedAt: t0, startedAt: t0 - 4000 }))
  emit(job({ id: 'a', finishedAt: t0, startedAt: t0 - 4000 }))
  emit(job({ id: 'b', finishedAt: t1, startedAt: t1 - 4000, status: 'qaWarn', attempt: 2, note: 'fix', result: { version: 2, versionPath: '', rawPath: '', metaPath: '', qa: { pass: false, checks: [] } } }))
  emit(job({ id: 'c', finishedAt: t1, startedAt: t1 - 1000, status: 'error', error: { code: 'timeout', message: 'x' }, result: null, sprite: { sheetId: 's', animId: 'a', anim: 'idle', dir: null, view: 'side', frames: [], lockImages: [] } }))
  emit(job({ id: 'd', finishedAt: t1, startedAt: null, status: 'canceled', error: { code: 'canceled', message: '' }, result: null }))
  emit(job({ id: 'e', finishedAt: t1, startedAt: t1 - 50, status: 'canceled', error: { code: 'canceled', message: '' }, result: null }))
  emit(job({ id: 'f' }), 'started')
  await wait(600)

  const jan = readFileSync(join(sdir, statsFileName(t0)), 'utf8').trim().split('\n')
  const feb = readFileSync(join(sdir, statsFileName(t1)), 'utf8').trim().split('\n')
  check(jan.length === 1, 'duplicate finish event written once')
  check(feb.length === 3, 'canceled-before-start skipped, started-then-canceled kept, started event ignored')
  check(statsFileName(t0) === 'gen-2026-01.jsonl' && statsFileName(t1) === 'gen-2026-02.jsonl', 'month files by local time')
  const b = feb.map((l) => JSON.parse(l) as StatsRecord).find((r) => r.id === 'b')!
  check(b.regen && b.attempt === 2 && b.qaPass === false && b.kind === 'asset' && b.ms === 4000, 'record fields from job')
  check(toRecord(job({ sprite: { sheetId: '', animId: '', anim: '', dir: null, view: 'side', frames: [], lockImages: [] } }))?.kind === 'sprite', 'sprite kind')
  check(toRecord(job({ groupId: 'spine' }))?.kind === 'spine', 'spine kind')

  writeFileSync(join(sdir, 'gen-2026-02.jsonl'), `${feb.join('\n')}\n{broken\n\n{"ts":"x"}\n`)
  check(parseLines(readFileSync(join(sdir, 'gen-2026-02.jsonl'), 'utf8')).length === 3, 'corrupt lines skipped')

  const from = new Date(2026, 0, 30).getTime()
  const to = new Date(2026, 1, 2, 23).getTime()
  const all = await readRecords(sdir, from, to)
  check(all.length === 4, 'range across two months reads both files')
  const s = summarize(all, { from, to })
  check(s.total === 4 && s.done === 1 && s.qaWarn === 1 && s.errors === 1 && s.canceled === 1, 'status counts')
  check(s.firstTry === 1 && s.firstTryPass === 1 && s.regen === 1, 'first-try pass and regen counts')
  check(s.byDay.length === 4 && s.byDay[0]!.day === dayKey(from), 'day buckets cover range')
  check(s.byDay.find((d) => d.day === '2026-01-31')?.count === 1 && s.byDay.find((d) => d.day === '2026-02-01')?.count === 3, 'local-day bucketing')
  check(s.byProject.length === 1 && s.byProject[0]!.name === 'Alpha' && s.byProject[0]!.count === 4, 'project shows last path segment')
  check(s.errorCodes[0]?.code === 'timeout', 'error codes')
  check(s.byKind.map((g) => g.key).sort().join() === 'asset,sprite', 'by kind')
  check(summarize(all, { from, to, project: 'nope' }).total === 0, 'project filter')

  const many = Array.from({ length: 15 }, (_, i) => rec({ ts: 10, project: `/p/p${i}` }))
  check(summarize(many, { from: 0, to: 20 }).byProject.length === 10, 'project table capped at 10')

  mkdirSync(sdir, { recursive: true })
  const now = new Date(2026, 10, 2).getTime()
  for (const n of ['gen-2025-10.jsonl', 'gen-2025-11.jsonl', 'gen-2024-01.jsonl', 'other.txt']) writeFileSync(join(sdir, n), '')
  const removed = await pruneStats(sdir, now)
  check(removed === 2 && !existsSync(join(sdir, 'gen-2024-01.jsonl')) && !existsSync(join(sdir, 'gen-2025-10.jsonl')), 'prune removes files older than 12 months')
  check(existsSync(join(sdir, 'gen-2025-11.jsonl')) && existsSync(join(sdir, 'other.txt')), 'prune keeps recent and foreign files')

  const bad = new EventEmitter()
  const blocked = join(dir, 'file')
  writeFileSync(blocked, 'x')
  const logs: string[] = []
  attachStatsRecorder(bad, join(blocked, 'sub'), (m) => logs.push(m))
  bad.emit('job', { type: 'finished', job: job({ id: 'z' }) })
  await wait(200)
  check(logs.length === 1, 'write failure is logged, not thrown')

  rmSync(dir, { recursive: true, force: true })
  console.log(fails ? `\n${fails} FAILED` : '\nall ok')
  process.exit(fails ? 1 : 0)
}

void main()
