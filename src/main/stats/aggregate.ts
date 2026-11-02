import type { StatsDay, StatsGroup, StatsQuery, StatsRecord, StatsSummary } from '@shared/stats'

const TOP_PROJECTS = 10

export function dayKey(ts: number): string {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function projectName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}

function isRegen(r: StatsRecord): boolean {
  return r.regen || r.attempt > 1
}

function isFirstTry(r: StatsRecord): boolean {
  return !isRegen(r) && r.qaPass !== null
}

function groupBy(records: StatsRecord[], key: (r: StatsRecord) => string, name: (k: string) => string): StatsGroup[] {
  const map = new Map<string, StatsGroup>()
  for (const r of records) {
    const k = key(r)
    let g = map.get(k)
    if (!g) {
      g = { key: k, name: name(k), count: 0, firstTry: 0, firstTryPass: 0, regen: 0, errors: 0 }
      map.set(k, g)
    }
    g.count++
    if (isRegen(r)) g.regen++
    if (r.status === 'error') g.errors++
    if (isFirstTry(r)) {
      g.firstTry++
      if (r.qaPass) g.firstTryPass++
    }
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
}

function dayRange(from: number, to: number): string[] {
  const out: string[] = []
  const d = new Date(from)
  d.setHours(12, 0, 0, 0)
  const end = dayKey(to)
  for (let i = 0; i < 400; i++) {
    const k = dayKey(d.getTime())
    out.push(k)
    if (k >= end) break
    d.setDate(d.getDate() + 1)
  }
  return out
}

export function summarize(all: StatsRecord[], q: StatsQuery): StatsSummary {
  const records = all.filter((r) => r.ts >= q.from && r.ts <= q.to && (!q.project || r.project === q.project))
  const days = new Map<string, StatsDay>(dayRange(q.from, q.to).map((day) => [day, { day, count: 0, errors: 0 }]))
  const codes = new Map<string, number>()
  const s: StatsSummary = {
    from: q.from,
    to: q.to,
    total: records.length,
    done: 0,
    qaWarn: 0,
    errors: 0,
    canceled: 0,
    firstTry: 0,
    firstTryPass: 0,
    regen: 0,
    byDay: [],
    byProject: [],
    byKind: [],
    byStyle: [],
    errorCodes: []
  }
  for (const r of records) {
    if (r.status === 'done') s.done++
    else if (r.status === 'qaWarn') s.qaWarn++
    else if (r.status === 'error') s.errors++
    else if (r.status === 'canceled') s.canceled++
    if (isRegen(r)) s.regen++
    if (isFirstTry(r)) {
      s.firstTry++
      if (r.qaPass) s.firstTryPass++
    }
    if (r.err && r.status === 'error') codes.set(r.err, (codes.get(r.err) ?? 0) + 1)
    const d = days.get(dayKey(r.ts))
    if (d) {
      d.count++
      if (r.status === 'error') d.errors++
    }
  }
  s.byDay = [...days.values()]
  s.byProject = groupBy(records, (r) => r.project, projectName).slice(0, TOP_PROJECTS)
  s.byKind = groupBy(records, (r) => r.kind, (k) => k)
  s.byStyle = groupBy(records, (r) => r.style, (k) => k)
  s.errorCodes = [...codes].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count)
  return s
}
