import { ipcRenderer, type IpcRendererEvent } from 'electron'
import { UPDATE_IPC, type UpdateApi, type UpdateSnapshot } from '@shared/update'

export function exposeUpdateApi(): UpdateApi {
  return {
    get: () => ipcRenderer.invoke(UPDATE_IPC.get),
    check: () => ipcRenderer.invoke(UPDATE_IPC.check),
    download: () => ipcRenderer.invoke(UPDATE_IPC.download),
    install: () => ipcRenderer.invoke(UPDATE_IPC.install),
    onChange: (cb) => {
      const listener = (_event: IpcRendererEvent, snap: UpdateSnapshot): void => cb(snap)
      ipcRenderer.on(UPDATE_IPC.changed, listener)
      return () => {
        ipcRenderer.removeListener(UPDATE_IPC.changed, listener)
      }
    }
  }
}
