import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import { SETUP_STEPS, type AppSettings, type FixContext, type ResolvedTheme, type SetupStepId } from '@shared/types'
import { SettingsStore } from './settings'
import { logger } from './logger'
import { logsDir } from './paths'
import { CodexInstaller } from './codex/installer'
import { CodexService } from './codex/service'
import { SetupService } from './setup/service'
import { FixService } from './setup/fix'
import { WorkspaceService } from './workspace/service'
import { handleFileScheme, registerFileScheme } from './workspace/protocol'
import { registerStyleIpc, StyleService } from './style'
import { userTemplatesDir } from './style/templates'
import { JobQueue, queueStatePath, registerQueueIpc } from './queue'
import { closePipeline, getPipeline } from './pipeline'
import { createUpdater, registerUpdateIpc, type Updater } from './updater'
import { registerExportIpc } from './export'
import { createSampleProject } from './sample'
import { REVIEW_IPC, type ReprocessOptions, type ReviewPatch } from '@shared/review'
import type { EdgeSide } from '@shared/queue'

const BG: Record<ResolvedTheme, string> = { light: '#F5F5F7', dark: '#1C1C1E' }

const settings = new SettingsStore()
let mainWindow: BrowserWindow | null = null
let installer: CodexInstaller
let codex: CodexService
let setup: SetupService
let fixer: FixService
let workspace: WorkspaceService
let style: StyleService
let queue: JobQueue | null = null
let updater: Updater | null = null
let disposeExportIpc: (() => void) | null = null
let quitting = false

function resolveTheme(s: AppSettings): ResolvedTheme {
  if (s.theme === 'system') return nativeTheme.shouldUseDarkColors ? 'dark' : 'light'
  return s.theme
}

function isSafeExternal(url: string): boolean {
  try {
    const { protocol } = new URL(url)
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    frame: false,
    titleBarStyle: 'hidden',
    backgroundColor: BG[resolveTheme(settings.get())],
    title: 'Gen Asset Studio',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false
    }
  })

  win.once('ready-to-show', () => {
    win.maximize()
    win.show()
  })

  const emitMax = (): void => {
    if (!win.isDestroyed()) win.webContents.send(IPC.winMaximizedChanged, win.isMaximized())
  }
  win.on('maximize', emitMax)
  win.on('unmaximize', emitMax)
  win.on('enter-full-screen', emitMax)
  win.on('leave-full-screen', emitMax)

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isSafeExternal(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    if (url !== win.webContents.getURL()) event.preventDefault()
  })

  if (!app.isPackaged) {
    win.webContents.on('console-message', (event) => {
      process.stdout.write(`[renderer:${event.level}] ${event.message}\n`)
    })
  }

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })
  return win
}

