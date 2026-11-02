import { ipcMain } from 'electron'
import { join } from 'node:path'
import { STATS_IPC, type StatsQuery } from '@shared/stats'
import { appDataDir } from '../paths'
import { summarize } from './aggregate'
import { attachStatsRecorder, pruneStats, readRecords, type StatsQueueLike } from './recorder'

const statsDir = join(appDataDir, 'stats')

export function initStats(queue: StatsQueueLike, log: (msg: string) => void): void {
  attachStatsRecorder(queue, statsDir, log)
  ipcMain.handle(STATS_IPC.summary, async (_e, q: StatsQuery) => {
    const from = Number(q?.from)
    const to = Number(q?.to)
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new Error('invalid range')
    const project = typeof q.project === 'string' && q.project ? q.project : undefined
    return summarize(await readRecords(statsDir, from, to), { from, to, project })
  })
  void pruneStats(statsDir).catch((e: Error) => log(`stats prune failed: ${e.message}`))
}
