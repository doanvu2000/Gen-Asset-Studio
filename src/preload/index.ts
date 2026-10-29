import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type { AppSettings, GasApi, Unsubscribe } from '@shared/types'

function subscribe<T>(channel: string, cb: (value: T) => void): Unsubscribe {
  const listener = (_event: IpcRendererEvent, value: T): void => cb(value)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: GasApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo)
  },
  window: {
    minimize: () => ipcRenderer.send(IPC.winMinimize),
    toggleMaximize: () => ipcRenderer.send(IPC.winToggleMaximize),
    close: () => ipcRenderer.send(IPC.winClose),
    isMaximized: () => ipcRenderer.invoke(IPC.winIsMaximized),
    onMaximizedChange: (cb) => subscribe<boolean>(IPC.winMaximizedChanged, cb)
  },
  settings: {
    get: () => ipcRenderer.invoke(IPC.settingsGet),
    set: (patch: Partial<AppSettings>) => ipcRenderer.invoke(IPC.settingsSet, patch),
    onChange: (cb) => subscribe<AppSettings>(IPC.settingsChanged, cb)
  },
  theme: {
    systemDark: () => ipcRenderer.invoke(IPC.themeSystemDark),
    onSystemChange: (cb) => subscribe<boolean>(IPC.themeSystemChanged, cb)
  }
}

contextBridge.exposeInMainWorld('gas', api)
