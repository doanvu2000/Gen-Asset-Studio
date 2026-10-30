import { EventEmitter } from 'node:events'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import {
  QUEUE_DEFAULT_CONCURRENCY,
  QUEUE_MAX_CONCURRENCY,
  QUEUE_MIN_CONCURRENCY,
  type JobSpec,
  type JobStatus,
  type JobStep,
  type QueueJob,
  type QueueJobEvent,
  type QueuePauseReason,
  type QueueSnapshot,
  type QuotaPause
} from '@shared/queue'
import type { RateLimits } from '@shared/types'
import type { LogFn } from '../logger'
import { JobFailure, runGenJob, type CodexLike, type PipelineLike } from './GenJob'

export interface GenSettings {
  model?: string
  effort?: string
}

export interface JobQueueOptions {
  codex: CodexLike
  pipeline: PipelineLike
  log: LogFn
  statePath: string
  genSettings?: () => GenSettings
  concurrency?: number
  staggerMs?: number
  timeoutMs?: number
  maxAutoRetries?: number
  emitThrottleMs?: number
  maxFinished?: number
}

interface PersistedState {
  version: 1
  concurrency: number
  paused: boolean
  pauseReason: QueuePauseReason
  quota: { resumeAt: number | null; reason: string } | null
  jobs: QueueJob[]
}

const DEFAULT_MODEL = 'gpt-6-luna'
const DEFAULT_EFFORT = 'medium'
const ACTIVE: readonly JobStatus[] = ['running', 'processing']
const FINISHED: readonly JobStatus[] = ['done', 'qaWarn', 'error', 'canceled']
const QUOTA_BUFFER_MS = 5000
const QUOTA_FALLBACK_MS = 5 * 60 * 1000
const NO_IMAGE_STREAK_LIMIT = 3
const QUOTA_RECHECK_MS = 60 * 1000

function clampConcurrency(n: number): number {
  if (!Number.isFinite(n)) return QUEUE_DEFAULT_CONCURRENCY
  return Math.max(QUEUE_MIN_CONCURRENCY, Math.min(QUEUE_MAX_CONCURRENCY, Math.round(n)))
}

function exhausted(rl: RateLimits | null): boolean {
  if (!rl) return false
  if (rl.reachedType) return true
  return (rl.primary?.usedPercent ?? 0) >= 100 || (rl.secondary?.usedPercent ?? 0) >= 100
}

function resumeAtFrom(rl: RateLimits | null, resetsAtSec: number | null): number | null {
  const candidates: number[] = []
  if (resetsAtSec) candidates.push(resetsAtSec * 1000)
  if (rl) {
    for (const w of [rl.primary, rl.secondary]) {
      if (w && w.usedPercent >= 100 && w.resetsAt) candidates.push(w.resetsAt * 1000)
    }
    if (candidates.length === 0 && rl.reachedType && rl.primary?.resetsAt) candidates.push(rl.primary.resetsAt * 1000)
  }
  if (candidates.length === 0) return null
  return Math.max(...candidates)
}

function sanitizeJob(raw: unknown): QueueJob | null {
  if (!raw || typeof raw !== 'object') return null
  const j = raw as QueueJob
  if (typeof j.id !== 'string' || typeof j.projectPath !== 'string' || typeof j.assetRelPath !== 'string' || typeof j.sourcePath !== 'string') {
    return null
  }
  const job: QueueJob = {
    ...j,
    groupId: typeof j.groupId === 'string' ? j.groupId : '',
    stylePrompt: typeof j.stylePrompt === 'string' ? j.stylePrompt : '',
    styleImages: Array.isArray(j.styleImages) ? j.styleImages.filter((s) => typeof s === 'string') : [],
    attempt: typeof j.attempt === 'number' ? j.attempt : 1,
    step: j.step ?? 'waiting',
    progress: typeof j.progress === 'string' ? j.progress : '',
    error: j.error ?? null,
    result: j.result ?? null,
    createdAt: typeof j.createdAt === 'number' ? j.createdAt : Date.now(),
    startedAt: j.startedAt ?? null,
    finishedAt: j.finishedAt ?? null,
    notBefore: null
  }
  if (ACTIVE.includes(job.status)) {
    job.status = 'queued'
    job.step = 'waiting'
    job.progress = 'restored after restart'
    job.startedAt = null
  }
  return job
}

