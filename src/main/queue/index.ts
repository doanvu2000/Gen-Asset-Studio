import type { BrowserWindow, IpcMain } from 'electron'
import { join } from 'node:path'
import { QUEUE_IPC, type JobSpec, type QueueJobEvent, type QueueSnapshot, type QuotaPause } from '@shared/queue'
import { appDataDir } from '../paths'
import type { LogFn } from '../logger'
import { getPipeline } from '../pipeline'
import type { CodexLike, PipelineLike } from './GenJob'
import { JobQueue, type GenSettings, type JobQueueOptions } from './JobQueue'

export { JobQueue } from './JobQueue'
export type { GenSettings, JobQueueOptions } from './JobQueue'
export { JobFailure, buildPrompt, runGenJob, versionsDir } from './GenJob'
export type { CodexLike, PipelineLike } from './GenJob'

export const queueStatePath = join(appDataDir, 'queue.json')

export interface CreateQueueOptions {
  codex: CodexLike
  log: LogFn
  pipeline?: PipelineLike
  statePath?: string
  genSettings?: () => GenSettings
  concurrency?: number
  overrides?: Partial<Omit<JobQueueOptions, 'codex' | 'pipeline' | 'log' | 'statePath' | 'genSettings' | 'concurrency'>>
}

export async function createJobQueue(o: CreateQueueOptions): Promise<JobQueue> {
  const q = new JobQueue({
    codex: o.codex,
    pipeline: o.pipeline ?? getPipeline({ size: 2 }),
    log: o.log,
    statePath: o.statePath ?? queueStatePath,
    genSettings: o.genSettings,
    concurrency: o.concurrency,
    ...o.overrides
  })
  await q.load()
  return q
}

function isSpecArray(v: unknown): v is JobSpec[] {
  return (
    Array.isArray(v) &&
    v.every(
      (s) =>
        !!s &&
        typeof s === 'object' &&
        typeof (s as JobSpec).projectPath === 'string' &&
        typeof (s as JobSpec).assetRelPath === 'string' &&
        typeof (s as JobSpec).sourcePath === 'string' &&
        typeof (s as JobSpec).groupId === 'string' &&
        typeof (s as JobSpec).stylePrompt === 'string' &&
        Array.isArray((s as JobSpec).styleImages)
    )
  )
}

function str(v: unknown, name: string): string {
  if (typeof v !== 'string' || !v) throw new Error(`${name} must be a non-empty string`)
  return v
}

function optStr(v: unknown): string | undefined {
  return typeof v === 'string' && v ? v : undefined
}

export function registerQueueIpc(ipcMain: IpcMain, getWindow: () => BrowserWindow | null, queue: JobQueue): () => void {
  const send = (channel: string, payload: unknown): void => {
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }
  const onSnapshot = (s: QueueSnapshot): void => send(QUEUE_IPC.changed, s)
  const onJob = (e: QueueJobEvent): void => send(QUEUE_IPC.job, e)
  const onQuota = (q: QuotaPause | null): void => send(QUEUE_IPC.quota, q)
  queue.on('snapshot', onSnapshot)
  queue.on('job', onJob)
  queue.on('quota', onQuota)

  const handlers: Record<string, (...args: unknown[]) => unknown> = {
    [QUEUE_IPC.snapshot]: () => queue.snapshot(),
    [QUEUE_IPC.enqueue]: (specs) => {
      if (!isSpecArray(specs)) throw new Error('invalid job specs')
      return queue.enqueue(specs)
    },
    [QUEUE_IPC.pause]: () => queue.pause(),
    [QUEUE_IPC.resume]: () => queue.resume(),
    [QUEUE_IPC.pauseJob]: (id) => queue.pauseJob(str(id, 'id')),
    [QUEUE_IPC.resumeJob]: (id) => queue.resumeJob(str(id, 'id')),
    [QUEUE_IPC.pauseProject]: (p) => queue.pauseProject(str(p, 'projectPath')),
    [QUEUE_IPC.resumeProject]: (p) => queue.resumeProject(str(p, 'projectPath')),
    [QUEUE_IPC.cancel]: (id) => queue.cancel(str(id, 'id')),
    [QUEUE_IPC.cancelAll]: (p) => queue.cancelAll(optStr(p)),
    [QUEUE_IPC.retry]: (id) => queue.retry(str(id, 'id')),
    [QUEUE_IPC.retryFailed]: (p) => queue.retryFailed(str(p, 'projectPath')),
    [QUEUE_IPC.remove]: (id) => queue.remove(str(id, 'id')),
    [QUEUE_IPC.move]: (id, to) => queue.move(str(id, 'id'), Number(to)),
    [QUEUE_IPC.clearFinished]: (p) => queue.clearFinished(optStr(p)),
    [QUEUE_IPC.setConcurrency]: (n) => queue.setConcurrency(Number(n))
  }
  for (const [channel, fn] of Object.entries(handlers)) {
    ipcMain.handle(channel, (_e, ...args: unknown[]) => fn(...args))
  }
  return () => {
    queue.off('snapshot', onSnapshot)
    queue.off('job', onJob)
    queue.off('quota', onQuota)
    for (const channel of Object.keys(handlers)) ipcMain.removeHandler(channel)
  }
}
