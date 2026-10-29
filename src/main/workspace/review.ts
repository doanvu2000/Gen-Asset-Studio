import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { EdgeSide, QaSummary } from '@shared/queue'
import type { ReprocessOptions, ReviewDecision, ReviewEntry, ReviewPatch, VersionInfo } from '@shared/review'
import type { PipelineLike } from '../queue/GenJob'
import { releaseVersion, reserveVersion } from '../queue/GenJob'
import { fileUrl } from './protocol'

const SIDES: readonly EdgeSide[] = ['left', 'right', 'top', 'bottom']

export function sanitizeReview(raw: unknown, ids: Set<string>): Record<string, ReviewEntry> {
  const out: Record<string, ReviewEntry> = {}
  if (!raw || typeof raw !== 'object') return out
  for (const [id, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ids.has(id) || !v || typeof v !== 'object') continue
    const r = v as Record<string, unknown>
    const decision: ReviewDecision | null = r.decision === 'approved' || r.decision === 'rejected' ? r.decision : null
    const selected = typeof r.selected === 'number' && Number.isInteger(r.selected) && r.selected > 0 ? r.selected : null
    if (!decision && !selected) continue
    out[id] = { decision, selected, updatedAt: typeof r.updatedAt === 'number' ? r.updatedAt : 0 }
  }
  return out
}

export function applyReviewPatch(current: Record<string, ReviewEntry>, patch: ReviewPatch, ids: Set<string>): Record<string, ReviewEntry> {
  const next = { ...current }
  const now = Date.now()
  for (const [id, p] of Object.entries(patch)) {
    if (!ids.has(id)) continue
    if (p === null) {
      delete next[id]
      continue
    }
    const prev = next[id] ?? { decision: null, selected: null, updatedAt: 0 }
    const entry: ReviewEntry = { ...prev, updatedAt: now }
    if ('decision' in p) entry.decision = p.decision === 'approved' || p.decision === 'rejected' ? p.decision : null
    if ('selected' in p) entry.selected = typeof p.selected === 'number' && Number.isInteger(p.selected) && p.selected > 0 ? p.selected : null
    if (!entry.decision && !entry.selected) delete next[id]
    else next[id] = entry
  }
  return next
}

async function readJson(file: string): Promise<Record<string, unknown> | null> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

function toQa(v: unknown): QaSummary | null {
  if (!v || typeof v !== 'object') return null
  const q = v as Record<string, unknown>
  if (!Array.isArray(q.checks)) return null
  return {
    pass: q.pass === true,
    checks: q.checks
      .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
      .map((c) => ({
        id: String(c.id ?? ''),
        status: c.status === 'fail' ? 'fail' : c.status === 'warn' ? 'warn' : 'pass',
        value: typeof c.value === 'number' ? c.value : 0,
        threshold: typeof c.threshold === 'number' ? c.threshold : 0,
        message: typeof c.message === 'string' ? c.message : ''
      }))
  }
}

export async function readVersionQa(vdir: string, v: number): Promise<QaSummary | null> {
  const meta = await readJson(join(vdir, `v${v}.json`))
  return meta ? toQa(meta.qa) : null
}

export async function readVersions(vdir: string, versions: number[]): Promise<VersionInfo[]> {
  const out: VersionInfo[] = []
  for (const v of versions) {
    const meta = (await readJson(join(vdir, `v${v}.json`))) ?? {}
    const fit = (meta.fit ?? {}) as Record<string, unknown>
    const rawName = typeof meta.raw === 'string' ? meta.raw : `v${v}-raw.png`
    const anchored = Array.isArray(fit.edgeAnchored) ? fit.edgeAnchored.filter((s): s is EdgeSide => SIDES.includes(s as EdgeSide)) : []
    out.push({
      v,
      url: fileUrl(join(vdir, `v${v}.png`), `${v}-${typeof meta.createdAt === 'string' ? meta.createdAt : ''}`),
      createdAt: typeof meta.createdAt === 'string' ? meta.createdAt : null,
      note: typeof meta.note === 'string' && meta.note ? meta.note : null,
      qa: toQa(meta.qa),
      model: typeof meta.model === 'string' ? meta.model : null,
      effort: typeof meta.effort === 'string' ? meta.effort : null,
      reprocessOf: typeof meta.reprocessOf === 'number' ? meta.reprocessOf : null,
      nineSlice: fit.mode === 'nine-slice' ? true : fit.mode === 'uniform' ? false : null,
      edgeAnchored: anchored,
      hasRaw: existsSync(join(vdir, rawName))
    })
  }
  return out
}

export async function reprocessVersion(
  vdir: string,
  base: number,
  sourceAbs: string,
  assetRel: string,
  options: ReprocessOptions,
  pipeline: Pick<PipelineLike, 'processAsset'>
): Promise<{ version: number; qa: QaSummary }> {
  const meta = await readJson(join(vdir, `v${base}.json`))
  if (!meta) throw new Error(`v${base}.json not found`)
  const rawName = typeof meta.raw === 'string' ? meta.raw : `v${base}-raw.png`
  const rawPath = join(vdir, rawName)
  if (!existsSync(rawPath)) throw new Error(`${rawName} not found`)
  if (!existsSync(sourceAbs)) throw new Error('source file not found')
  const chroma = (meta.chroma as Record<string, unknown> | undefined)?.hex
  if (typeof chroma !== 'string') throw new Error('chroma color missing in version metadata')
  const nineSlice = options.nineSlice === 'auto' ? 'auto' : options.nineSlice === true
  const edgeAnchored = options.edgeAnchored === 'auto' ? 'auto' : options.edgeAnchored.filter((s) => SIDES.includes(s))
  const version = await reserveVersion(vdir)
  try {
    const started = Date.now()
    const processed = await pipeline.processAsset({
      ai: rawPath,
      original: sourceAbs,
      options: { chroma, fit: { nineSlice, edgeAnchored, name: assetRel } }
    })
    const qa: QaSummary = {
      pass: processed.qa.pass,
      checks: processed.qa.checks.map((c) => ({ id: c.id, status: c.status, value: c.value, threshold: c.threshold, message: c.message }))
    }
    await fs.writeFile(join(vdir, `v${version}.png`), processed.png1x)
    const record = {
      ...meta,
      version,
      createdAt: new Date().toISOString(),
      reprocessOf: base,
      raw: rawName,
      output: `v${version}.png`,
      processOptions: { nineSlice, edgeAnchored },
      fit: processed.debug.fit,
      background: processed.debug.background,
      qa,
      timings: { pipelineMs: Date.now() - started, pipelineSteps: processed.debug.timingsMs }
    }
    await fs.writeFile(join(vdir, `v${version}.json`), JSON.stringify(record, null, 2), 'utf8')
    return { version, qa }
  } finally {
    releaseVersion(vdir, version)
  }
}
