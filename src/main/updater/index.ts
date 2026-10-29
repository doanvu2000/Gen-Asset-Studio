import { app, type BrowserWindow, type IpcMain } from 'electron'
import { autoUpdater, type ProgressInfo, type UpdateInfo } from 'electron-updater'
import {
  UPDATE_IPC,
  htmlNotesToMarkdown,
  type UpdateActionResult,
  type UpdateRelease,
  type UpdateSnapshot,
  type UpdateState
} from '@shared/update'

export interface UpdaterDeps {
  log: (message: string) => void
  canRestart: () => boolean
  startDelayMs?: number
  intervalMs?: number
  enabled?: boolean
}

export interface Updater {
  snapshot: () => UpdateSnapshot
  check: () => Promise<UpdateActionResult>
  download: () => Promise<UpdateActionResult>
  quitAndInstall: () => UpdateActionResult
  onChange: (cb: (snapshot: UpdateSnapshot) => void) => () => void
  start: () => void
  dispose: () => void
}

const DEFAULT_START_DELAY = 5000
const DEFAULT_INTERVAL = 6 * 60 * 60 * 1000

export function normalizeNotes(notes: UpdateInfo['releaseNotes']): string {
  if (!notes) return ''
  if (typeof notes === 'string') return htmlNotesToMarkdown(notes)
  return notes
    .map((n) => [`## ${n.version}`, htmlNotesToMarkdown(n.note ?? '')].join('\n'))
    .join('\n\n')
}

export function toRelease(info: UpdateInfo): UpdateRelease {
  return {
    version: info.version,
    notes: normalizeNotes(info.releaseNotes),
    date: info.releaseDate || null
  }
}

function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  return String(err)
}

