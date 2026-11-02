import { appendFile, mkdir, readdir, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { QueueJob, QueueJobEvent } from '@shared/queue'
import type { StatsKind, StatsRecord } from '@shared/stats'

const FILE_RE = /^gen-(\d{4})-(\d{2})\.jsonl$/
const KEEP_MONTHS = 12
const SEEN_MAX = 5000

export interface StatsQueueLike {
  on(ev: 'job', fn: (e: QueueJobEvent) => void): unknown
}

export function statsFileName(ts: number): string {
  const d = new Date(ts)
  return `gen-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}.jsonl`
}

function kindOf(job: QueueJob): StatsKind {
  if (job.sprite) return 'sprite'
  return job.groupId === 'spine' ? 'spine' : 'asset'
}

// A cancel before the job started never reached Codex, so it is not a generation.
export function toRecord(job: QueueJob): StatsRecord | null {
  if (job.status === 'canceled' && job.startedAt === null) return null
  const ts = job.finishedAt ?? Date.now()
  return {
    ts,
    id: job.id,
    project: job.projectPath,
    asset: job.assetRelPath,
    kind: kindOf(job),
    style: job.groupId || '-',
    status: job.status,
    attempt: job.attempt,
    regen: Boolean(job.autoRegenOf || job.note),
    qaPass: job.result ? job.result.qa.pass : null,
    err: job.error?.code ?? null,
    ms: job.startedAt ? Math.max(0, ts - job.startedAt) : 0
  }
}

export function attachStatsRecorder(queue: StatsQueueLike, dir: string, log: (msg: string) => void): void {
  const seen = new Set<string>()
  queue.on('job', (e) => {
    if (e.type !== 'finished') return
    const rec = toRecord(e.job)
    if (!rec) return
    const key = `${rec.id}:${rec.attempt}:${rec.ts}`
    if (seen.has(key)) return
    seen.add(key)
    if (seen.size > SEEN_MAX) seen.delete(seen.values().next().value as string)
    void mkdir(dir, { recursive: true })
      .then(() => appendFile(join(dir, statsFileName(rec.ts)), `${JSON.stringify(rec)}\n`, 'utf8'))
      .catch((err: Error) => log(`stats write failed: ${err.message}`))
  })
}

function monthIndex(name: string): number | null {
  const m = FILE_RE.exec(name)
  return m ? Number(m[1]) * 12 + Number(m[2]) - 1 : null
}

export function parseLines(text: string): StatsRecord[] {
  const out: StatsRecord[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    try {
      const r = JSON.parse(line) as StatsRecord
      if (typeof r.ts === 'number' && typeof r.project === 'string' && typeof r.status === 'string') out.push(r)
    } catch {
      continue
    }
  }
  return out
}

async function listDir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}

export async function readRecords(dir: string, from: number, to: number): Promise<StatsRecord[]> {
  const a = new Date(from)
  const b = new Date(to)
  const lo = a.getFullYear() * 12 + a.getMonth()
  const hi = b.getFullYear() * 12 + b.getMonth()
  const out: StatsRecord[] = []
  for (const name of await listDir(dir)) {
    const m = monthIndex(name)
    if (m === null || m < lo || m > hi) continue
    try {
      out.push(...parseLines(await readFile(join(dir, name), 'utf8')))
    } catch {
      continue
    }
  }
  return out
}

export async function pruneStats(dir: string, now = Date.now()): Promise<number> {
  const d = new Date(now)
  const cutoff = d.getFullYear() * 12 + d.getMonth() - KEEP_MONTHS
  let n = 0
  for (const name of await listDir(dir)) {
    const m = monthIndex(name)
    if (m === null || m >= cutoff) continue
    try {
      await unlink(join(dir, name))
      n++
    } catch {
      continue
    }
  }
  return n
}