function broadcast(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

function applyWindowBackground(): void {
  const color = BG[resolveTheme(settings.get())]
  for (const w of BrowserWindow.getAllWindows()) w.setBackgroundColor(color)
}

function isStep(v: unknown): v is SetupStepId {
  return typeof v === 'string' && (SETUP_STEPS as readonly string[]).includes(v)
}

function initServices(): void {
  logger.init()
  logger.write('app', `start ${app.getVersion()} · ${process.platform} ${process.arch} · electron ${process.versions.electron}`)
  installer = new CodexInstaller(logger.scoped('installer'))
  codex = new CodexService(installer, logger.scoped('codex'))
  setup = new SetupService(settings, installer, codex)
  fixer = new FixService(codex, installer, () => settings.get().lang)
  setup.on('changed', (snap) => broadcast(IPC.setupChanged, snap))
  logger.on('line', (line: string) => broadcast(IPC.setupLogLine, line))
  setup.on('env', (env) => broadcast(IPC.envChanged, env))
  codex.on('account', (acc) => broadcast(IPC.accountChanged, acc))
  codex.on('rateLimits', (rl) => broadcast(IPC.rateLimitsChanged, rl))
  fixer.on('changed', (snap) => broadcast(IPC.fixChanged, snap))
  workspace = new WorkspaceService(logger.scoped('workspace'))
  workspace.on('changed', (snap) => broadcast(IPC.wsChanged, snap))
  style = new StyleService({ codex, log: logger.scoped('style') })
  workspace.allowDir(style.templates.builtinDir)
  workspace.allowDir(userTemplatesDir)
  void style.getModels()
}

function initQueue(): void {
  const q = new JobQueue({
    codex,
    pipeline: getPipeline({ size: 2 }),
    log: logger.scoped('queue'),
    statePath: queueStatePath,
    genSettings: () => style.modelsSync().assetGen,
    concurrency: settings.get().gen.concurrency
  })
  queue = q
  registerQueueIpc(ipcMain, () => mainWindow, q)
  void q
    .load()
    .then(() => q.setConcurrency(settings.get().gen.concurrency))
    .catch((e: Error) => logger.write('queue', `load failed: ${e.message}`))
}

function registerServiceIpc(): void {
  const fire = (p: Promise<unknown>): void => {
    p.catch((e: Error) => logger.write('ipc', `error: ${e.message}`))
  }
  ipcMain.handle(IPC.setupGet, () => setup.snapshot())
  ipcMain.handle(IPC.setupStart, (_e, quick: unknown) => fire(setup.start(quick === true)))
  ipcMain.handle(IPC.setupRetry, (_e, step: unknown) => {
    if (isStep(step)) fire(setup.retry(step))
  })
  ipcMain.handle(IPC.setupPathChoice, (_e, add: unknown) => fire(setup.pathChoice(add === true)))
  ipcMain.handle(IPC.setupUac, (_e, grant: unknown) => fire(setup.uac(grant === true)))
  ipcMain.handle(IPC.setupLogin, () => fire(setup.startLogin()))
  ipcMain.handle(IPC.setupLoginCancel, () => setup.cancelLogin())
  ipcMain.handle(IPC.setupLoginReopen, () => setup.reopenLogin())
  ipcMain.handle(IPC.setupTestGen, () => fire(setup.runTestGen()))
  ipcMain.handle(IPC.setupWorkspace, async (event, mode: unknown) => {
    await setup.pickWorkspace(mode === 'new' ? 'new' : 'open', BrowserWindow.fromWebContents(event.sender))
    await syncWorkspace()
  })
  ipcMain.handle(IPC.setupDetect, () => fire(setup.detect()))
  ipcMain.handle(IPC.setupLog, () => setup.logLines())

  ipcMain.handle(IPC.envGet, () => setup.envStatus())
  ipcMain.handle(IPC.envRecheck, () => fire(setup.recheck()))
  ipcMain.handle(IPC.envReinstallCodex, () => fire(setup.reinstallCodex()))
  ipcMain.handle(IPC.envUpgradeCodex, () => fire(setup.upgradeCodex()))
  ipcMain.handle(IPC.envCheckUpdate, () => setup.checkUpdate())

  ipcMain.handle(IPC.accountGet, () => codex.account)
  ipcMain.handle(IPC.accountRateLimits, async () => {
    if (!codex.account?.loggedIn) return codex.rateLimits
    try {
      return await codex.readRateLimits()
    } catch {
      return codex.rateLimits
    }
  })
  ipcMain.handle(IPC.accountModels, async () => {
    try {
      return await codex.listModels(false)
    } catch {
      return []
    }
  })
  ipcMain.handle(IPC.accountLogout, () => setup.logout())
  ipcMain.handle(IPC.accountSwitch, () => fire(setup.switchAccount()))

  ipcMain.handle(IPC.fixAvailable, () => fixer.available())
  ipcMain.handle(IPC.fixGet, () => fixer.snapshot())
  ipcMain.handle(IPC.fixStart, (_e, ctx: unknown) => {
    const c = (ctx ?? {}) as Partial<FixContext>
    const context: FixContext = {
      source: c.source === 'env' ? 'env' : c.source === 'gen' ? 'gen' : 'setup',
      target: String(c.target ?? ''),
      error: String(c.error ?? '')
    }
    fire(fixer.start(context))
  })
  ipcMain.handle(IPC.fixApply, () => fire(fixer.apply()))
  ipcMain.handle(IPC.fixCancel, () => fixer.cancel())
}

async function syncWorkspace(): Promise<void> {
  const ws = settings.get().workspace
  if (ws !== workspace.current) {
    await workspace.setRoot(ws)
    broadcast(IPC.settingsChanged, settings.get())
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

function registerWorkspaceIpc(): void {
  const win = (e: Electron.IpcMainInvokeEvent): BrowserWindow | null => BrowserWindow.fromWebContents(e.sender)
  ipcMain.handle(IPC.wsGet, () => workspace.snapshot())
  ipcMain.handle(IPC.wsChoose, async (e) => {
    await setup.pickWorkspace('open', win(e))
    await syncWorkspace()
    return workspace.snapshot()
  })
  ipcMain.handle(IPC.wsCreateFolder, (_e, parent: unknown, name: unknown) => workspace.createFolder(str(parent), str(name)))
  ipcMain.handle(IPC.wsCreateProject, (_e, parent: unknown, name: unknown) => workspace.createProject(str(parent), str(name)))
  ipcMain.handle(IPC.wsCreateSample, async () => {
    const root = workspace.current
    if (!root) return { ok: false, rel: null, name: null, added: 0, error: 'noWorkspace' }
    try {
      const r = await createSampleProject(root, settings.get().lang, {
        getTemplate: (id) => style.templates.get(id),
        log: logger.scoped('sample')
      })
      await workspace.rescan()
      await settings.update({ onboarding: { ...settings.get().onboarding, sampleOffered: true } })
      broadcast(IPC.settingsChanged, settings.get())
      return { ok: true, rel: r.rel, name: r.name, added: r.added, error: null }
    } catch (e) {
      return { ok: false, rel: null, name: null, added: 0, error: (e as Error).message }
    }
  })
  ipcMain.handle(IPC.wsRename, (_e, rel: unknown, name: unknown) => workspace.rename(str(rel), str(name)))
  ipcMain.handle(IPC.wsMove, (_e, rel: unknown, dest: unknown) => workspace.move(str(rel), str(dest)))
  ipcMain.handle(IPC.wsTrash, (_e, rel: unknown) => workspace.trash(str(rel)))
  ipcMain.handle(IPC.wsReveal, (_e, rel: unknown) => workspace.reveal(str(rel)))
  ipcMain.handle(IPC.projOpen, (_e, rel: unknown) => workspace.open(str(rel)))
  ipcMain.handle(IPC.projAddDialog, (e, rel: unknown, mode: unknown) => workspace.addFromDialog(str(rel), mode === 'folder' ? 'folder' : 'files', win(e)))
  ipcMain.handle(IPC.projAddPaths, (_e, rel: unknown, paths: unknown) => workspace.addPaths(str(rel), strs(paths)))
  ipcMain.handle(IPC.projRemove, (_e, rel: unknown, ids: unknown) => workspace.remove(str(rel), strs(ids)))
  ipcMain.handle(IPC.projSetType, (_e, rel: unknown, ids: unknown, type: unknown) =>
    workspace.setType(str(rel), strs(ids), type === 'nine' ? 'nine' : type === 'sprite' ? 'sprite' : 'normal')
  )
  ipcMain.handle(IPC.projRelink, (e, rel: unknown, index: unknown) => workspace.relink(str(rel), typeof index === 'number' ? index : -1, win(e)))
  ipcMain.handle(IPC.projSetGroups, (_e, rel: unknown, groups: unknown) => workspace.setGroups(str(rel), groups))
  ipcMain.handle(IPC.projAddRefs, (e, rel: unknown, groupId: unknown) => workspace.addRefs(str(rel), str(groupId), win(e)))
  ipcMain.handle(REVIEW_IPC.set, (_e, rel: unknown, patch: unknown) =>
    workspace.setReview(str(rel), patch && typeof patch === 'object' ? (patch as ReviewPatch) : {})
  )
  ipcMain.handle(REVIEW_IPC.versions, (_e, rel: unknown, id: unknown) => workspace.versions(str(rel), str(id)))
  ipcMain.handle(REVIEW_IPC.reprocess, (_e, rel: unknown, id: unknown, version: unknown, options: unknown) =>
    workspace.reprocess(str(rel), str(id), typeof version === 'number' ? version : -1, reprocessOptions(options), getPipeline({ size: 2 }))
  )
}

const SIDES: readonly EdgeSide[] = ['left', 'right', 'top', 'bottom']

function reprocessOptions(v: unknown): ReprocessOptions {
  const o = (v ?? {}) as Record<string, unknown>
  return {
    nineSlice: o.nineSlice === true ? true : o.nineSlice === false ? false : 'auto',
    edgeAnchored: Array.isArray(o.edgeAnchored) ? o.edgeAnchored.filter((s): s is EdgeSide => SIDES.includes(s as EdgeSide)) : 'auto'
  }
}

function initUpdater(): void {
  const u = createUpdater({
    log: logger.scoped('update'),
    canRestart: () => !queue || !queue.snapshot().jobs.some((j) => j.status === 'queued' || j.status === 'running' || j.status === 'processing')
  })
  updater = u
  registerUpdateIpc(ipcMain, () => mainWindow, u)
  u.start()
}

function registerIpc(): void {
  ipcMain.handle(IPC.appInfo, () => ({ version: app.getVersion(), platform: process.platform }))

  ipcMain.on(IPC.winMinimize, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize()
  })
  ipcMain.on(IPC.winToggleMaximize, (event) => {
    const w = BrowserWindow.fromWebContents(event.sender)
    if (!w) return
    if (w.isMaximized()) w.unmaximize()
    else w.maximize()
  })
  ipcMain.on(IPC.winClose, (event) => {
    BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.handle(IPC.winIsMaximized, (event) => BrowserWindow.fromWebContents(event.sender)?.isMaximized() ?? false)

  ipcMain.handle(IPC.settingsGet, () => settings.get())
  ipcMain.handle(IPC.settingsSet, async (_event, patch: unknown) => {
    const next = await settings.set(patch)
    if (queue && queue.snapshot().concurrency !== next.gen.concurrency) queue.setConcurrency(next.gen.concurrency)
    applyWindowBackground()
    broadcast(IPC.settingsChanged, next)
    return next
  })

  ipcMain.handle(IPC.appOpenLogs, async () => {
    await fs.mkdir(logsDir, { recursive: true })
    await shell.openPath(logsDir)
  })
  ipcMain.handle(IPC.appExportLog, async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
    const opts: Electron.SaveDialogOptions = {
      defaultPath: join(app.getPath('documents'), `GenAssetStudio-log-${stamp}.txt`),
      filters: [{ name: 'Text', extensions: ['txt'] }]
    }
    const r = win ? await dialog.showSaveDialog(win, opts) : await dialog.showSaveDialog(opts)
    if (r.canceled || !r.filePath) return { ok: false, path: null }
    await logger.flush()
    let body = ''
    try {
      body = await fs.readFile(logger.file, 'utf8')
    } catch {
      body = logger.recent().join('\n')
    }
    const header = [`Gen Asset Studio ${app.getVersion()} · ${process.platform} ${process.arch} · ${new Date().toISOString()}`, '']
    await fs.writeFile(r.filePath, header.join('\n') + body, 'utf8')
    return { ok: true, path: r.filePath }
  })

  ipcMain.handle(IPC.themeSystemDark, () => nativeTheme.shouldUseDarkColors)
  nativeTheme.on('updated', () => {
    applyWindowBackground()
    broadcast(IPC.themeSystemChanged, nativeTheme.shouldUseDarkColors)
  })
}

registerFileScheme()

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    app.setAppUserModelId('com.jinvu.genassetstudio')
    await settings.load()
    initServices()
    registerIpc()
    registerServiceIpc()
    registerWorkspaceIpc()
    registerStyleIpc(ipcMain, () => mainWindow, { service: style })
    disposeExportIpc = registerExportIpc(ipcMain, () => mainWindow, {
      loadProject: (rel) => workspace.loadForExport(rel),
      scale: (png, factor) => getPipeline({ size: 2 }).scale({ png, factor }),
      log: logger.scoped('export'),
      saveDir: (rel, outDir) => workspace.setExportDir(rel, outDir),
      onExported: (rel, res, options) => workspace.recordExport(rel, { outDir: options.outDir, resolvedOutDir: res.outDir, assets: res.exportedAssets, files: res.written + res.keptExisting })
    })
    initQueue()
    handleFileScheme((p) => workspace.isAllowed(p))
    void workspace.setRoot(settings.get().workspace)
    mainWindow = createWindow()
    initUpdater()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  app.on('before-quit', (event) => {
    if (quitting || !codex) return
    quitting = true
    event.preventDefault()
    logger.write('app', 'quit')
    updater?.dispose()
    disposeExportIpc?.()
    disposeExportIpc = null
    void workspace?.dispose()
    const stopQueue = queue ? Promise.race([queue.dispose(), new Promise((r) => setTimeout(r, 3000))]).catch(() => undefined) : Promise.resolve()
    void stopQueue
      .then(() => Promise.race([closePipeline(), new Promise((r) => setTimeout(r, 1500))]))
      .catch(() => undefined)
      .then(() => Promise.race([codex.stop(), new Promise((r) => setTimeout(r, 2500))]))
      .catch(() => undefined)
      .finally(() => {
        codex.killNow()
        void logger.flush().finally(() => app.quit())
      })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
