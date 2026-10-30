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
import { STYLE_IPC, type LockRequest, type PromptPolishRequest, type SaveTemplateRequest, type StyleGroup, type SuggestProgress, type SuggestRequest, type TaskModels } from '@shared/style'
import { exposeUpdateApi } from './update'
import { REVIEW_IPC, type ReprocessOptions, type ReviewPatch } from '@shared/review'
import { EXPORT_IPC, type ExportOptions, type ExportProgress } from '@shared/export'
import { QUEUE_IPC, type JobSpec, type QueueJobEvent, type QueueSnapshot, type QuotaPause } from '@shared/queue'

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
    createSample: () => ipcRenderer.invoke(IPC.wsCreateSample),
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
    relink: (rel: string, rootIndex: number) => ipcRenderer.invoke(IPC.projRelink, rel, rootIndex),
    setGroups: (rel: string, groups: StyleGroup[]) => ipcRenderer.invoke(IPC.projSetGroups, rel, groups),
    addRefs: (rel: string, groupId: string) => ipcRenderer.invoke(IPC.projAddRefs, rel, groupId)
  },
  style: {
    templates: () => ipcRenderer.invoke(STYLE_IPC.templatesList),
    saveTemplate: (req: SaveTemplateRequest) => ipcRenderer.invoke(STYLE_IPC.templateSave, req),
    deleteTemplate: (id: string) => ipcRenderer.invoke(STYLE_IPC.templateDelete, id),
    polish: (req: PromptPolishRequest) => ipcRenderer.invoke(STYLE_IPC.promptPolish, req),
    suggestStart: (req: SuggestRequest) => ipcRenderer.invoke(STYLE_IPC.suggestStart, req),
    suggestCancel: (runId: string) => ipcRenderer.invoke(STYLE_IPC.suggestCancel, runId),
    suggestGet: (projectPath: string, runId: string) => ipcRenderer.invoke(STYLE_IPC.suggestGet, projectPath, runId),
    suggestRegen: (projectPath: string, runId: string, suggestionId: string | null, feedback?: string) =>
      ipcRenderer.invoke(STYLE_IPC.suggestRegen, projectPath, runId, suggestionId, feedback),
    lock: (req: LockRequest) => ipcRenderer.invoke(STYLE_IPC.lock, req),
    unlock: (projectPath: string, group: StyleGroup) => ipcRenderer.invoke(STYLE_IPC.unlock, projectPath, group),
    modelsGet: () => ipcRenderer.invoke(STYLE_IPC.modelsGet),
    modelsSet: (patch: Partial<TaskModels>) => ipcRenderer.invoke(STYLE_IPC.modelsSet, patch),
    onSuggestProgress: (cb) => subscribe<SuggestProgress>(STYLE_IPC.suggestProgress, cb)
  },
  queue: {
    snapshot: () => ipcRenderer.invoke(QUEUE_IPC.snapshot),
    enqueue: (specs: JobSpec[]) => ipcRenderer.invoke(QUEUE_IPC.enqueue, specs),
    pause: () => ipcRenderer.invoke(QUEUE_IPC.pause),
    resume: () => ipcRenderer.invoke(QUEUE_IPC.resume),
    pauseJob: (id: string) => ipcRenderer.invoke(QUEUE_IPC.pauseJob, id),
    resumeJob: (id: string) => ipcRenderer.invoke(QUEUE_IPC.resumeJob, id),
    pauseProject: (projectPath: string) => ipcRenderer.invoke(QUEUE_IPC.pauseProject, projectPath),
    resumeProject: (projectPath: string) => ipcRenderer.invoke(QUEUE_IPC.resumeProject, projectPath),
    cancel: (id: string) => ipcRenderer.invoke(QUEUE_IPC.cancel, id),
    cancelAll: (projectPath?: string) => ipcRenderer.invoke(QUEUE_IPC.cancelAll, projectPath),
    retry: (id: string) => ipcRenderer.invoke(QUEUE_IPC.retry, id),
    retryFailed: (projectPath: string) => ipcRenderer.invoke(QUEUE_IPC.retryFailed, projectPath),
    remove: (id: string) => ipcRenderer.invoke(QUEUE_IPC.remove, id),
    move: (id: string, toIndex: number) => ipcRenderer.invoke(QUEUE_IPC.move, id, toIndex),
    clearFinished: (projectPath?: string) => ipcRenderer.invoke(QUEUE_IPC.clearFinished, projectPath),
    setConcurrency: (n: number) => ipcRenderer.invoke(QUEUE_IPC.setConcurrency, n),
    onChange: (cb) => subscribe<QueueSnapshot>(QUEUE_IPC.changed, cb),
    onJob: (cb) => subscribe<QueueJobEvent>(QUEUE_IPC.job, cb),
    onQuota: (cb) => subscribe<QuotaPause | null>(QUEUE_IPC.quota, cb)
  },
  review: {
    set: (rel: string, patch: ReviewPatch) => ipcRenderer.invoke(REVIEW_IPC.set, rel, patch),
    versions: (rel: string, inputId: string) => ipcRenderer.invoke(REVIEW_IPC.versions, rel, inputId),
    reprocess: (rel: string, inputId: string, version: number, options: ReprocessOptions) => ipcRenderer.invoke(REVIEW_IPC.reprocess, rel, inputId, version, options)
  },
  export: {
    plan: (rel: string, options?: Partial<ExportOptions>) => ipcRenderer.invoke(EXPORT_IPC.plan, rel, options),
    run: (rel: string, options?: Partial<ExportOptions>) => ipcRenderer.invoke(EXPORT_IPC.run, rel, options),
    cancel: (rel: string) => ipcRenderer.invoke(EXPORT_IPC.cancel, rel),
    pickDir: (current?: string) => ipcRenderer.invoke(EXPORT_IPC.pickDir, current),
    openPath: (path: string) => ipcRenderer.invoke(EXPORT_IPC.openPath, path),
    saveDir: (rel: string, outDir: string) => ipcRenderer.invoke(EXPORT_IPC.saveDir, rel, outDir),
    onProgress: (cb) => subscribe<ExportProgress>(EXPORT_IPC.progress, cb)
  },
  update: exposeUpdateApi(),
  files: {
    pathFor: (file: File) => webUtils.getPathForFile(file)
  }
}

contextBridge.exposeInMainWorld('gas', api)
