import { app, BrowserWindow, ipcMain, nativeTheme, shell } from 'electron'
import { join } from 'node:path'
import { IPC } from '@shared/ipc'
import type { AppSettings, ResolvedTheme } from '@shared/types'
import { SettingsStore } from './settings'

const BG: Record<ResolvedTheme, string> = { light: '#F5F5F7', dark: '#1C1C1E' }

const settings = new SettingsStore()
let mainWindow: BrowserWindow | null = null

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

  win.once('ready-to-show', () => win.show())

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
    applyWindowBackground()
    broadcast(IPC.settingsChanged, next)
    return next
  })

  ipcMain.handle(IPC.themeSystemDark, () => nativeTheme.shouldUseDarkColors)
  nativeTheme.on('updated', () => {
    applyWindowBackground()
    broadcast(IPC.themeSystemChanged, nativeTheme.shouldUseDarkColors)
  })
}

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
    registerIpc()
    mainWindow = createWindow()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
