import type { AddResult, InputType, OpResult, ProjectView, SampleCreateResult, WorkspaceSnapshot } from './workspace'
import type { StyleApi, StyleGroup } from './style'
import type { QueueApi } from './queue'
import type { ReviewApi } from './review'
import type { UpdateApi } from './update'
import type { ExportApi } from './export'
import type { StorageApi } from './storage'

export type ThemePref = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'
export type Lang = 'vi' | 'en'

export type PathChoice = 'added' | 'skipped' | null

export interface SetupPersist {
  completed: boolean
  pathChoice: PathChoice
  longPathSkipped: boolean
  testGenOk: boolean
}

export type ExportScale = 1 | 2 | 4

export interface GenPrefs {
  concurrency: number
  styleCount: number
  scale: ExportScale
}

export const DEFAULT_GEN: GenPrefs = { concurrency: 3, styleCount: 3, scale: 1 }

export interface OnboardingPersist {
  tours: Record<string, boolean>
  sampleOffered: boolean
}

export const DEFAULT_ONBOARDING: OnboardingPersist = { tours: {}, sampleOffered: false }

export type CloseWhenBusy = 'background' | 'quit'

export interface AppSettings {
  theme: ThemePref
  lang: Lang
  closeWhenBusy: CloseWhenBusy
  workspace: string | null
  setup: SetupPersist
  gen: GenPrefs
  onboarding: OnboardingPersist
}

export interface SettingsPatch {
  theme?: ThemePref
  lang?: Lang
  closeWhenBusy?: CloseWhenBusy
  gen?: Partial<GenPrefs>
  onboarding?: Partial<OnboardingPersist>
}

export const DEFAULT_SETUP: SetupPersist = {
  completed: false,
  pathChoice: null,
  longPathSkipped: false,
  testGenOk: false
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  lang: 'vi',
  closeWhenBusy: 'background',
  workspace: null,
  setup: { ...DEFAULT_SETUP },
  gen: { ...DEFAULT_GEN },
  onboarding: { tours: {}, sampleOffered: false }
}

export interface AppInfo {
  version: string
  platform: string
}

export type Unsubscribe = () => void

export type SetupStepId = 'perm' | 'codex' | 'path' | 'longPath' | 'login' | 'quota' | 'workspace'
export const SETUP_STEPS: readonly SetupStepId[] = ['perm', 'codex', 'path', 'longPath', 'login', 'quota', 'workspace']

export type StepState = 'idle' | 'running' | 'done' | 'error' | 'skipped'
export type StepNeed = 'pathChoice' | 'uac' | 'login' | 'loginWait' | 'workspace' | null
export type StepParams = Record<string, string | number>

export interface StepInfo {
  id: SetupStepId
  state: StepState
  need: StepNeed
  sub: string | null
  params: StepParams
  progress: number | null
  error: string | null
}

export interface DownloadProgress {
  phase: 'download' | 'verify' | 'extract' | 'check' | 'activate'
  received: number
  total: number
  source: string
}

export type TestGenState = 'idle' | 'running' | 'done' | 'error'

export interface TestGenInfo {
  state: TestGenState
  error: string | null
  savedPath: string | null
  imageDataUrl: string | null
  ms: number | null
}

export interface SetupSnapshot {
  steps: StepInfo[]
  started: boolean
  running: boolean
  detecting: boolean
  quick: boolean
  isAdmin: boolean | null
  canEnter: boolean
  completedBefore: boolean
  download: DownloadProgress | null
  login: { loginId: string; authUrl: string } | null
  testGen: TestGenInfo
}

export interface AccountInfo {
  loggedIn: boolean
  type: string | null
  email: string | null
  planType: string | null
}

export interface RateWindow {
  usedPercent: number
  windowDurationMins: number | null
  resetsAt: number | null
}

export interface RateLimits {
  primary: RateWindow | null
  secondary: RateWindow | null
  reachedType: string | null
  planType: string | null
  updatedAt: number
}

export interface ModelInfo {
  id: string
  model: string
  displayName: string
  isDefault: boolean
  hidden: boolean
  efforts: string[]
  defaultEffort: string | null
}

export type EnvItemId = 'codex' | 'path' | 'longPath' | 'login' | 'imageGen' | 'workspace'
export type EnvState = 'installed' | 'installing' | 'missing' | 'error'

export interface EnvItem {
  id: EnvItemId
  state: EnvState
  detail: string | null
  error: string | null
}

export interface EnvStatus {
  items: EnvItem[]
  codexVersion: string | null
  latestVersion: string | null
  updateAvailable: boolean
  upgrading: boolean
  codexHome: string
  appDataDir: string
}