export class JobQueue extends EventEmitter {
  private jobs: QueueJob[] = []
  private concurrency: number
  private paused = false
  private pauseReason: QueuePauseReason = null
  private quota: { resumeAt: number | null; reason: string } | null = null
  private pauseDetail: string | null = null
  private noImageStreak = 0
  private readonly active = new Map<string, AbortController>()
  private readonly autoRetries = new Map<string, number>()
  private lastStart = 0
  private pumpTimer: NodeJS.Timeout | null = null
  private resumeTimer: NodeJS.Timeout | null = null
  private countdownTimer: NodeJS.Timeout | null = null
  private emitTimer: NodeJS.Timeout | null = null
  private lastEmit = 0
  private saveTimer: NodeJS.Timeout | null = null
  private saving: Promise<void> = Promise.resolve()
  private shuttingDown = false
  private readonly onRateLimits = (rl: RateLimits): void => this.handleRateLimits(rl)

  constructor(private readonly opts: JobQueueOptions) {
    super()
    this.setMaxListeners(100)
    this.concurrency = clampConcurrency(opts.concurrency ?? QUEUE_DEFAULT_CONCURRENCY)
  }

  async load(): Promise<void> {
    try {
      const text = await fs.readFile(this.opts.statePath, 'utf8')
      const data = JSON.parse(text) as Partial<PersistedState>
      this.jobs = (Array.isArray(data.jobs) ? data.jobs : []).map(sanitizeJob).filter((j): j is QueueJob => j !== null)
      if (typeof data.concurrency === 'number') this.concurrency = clampConcurrency(data.concurrency)
      this.paused = data.paused === true
      this.pauseReason = this.paused ? (data.pauseReason ?? 'user') : null
      this.quota = this.pauseReason === 'quota' ? (data.quota ?? { resumeAt: null, reason: 'quota' }) : null
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'ENOENT') this.opts.log(`queue state unreadable, starting empty: ${(e as Error).message}`)
      this.jobs = []
    }
    this.opts.codex.on('rateLimits', this.onRateLimits)
    if (this.pauseReason === 'quota') this.scheduleQuotaResume()
    this.opts.log(`queue loaded: ${this.jobs.length} jobs, concurrency ${this.concurrency}, paused=${this.paused}`)
    this.changed()
    this.pump()
  }

  snapshot(): QueueSnapshot {
    let running = 0
    let queued = 0
    for (const j of this.jobs) {
      if (ACTIVE.includes(j.status)) running++
      else if (j.status === 'queued') queued++
    }
    return {
      jobs: this.jobs.map((j) => ({ ...j, styleImages: [...j.styleImages] })),
      paused: this.paused,
      pauseReason: this.pauseReason,
      pauseDetail: this.pauseReason === 'noImage' ? this.pauseDetail : null,
      quota: this.quotaInfo(),
      concurrency: this.concurrency,
      running,
      queued,
      rateLimits: this.opts.codex.rateLimits,
      updatedAt: Date.now()
    }
  }

  get(id: string): QueueJob | null {
    const j = this.find(id)
    return j ? { ...j } : null
  }

  enqueue(specs: JobSpec[]): string[] {
    const now = Date.now()
    const ids: string[] = []
    for (const s of specs) {
      const job: QueueJob = {
        projectPath: s.projectPath,
        assetRelPath: s.assetRelPath,
        sourcePath: s.sourcePath,
        groupId: s.groupId,
        stylePrompt: s.stylePrompt,
        styleImages: [...s.styleImages],
        refImages: s.refImages ? [...s.refImages] : undefined,
        note: s.note,
        nineSlice: s.nineSlice,
        edgeAnchored: s.edgeAnchored,
        model: s.model,
        effort: s.effort,
        id: randomUUID(),
        attempt: 1,
        status: 'queued',
        step: 'waiting',
        progress: '',
        error: null,
        result: null,
        createdAt: now,
        startedAt: null,
        finishedAt: null,
        notBefore: null
      }
      this.jobs.push(job)
      ids.push(job.id)
    }
    this.opts.log(`enqueued ${ids.length} job(s)`)
    this.changed()
    this.pump()
    return ids
  }

  pause(): void {
    if (this.paused && this.pauseReason === 'user') return
    this.paused = true
    this.pauseReason = 'user'
    this.clearQuotaTimers()
    this.quota = null
    this.opts.log('queue paused by user')
    this.changed()
  }

  resume(): void {
    this.paused = false
    this.pauseReason = null
    this.pauseDetail = null
    this.noImageStreak = 0
    this.quota = null
    this.clearQuotaTimers()
    this.emit('quota', null)
    this.opts.log('queue resumed')
    this.changed()
    this.pump()
  }

  pauseJob(id: string): void {
    const j = this.find(id)
    if (!j || j.status !== 'queued') return
    j.status = 'paused'
    this.changed()
  }

  resumeJob(id: string): void {
    const j = this.find(id)
    if (!j || j.status !== 'paused') return
    j.status = 'queued'
    this.changed()
    this.pump()
  }

  pauseProject(projectPath: string): void {
    for (const j of this.jobs) if (j.projectPath === projectPath && j.status === 'queued') j.status = 'paused'
    this.changed()
  }

  resumeProject(projectPath: string): void {
    for (const j of this.jobs) if (j.projectPath === projectPath && j.status === 'paused') j.status = 'queued'
    this.changed()
    this.pump()
  }

  cancel(id: string): void {
    const j = this.find(id)
    if (!j) return
    const ctl = this.active.get(id)
    if (ctl) {
      j.progress = 'canceling'
      ctl.abort()
    } else if (j.status === 'queued' || j.status === 'paused') {
      this.finish(j, 'canceled', { code: 'canceled', message: 'canceled by user' })
    }
    this.changed()
  }

  cancelAll(projectPath?: string): void {
    for (const j of this.jobs) {
      if (projectPath && j.projectPath !== projectPath) continue
      if (FINISHED.includes(j.status)) continue
      this.cancel(j.id)
    }
  }

  retry(id: string): void {
    const j = this.find(id)
    if (!j || !(j.status === 'error' || j.status === 'canceled' || j.status === 'qaWarn' || j.status === 'done')) return
    j.attempt += 1
    j.status = 'queued'
    j.step = 'waiting'
    j.progress = ''
    j.error = null
    j.result = null
    j.startedAt = null
    j.finishedAt = null
    j.notBefore = null
    this.autoRetries.delete(id)
    this.changed()
    this.pump()
  }

  retryFailed(projectPath: string): number {
    const ids = this.jobs.filter((j) => j.projectPath === projectPath && j.status === 'error').map((j) => j.id)
    for (const id of ids) this.retry(id)
    if (!ids.length) return 0
    this.opts.log(`retrying ${ids.length} failed job(s) in ${projectPath}`)
    if (this.pauseReason === 'noImage') this.resume()
    return ids.length
  }

  remove(id: string): void {
    const idx = this.jobs.findIndex((j) => j.id === id)
    if (idx < 0) return
    if (this.active.has(id)) {
      this.cancel(id)
      return
    }
    this.jobs.splice(idx, 1)
    this.changed()
  }

  move(id: string, toIndex: number): void {
    const idx = this.jobs.findIndex((j) => j.id === id)
    if (idx < 0) return
    const [job] = this.jobs.splice(idx, 1)
    const to = Math.max(0, Math.min(this.jobs.length, Math.round(toIndex)))
    this.jobs.splice(to, 0, job)
    this.changed()
  }

  clearFinished(projectPath?: string): void {
    this.jobs = this.jobs.filter((j) => !(FINISHED.includes(j.status) && (!projectPath || j.projectPath === projectPath)))
    this.changed()
  }

  setConcurrency(n: number): number {
    this.concurrency = clampConcurrency(n)
    this.changed()
    this.pump()
    return this.concurrency
  }

  async dispose(): Promise<void> {
    this.shuttingDown = true
    this.opts.codex.off('rateLimits', this.onRateLimits)
    this.clearQuotaTimers()
    if (this.pumpTimer) clearTimeout(this.pumpTimer)
    if (this.emitTimer) clearTimeout(this.emitTimer)
    for (const ctl of this.active.values()) ctl.abort()
    for (const j of this.jobs) {
      if (ACTIVE.includes(j.status)) {
        j.status = 'queued'
        j.step = 'waiting'
        j.progress = 'interrupted by shutdown'
      }
    }
    await this.flush()
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    await this.persist()
  }

  async whenIdle(): Promise<void> {
    if (this.isIdle()) return
    await new Promise<void>((resolve) => {
      const check = (): void => {
        if (!this.isIdle()) return
        this.off('snapshot', check)
        resolve()
      }
      this.on('snapshot', check)
    })
  }

  private isIdle(): boolean {
    return this.active.size === 0 && !this.jobs.some((j) => j.status === 'queued' && !this.paused)
  }

  private find(id: string): QueueJob | undefined {
    return this.jobs.find((j) => j.id === id)
  }

  private quotaInfo(): QuotaPause | null {
    if (!this.quota) return null
    const remainingMs = this.quota.resumeAt ? Math.max(0, this.quota.resumeAt - Date.now()) : null
    return { resumeAt: this.quota.resumeAt, reason: this.quota.reason, remainingMs }
  }

  private pump(): void {
    if (this.pumpTimer) {
      clearTimeout(this.pumpTimer)
      this.pumpTimer = null
    }
    if (this.paused || this.shuttingDown) return
    const now = Date.now()
    let soonest: number | null = null
    while (this.active.size < this.concurrency) {
      const next = this.jobs.find((j) => j.status === 'queued' && !this.active.has(j.id) && (!j.notBefore || j.notBefore <= now))
      if (!next) {
        for (const j of this.jobs) {
          if (j.status === 'queued' && j.notBefore && j.notBefore > now) soonest = Math.min(soonest ?? j.notBefore, j.notBefore)
        }
        break
      }
      if (exhausted(this.opts.codex.rateLimits)) {
        this.enterQuotaPause(null, 'rate limits exhausted')
        return
      }
      const stagger = this.opts.staggerMs ?? 2000
      const wait = this.active.size > 0 ? this.lastStart + stagger - now : 0
      if (wait > 0) {
        soonest = now + wait
        break
      }
      this.lastStart = now
      void this.start(next)
    }
    if (soonest !== null) {
      this.pumpTimer = setTimeout(() => {
        this.pumpTimer = null
        this.pump()
      }, Math.max(50, soonest - Date.now()))
    }
  }

  private async start(job: QueueJob): Promise<void> {
    const ctl = new AbortController()
    this.active.set(job.id, ctl)
    job.status = 'running'
    job.step = 'chroma'
    job.progress = 'starting'
    job.error = null
    job.startedAt = Date.now()
    job.finishedAt = null
    job.notBefore = null
    this.opts.log(`job ${job.id} start ${job.assetRelPath} (attempt ${job.attempt})`)
    this.emitJob('started', job)
    this.changed()
    const gs = this.opts.genSettings?.() ?? {}
    try {
      const result = await runGenJob(job, {
        codex: this.opts.codex,
        pipeline: this.opts.pipeline,
        log: this.opts.log,
        model: gs.model || DEFAULT_MODEL,
        effort: gs.effort || DEFAULT_EFFORT,
        timeoutMs: this.opts.timeoutMs ?? 240000,
        signal: ctl.signal,
        onStep: (step: JobStep, progress: string) => {
          job.step = step
          job.progress = progress
          if (step === 'background' || step === 'fit' || step === 'qa') job.status = 'processing'
          this.emitJob('progress', job)
          this.changed()
        }
      })
      job.result = result
      this.autoRetries.delete(job.id)
      this.noImageStreak = 0
      this.finish(job, result.qa.pass ? 'done' : 'qaWarn', null)
      this.opts.log(`job ${job.id} ${job.status} v${result.version} ${Date.now() - (job.startedAt ?? Date.now())} ms`)
    } catch (e) {
      this.handleFailure(job, e)
    } finally {
      this.active.delete(job.id)
      this.changed()
      this.pump()
    }
  }

  private handleFailure(job: QueueJob, e: unknown): void {
    const f = e instanceof JobFailure ? e : new JobFailure('unknown', (e as Error)?.message ?? String(e))
    this.opts.log(`job ${job.id} failed [${f.code}] ${f.message}`)
    if (this.shuttingDown) {
      this.requeue(job, 'interrupted by shutdown', null)
      return
    }
    if (f.code === 'canceled') {
      if (this.find(job.id)) this.finish(job, 'canceled', { code: 'canceled', message: 'canceled by user' })
      return
    }
    if (f.code === 'quota') {
      this.requeue(job, 'waiting for quota reset', null)
      this.enterQuotaPause(f.resetsAt, f.message)
      return
    }
    const transient = f.code === 'rateLimited' || f.code === 'codex' || f.code === 'timeout'
    const used = this.autoRetries.get(job.id) ?? 0
    const max = this.opts.maxAutoRetries ?? 1
    if (transient && used < max) {
      this.autoRetries.set(job.id, used + 1)
      const delay = (f.code === 'rateLimited' ? 30000 : 10000) * 2 ** used
      job.attempt += 1
      this.requeue(job, `retrying after ${f.code} in ${Math.round(delay / 1000)}s`, Date.now() + delay)
      return
    }
    this.finish(job, 'error', { code: f.code, message: f.message })
    if (f.code === 'noImage') this.trackNoImage(f.message)
  }

  private trackNoImage(message: string): void {
    this.noImageStreak++
    if (this.noImageStreak < NO_IMAGE_STREAK_LIMIT || this.paused) return
    this.paused = true
    this.pauseReason = 'noImage'
    this.pauseDetail = message
    this.clearQuotaTimers()
    this.quota = null
    this.opts.log(`queue paused: ${this.noImageStreak} jobs in a row finished without an image (${message})`)
  }

  private requeue(job: QueueJob, progress: string, notBefore: number | null): void {
    job.status = 'queued'
    job.step = 'waiting'
    job.progress = progress
    job.startedAt = null
    job.notBefore = notBefore
  }

  private finish(job: QueueJob, status: JobStatus, error: QueueJob['error']): void {
    job.status = status
    job.step = 'waiting'
    job.progress = ''
    job.error = error
    job.finishedAt = Date.now()
    this.emitJob('finished', job)
    this.trimFinished()
  }

  private trimFinished(): void {
    const max = this.opts.maxFinished ?? 1000
    const finished = this.jobs.filter((j) => FINISHED.includes(j.status))
    if (finished.length <= max) return
    const drop = new Set(finished.slice(0, finished.length - max).map((j) => j.id))
    this.jobs = this.jobs.filter((j) => !drop.has(j.id))
  }

  private handleRateLimits(rl: RateLimits): void {
    if (exhausted(rl) && this.pauseReason !== 'user') {
      this.enterQuotaPause(null, rl.reachedType ?? 'usage limit reached')
    } else {
      this.changed()
    }
  }

  private enterQuotaPause(resetsAtSec: number | null, reason: string): void {
    const at = resumeAtFrom(this.opts.codex.rateLimits, resetsAtSec)
    const resumeAt = (at ?? Date.now() + QUOTA_FALLBACK_MS) + QUOTA_BUFFER_MS
    if (this.pauseReason === 'quota' && this.quota && this.quota.resumeAt && this.quota.resumeAt >= resumeAt) return
    this.paused = true
    this.pauseReason = 'quota'
    this.quota = { resumeAt, reason }
    this.opts.log(`queue paused for quota until ${new Date(resumeAt).toISOString()} (${reason})`)
    this.scheduleQuotaResume()
    this.changed()
  }

  private scheduleQuotaResume(): void {
    this.clearQuotaTimers()
    const at = this.quota?.resumeAt ?? Date.now() + QUOTA_FALLBACK_MS
    this.resumeTimer = setTimeout(() => {
      this.resumeTimer = null
      void this.tryQuotaResume()
    }, Math.max(1000, at - Date.now()))
    this.countdownTimer = setInterval(() => this.emit('quota', this.quotaInfo()), 1000)
    this.emit('quota', this.quotaInfo())
  }

  private clearQuotaTimers(): void {
    if (this.resumeTimer) clearTimeout(this.resumeTimer)
    if (this.countdownTimer) clearInterval(this.countdownTimer)
    this.resumeTimer = null
    this.countdownTimer = null
  }

  private async tryQuotaResume(): Promise<void> {
    if (this.pauseReason !== 'quota' || this.shuttingDown) return
    let rl: RateLimits | null = null
    try {
      rl = await this.opts.codex.readRateLimits()
    } catch (e) {
      this.opts.log(`quota recheck failed: ${(e as Error).message}`)
      if (this.quota) this.quota.resumeAt = Date.now() + QUOTA_RECHECK_MS
      this.scheduleQuotaResume()
      this.changed()
      return
    }
    if (exhausted(rl)) {
      const at = resumeAtFrom(rl, null)
      const next = at && at + QUOTA_BUFFER_MS > Date.now() ? at + QUOTA_BUFFER_MS : Date.now() + QUOTA_RECHECK_MS
      if (this.quota) this.quota.resumeAt = next
      this.opts.log(`quota still exhausted, next check ${new Date(next).toISOString()}`)
      this.scheduleQuotaResume()
      this.changed()
      return
    }
    this.opts.log('quota reset, auto-resuming queue')
    this.resume()
  }

  private emitJob(type: QueueJobEvent['type'], job: QueueJob): void {
    this.emit('job', { type, job: { ...job } } satisfies QueueJobEvent)
  }

  private changed(): void {
    this.scheduleSave()
    const throttle = this.opts.emitThrottleMs ?? 150
    if (this.emitTimer) return
    const wait = Math.max(0, this.lastEmit + throttle - Date.now())
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.lastEmit = Date.now()
      this.emit('snapshot', this.snapshot())
    }, wait)
  }

  private scheduleSave(): void {
    if (this.saveTimer) return
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.persist()
    }, 400)
  }

  private persist(): Promise<void> {
    const state: PersistedState = {
      version: 1,
      concurrency: this.concurrency,
      paused: this.paused,
      pauseReason: this.pauseReason,
      quota: this.quota,
      jobs: this.jobs
    }
    const text = JSON.stringify(state, null, 2)
    const file = this.opts.statePath
    this.saving = this.saving
      .then(async () => {
        await fs.mkdir(dirname(file), { recursive: true })
        const tmp = `${file}.tmp`
        await fs.writeFile(tmp, text, 'utf8')
        await fs.rename(tmp, file)
      })
      .catch((e: Error) => this.opts.log(`queue persist failed: ${e.message}`))
    return this.saving
  }
}
