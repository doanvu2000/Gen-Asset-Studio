import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import { IPC } from '@shared/ipc'
import type {
  AccountInfo,
  AppSettings,
  EnvStatus,
  FixContext,
  FixSnapshot,
  GasApi,
  RateLimits,
  SetupSnapshot,
  SetupStepId,
  Unsubscribe
} from '@shared/types'
import type { InputType, WorkspaceSnapshot } from '@shared/workspace'

function subscribe<T>(channel: string, cb: (value: T) => void): Unsubscribe {
  const listener = (_event: IpcRendererEvent, value: T): void => cb(value)
  ipcRenderer.on(channel, listener)
  return () => {
    ipcRenderer.removeListener(channel, listener)
  }
}

const api: GasApi = {
  app: {
    info: () => ipcRenderer.invoke(IPC.appInfo),
    openLogs: () => ipcRenderer.invoke(IPC.appOpenLogs),
    exportLog: () => ipcRenderer.invoke(IPC.appExportLog)
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
    set: (patch) => ipcRenderer.invoke(IPC.settingsSet, patch),
    onChange: (cb) => subscribe<AppSettings>(IPC.settingsChanged, cb)
  },
  theme: {
    systemDark: () => ipcRenderer.invoke(IPC.themeSystemDark),
    onSystemChange: (cb) => subscribe<boolean>(IPC.themeSystemChanged, cb)
  },
  setup: {
    get: () => ipcRenderer.invoke(IPC.setupGet),
    start: (quick: boolean) => ipcRenderer.invoke(IPC.setupStart, quick),
    retry: (step: SetupStepId) => ipcRenderer.invoke(IPC.setupRetry, step),
    pathChoice: (add: boolean) => ipcRenderer.invoke(IPC.setupPathChoice, add),
    uac: (grant: boolean) => ipcRenderer.invoke(IPC.setupUac, grant),
    login: () => ipcRenderer.invoke(IPC.setupLogin),
    loginCancel: () => ipcRenderer.invoke(IPC.setupLoginCancel),
    loginReopen: () => ipcRenderer.invoke(IPC.setupLoginReopen),
    testGen: () => ipcRenderer.invoke(IPC.setupTestGen),
    detect: () => ipcRenderer.invoke(IPC.setupDetect),
    workspace: (mode: 'new' | 'open') => ipcRenderer.invoke(IPC.setupWorkspace, mode),
    log: () => ipcRenderer.invoke(IPC.setupLog),
    onChange: (cb) => subscribe<SetupSnapshot>(IPC.setupChanged, cb),
    onLog: (cb) => subscribe<string>(IPC.setupLogLine, cb)
  },
  env: {
    get: () => ipcRenderer.invoke(IPC.envGet),
    recheck: () => ipcRenderer.invoke(IPC.envRecheck),
    reinstallCodex: () => ipcRenderer.invoke(IPC.envReinstallCodex),
    upgradeCodex: () => ipcRenderer.invoke(IPC.envUpgradeCodex),
    checkUpdate: () => ipcRenderer.invoke(IPC.envCheckUpdate),
    onChange: (cb) => subscribe<EnvStatus>(IPC.envChanged, cb)
  },
  account: {
    get: () => ipcRenderer.invoke(IPC.accountGet),
    rateLimits: () => ipcRenderer.invoke(IPC.accountRateLimits),
    models: () => ipcRenderer.invoke(IPC.accountModels),
    logout: () => ipcRenderer.invoke(IPC.accountLogout),
    switchAccount: () => ipcRenderer.invoke(IPC.accountSwitch),
    onChange: (cb) => subscribe<AccountInfo | null>(IPC.accountChanged, cb),
    onRateLimits: (cb) => subscribe<RateLimits>(IPC.rateLimitsChanged, cb)
  },
  fix: {
    available: () => ipcRenderer.invoke(IPC.fixAvailable),
    get: () => ipcRenderer.invoke(IPC.fixGet),
    start: (context: FixContext) => ipcRenderer.invoke(IPC.fixStart, context),
    apply: () => ipcRenderer.invoke(IPC.fixApply),
    cancel: () => ipcRenderer.invoke(IPC.fixCancel),
    onChange: (cb) => subscribe<FixSnapshot>(IPC.fixChanged, cb)
  },
  workspace: {
    get: () => ipcRenderer.invoke(IPC.wsGet),
    choose: () => ipcRenderer.invoke(IPC.wsChoose),
    createFolder: (parentRel: string, name: string) => ipcRenderer.invoke(IPC.wsCreateFolder, parentRel, name),
    createProject: (parentRel: string, name: string) => ipcRenderer.invoke(IPC.wsCreateProject, parentRel, name),
    rename: (rel: string, name: string) => ipcRenderer.invoke(IPC.wsRename, rel, name),
    move: (rel: string, destRel: string) => ipcRenderer.invoke(IPC.wsMove, rel, destRel),
    trash: (rel: string) => ipcRenderer.invoke(IPC.wsTrash, rel),
    reveal: (rel: string) => ipcRenderer.invoke(IPC.wsReveal, rel),
    onChange: (cb) => subscribe<WorkspaceSnapshot>(IPC.wsChanged, cb)
  },
  project: {
    open: (rel: string) => ipcRenderer.invoke(IPC.projOpen, rel),
    addDialog: (rel: string, mode: 'folder' | 'files') => ipcRenderer.invoke(IPC.projAddDialog, rel, mode),
    addPaths: (rel: string, paths: string[]) => ipcRenderer.invoke(IPC.projAddPaths, rel, paths),
    remove: (rel: string, ids: string[]) => ipcRenderer.invoke(IPC.projRemove, rel, ids),
    setType: (rel: string, ids: string[], type: InputType) => ipcRenderer.invoke(IPC.projSetType, rel, ids, type),
    relink: (rel: string, rootIndex: number) => ipcRenderer.invoke(IPC.projRelink, rel, rootIndex)
  },
  files: {
    pathFor: (file: File) => webUtils.getPathForFile(file)
  }
}

contextBridge.exposeInMainWorld('gas', api)