export function createUpdater(deps: UpdaterDeps): Updater {
  const enabled = deps.enabled ?? app.isPackaged
  const listeners = new Set<(snapshot: UpdateSnapshot) => void>()
  let state: UpdateState = enabled ? { kind: 'idle' } : { kind: 'dev' }
  let release: UpdateRelease | null = null
  let lastCheckedAt: number | null = null
  let checking: Promise<UpdateActionResult> | null = null
  let downloading: Promise<UpdateActionResult> | null = null
  let startTimer: NodeJS.Timeout | null = null
  let intervalTimer: NodeJS.Timeout | null = null
  let started = false

  const snapshot = (): UpdateSnapshot => ({
    state,
    currentVersion: app.getVersion(),
    lastCheckedAt,
    enabled
  })

  const setState = (next: UpdateState): void => {
    state = next
    const snap = snapshot()
    for (const cb of listeners) cb(snap)
  }

  const onChecking = (): void => {
    if (state.kind === 'downloading' || state.kind === 'downloaded') return
    setState({ kind: 'checking' })
  }
  const onAvailable = (info: UpdateInfo): void => {
    release = toRelease(info)
    lastCheckedAt = Date.now()
    deps.log(`update available ${info.version}`)
    if (state.kind === 'downloading' || state.kind === 'downloaded') return
    setState({ kind: 'available', ...release })
  }
  const onNotAvailable = (info: UpdateInfo): void => {
    lastCheckedAt = Date.now()
    deps.log(`no update (latest ${info.version})`)
    if (state.kind === 'downloading' || state.kind === 'downloaded') return
    setState({ kind: 'notAvailable' })
  }
  const onProgress = (p: ProgressInfo): void => {
    if (!release) return
    setState({
      kind: 'downloading',
      ...release,
      percent: p.percent,
      bytesPerSecond: p.bytesPerSecond,
      transferred: p.transferred,
      total: p.total
    })
  }
  const onDownloaded = (info: UpdateInfo): void => {
    release = toRelease(info)
    deps.log(`update downloaded ${info.version}`)
    setState({ kind: 'downloaded', ...release })
  }
  const onError = (err: Error): void => {
    deps.log(`update error: ${errorMessage(err)}`)
    if (state.kind === 'downloaded') return
    setState({ kind: 'error', message: errorMessage(err) })
  }

  if (enabled) {
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = true
    autoUpdater.allowPrerelease = false
    autoUpdater.allowDowngrade = false
    autoUpdater.logger = {
      info: (m?: unknown) => deps.log(`updater: ${String(m)}`),
      warn: (m?: unknown) => deps.log(`updater warn: ${String(m)}`),
      error: (m?: unknown) => deps.log(`updater error: ${String(m)}`),
      debug: () => undefined
    }
    autoUpdater.on('checking-for-update', onChecking)
    autoUpdater.on('update-available', onAvailable)
    autoUpdater.on('update-not-available', onNotAvailable)
    autoUpdater.on('download-progress', onProgress)
    autoUpdater.on('update-downloaded', onDownloaded)
    autoUpdater.on('error', onError)
  }

  const check = (): Promise<UpdateActionResult> => {
    if (!enabled) return Promise.resolve({ ok: false, message: 'dev' })
    if (state.kind === 'downloading' || state.kind === 'downloaded') return Promise.resolve({ ok: true })
    if (checking) return checking
    checking = autoUpdater
      .checkForUpdates()
      .then((): UpdateActionResult => ({ ok: true }))
      .catch((err: unknown): UpdateActionResult => {
        lastCheckedAt = Date.now()
        const message = errorMessage(err)
        if (state.kind !== 'error') setState({ kind: 'error', message })
        return { ok: false, message }
      })
      .finally(() => {
        checking = null
      })
    return checking
  }

  const download = (): Promise<UpdateActionResult> => {
    if (!enabled) return Promise.resolve({ ok: false, message: 'dev' })
    if (state.kind === 'downloaded') return Promise.resolve({ ok: true })
    if (downloading) return downloading
    if (!release) return Promise.resolve({ ok: false, message: 'no-update' })
    setState({ kind: 'downloading', ...release, percent: 0, bytesPerSecond: 0, transferred: 0, total: 0 })
    downloading = autoUpdater
      .downloadUpdate()
      .then((): UpdateActionResult => ({ ok: true }))
      .catch((err: unknown): UpdateActionResult => {
        const message = errorMessage(err)
        setState({ kind: 'error', message })
        return { ok: false, message }
      })
      .finally(() => {
        downloading = null
      })
    return downloading
  }

  const quitAndInstall = (): UpdateActionResult => {
    if (!enabled) return { ok: false, message: 'dev' }
    if (state.kind !== 'downloaded') return { ok: false, message: 'not-downloaded' }
    if (!deps.canRestart()) {
      deps.log('update install blocked: jobs running')
      return { ok: false, blocked: true }
    }
    deps.log(`quit and install ${state.version}`)
    setImmediate(() => autoUpdater.quitAndInstall(false, true))
    return { ok: true }
  }

  const start = (): void => {
    if (!enabled || started) return
    started = true
    startTimer = setTimeout(() => {
      startTimer = null
      void check()
    }, deps.startDelayMs ?? DEFAULT_START_DELAY)
    intervalTimer = setInterval(() => {
      void check()
    }, deps.intervalMs ?? DEFAULT_INTERVAL)
  }

  const dispose = (): void => {
    if (startTimer) clearTimeout(startTimer)
    if (intervalTimer) clearInterval(intervalTimer)
    startTimer = null
    intervalTimer = null
    listeners.clear()
    if (enabled) {
      autoUpdater.removeListener('checking-for-update', onChecking)
      autoUpdater.removeListener('update-available', onAvailable)
      autoUpdater.removeListener('update-not-available', onNotAvailable)
      autoUpdater.removeListener('download-progress', onProgress)
      autoUpdater.removeListener('update-downloaded', onDownloaded)
      autoUpdater.removeListener('error', onError)
    }
  }

  return {
    snapshot,
    check,
    download,
    quitAndInstall,
    onChange: (cb) => {
      listeners.add(cb)
      return () => {
        listeners.delete(cb)
      }
    },
    start,
    dispose
  }
}

export function registerUpdateIpc(
  ipcMain: IpcMain,
  getWindow: () => BrowserWindow | null,
  updater: Updater
): () => void {
  ipcMain.handle(UPDATE_IPC.get, () => updater.snapshot())
  ipcMain.handle(UPDATE_IPC.check, () => updater.check())
  ipcMain.handle(UPDATE_IPC.download, () => updater.download())
  ipcMain.handle(UPDATE_IPC.install, () => updater.quitAndInstall())
  const off = updater.onChange((snap) => {
    const win = getWindow()
    if (win && !win.isDestroyed()) win.webContents.send(UPDATE_IPC.changed, snap)
  })
  return () => {
    off()
    ipcMain.removeHandler(UPDATE_IPC.get)
    ipcMain.removeHandler(UPDATE_IPC.check)
    ipcMain.removeHandler(UPDATE_IPC.download)
    ipcMain.removeHandler(UPDATE_IPC.install)
  }
}