export type CodexServiceState = 'stopped' | 'starting' | 'ready' | 'error'

export type FixSource = 'setup' | 'env' | 'gen'

export interface FixContext {
  source: FixSource
  target: string
  error: string
}

export interface FixProposal {
  cause: string
  steps: string[]
  commands: string
}

export type FixPhase = 'idle' | 'analyzing' | 'proposal' | 'applying' | 'applied' | 'error'

export interface FixSnapshot {
  phase: FixPhase
  context: FixContext | null
  text: string
  proposal: FixProposal | null
  result: string | null
  error: string | null
}

export interface ExportResult {
  ok: boolean
  path: string | null
}

export interface GasApi {
  app: {
    info: () => Promise<AppInfo>
    openLogs: () => Promise<void>
    exportLog: () => Promise<ExportResult>
  }
  window: {
    minimize: () => void
    toggleMaximize: () => void
    close: () => void
    isMaximized: () => Promise<boolean>
    onMaximizedChange: (cb: (maximized: boolean) => void) => Unsubscribe
  }
  settings: {
    get: () => Promise<AppSettings>
    set: (patch: SettingsPatch) => Promise<AppSettings>
    onChange: (cb: (settings: AppSettings) => void) => Unsubscribe
  }
  theme: {
    systemDark: () => Promise<boolean>
    onSystemChange: (cb: (dark: boolean) => void) => Unsubscribe
  }
  setup: {
    get: () => Promise<SetupSnapshot>
    start: (quick: boolean) => Promise<void>
    retry: (step: SetupStepId) => Promise<void>
    pathChoice: (add: boolean) => Promise<void>
    uac: (grant: boolean) => Promise<void>
    login: () => Promise<void>
    loginCancel: () => Promise<void>
    loginReopen: () => Promise<void>
    testGen: () => Promise<void>
    detect: () => Promise<void>
    workspace: (mode: 'new' | 'open') => Promise<void>
    log: () => Promise<string[]>
    onChange: (cb: (snapshot: SetupSnapshot) => void) => Unsubscribe
    onLog: (cb: (line: string) => void) => Unsubscribe
  }
  env: {
    get: () => Promise<EnvStatus>
    recheck: () => Promise<void>
    reinstallCodex: () => Promise<void>
    upgradeCodex: () => Promise<void>
    checkUpdate: () => Promise<void>
    onChange: (cb: (status: EnvStatus) => void) => Unsubscribe
  }
  account: {
    get: () => Promise<AccountInfo | null>
    rateLimits: () => Promise<RateLimits | null>
    models: () => Promise<ModelInfo[]>
    logout: () => Promise<void>
    switchAccount: () => Promise<void>
    onChange: (cb: (account: AccountInfo | null) => void) => Unsubscribe
    onRateLimits: (cb: (limits: RateLimits) => void) => Unsubscribe
  }
  fix: {
    available: () => Promise<boolean>
    get: () => Promise<FixSnapshot>
    start: (context: FixContext) => Promise<void>
    apply: () => Promise<void>
    cancel: () => Promise<void>
    onChange: (cb: (snapshot: FixSnapshot) => void) => Unsubscribe
  }
  workspace: {
    get: () => Promise<WorkspaceSnapshot>
    choose: () => Promise<WorkspaceSnapshot>
    createFolder: (parentRel: string, name: string) => Promise<OpResult>
    createProject: (parentRel: string, name: string) => Promise<OpResult>
    createSample: () => Promise<SampleCreateResult>
    rename: (rel: string, name: string) => Promise<OpResult>
    move: (rel: string, destRel: string) => Promise<OpResult>
    trash: (rel: string) => Promise<OpResult>
    reveal: (rel: string) => Promise<void>
    onChange: (cb: (snapshot: WorkspaceSnapshot) => void) => Unsubscribe
  }
  project: {
    open: (rel: string) => Promise<ProjectView | null>
    addDialog: (rel: string, mode: 'folder' | 'files') => Promise<AddResult>
    addPaths: (rel: string, paths: string[]) => Promise<AddResult>
    remove: (rel: string, ids: string[]) => Promise<ProjectView | null>
    setType: (rel: string, ids: string[], type: InputType) => Promise<ProjectView | null>
    relink: (rel: string, rootIndex: number) => Promise<ProjectView | null>
    setGroups: (rel: string, groups: StyleGroup[]) => Promise<StyleGroup[] | null>
    addRefs: (rel: string, groupId: string) => Promise<string[]>
  }
  style: StyleApi
  queue: QueueApi
  review: ReviewApi
  export: ExportApi
  update: UpdateApi
  storage: StorageApi
  files: {
    pathFor: (file: File) => string
  }
}
