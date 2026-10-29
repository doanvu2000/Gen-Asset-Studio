import type { BrowserWindow, IpcMain } from 'electron'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  DEFAULT_TASK_MODELS,
  STYLE_IPC,
  SUGGEST_DEFAULT,
  SUGGEST_MAX,
  SUGGEST_MIN,
  type LockRequest,
  type PromptPolishRequest,
  type PromptPolishResult,
  type SaveTemplateRequest,
  type StyleGroup,
  type StyleTask,
  type StyleTemplate,
  type SuggestProgress,
  type SuggestRequest,
  type SuggestRun,
  type TaskModels
} from '@shared/style'
import { appDataDir } from '../paths'
import { cleanStr, readJson, writeJsonAtomic, type StyleCodex } from './common'
import { lockStyle, unlockStyle } from './lock'
import { polishPrompt } from './promptPolish'
import { SuggestService } from './suggest'
import { TemplateStore } from './templates'

export { TemplateStore } from './templates'
export { SuggestService, pickDiverseSamples } from './suggest'
export { polishPrompt } from './promptPolish'
export { lockStyle, unlockStyle, resolveProjectFile } from './lock'

export interface StyleDeps {
  codex: StyleCodex
  log?: (m: string) => void
  builtinTemplatesDir?: string
  userTemplatesDir?: string
  modelsFile?: string
  workDir?: string
  suggestConcurrency?: number
  suggestRetries?: number
}

const TASKS: StyleTask[] = ['promptPolish', 'styleSuggest', 'assetGen']

export class StyleService {
  readonly templates: TemplateStore
  readonly suggest: SuggestService
  private models: TaskModels = structuredClone(DEFAULT_TASK_MODELS)
  private modelsLoaded = false
  private readonly modelsFile: string

  constructor(private readonly deps: StyleDeps) {
    this.templates = new TemplateStore(deps.builtinTemplatesDir, deps.userTemplatesDir)
    this.modelsFile = deps.modelsFile ?? join(appDataDir, 'style-models.json')
    this.suggest = new SuggestService({
      codex: deps.codex,
      models: () => this.models.styleSuggest,
      log: deps.log,
      concurrency: deps.suggestConcurrency ?? 2,
      maxRetries: deps.suggestRetries ?? 1
    })
  }

  async getModels(): Promise<TaskModels> {
    if (!this.modelsLoaded) {
      const saved = await readJson<Partial<TaskModels>>(this.modelsFile)
      if (saved) this.models = this.sanitizeModels(saved)
      this.modelsLoaded = true
    }
    return structuredClone(this.models)
  }

  private sanitizeModels(v: Partial<TaskModels>): TaskModels {
    const out = structuredClone(DEFAULT_TASK_MODELS)
    for (const t of TASKS) {
      const m = cleanStr(v[t]?.model, 80)
      const e = cleanStr(v[t]?.effort, 20)
      if (m) out[t].model = m
      if (e) out[t].effort = e
    }
    return out
  }

  async setModels(patch: Partial<TaskModels>): Promise<TaskModels> {
    const cur = await this.getModels()
    this.models = this.sanitizeModels({ ...cur, ...patch })
    await writeJsonAtomic(this.modelsFile, this.models)
    return structuredClone(this.models)
  }

  listTemplates(): Promise<StyleTemplate[]> {
    return this.templates.list()
  }

  saveTemplate(req: SaveTemplateRequest): Promise<StyleTemplate> {
    return this.templates.saveFromGroup(req)
  }

  deleteTemplate(id: string): Promise<boolean> {
    return this.templates.deleteUser(id)
  }

  async polish(req: PromptPolishRequest, onDelta?: (t: string) => void): Promise<PromptPolishResult> {
    const models = (await this.getModels()).promptPolish
    const cwd = this.deps.workDir ?? appDataDir
    await fs.mkdir(cwd, { recursive: true })
    return polishPrompt(this.deps.codex, req, { cwd, models, onDelta })
  }

  async startSuggest(req: SuggestRequest): Promise<{ run: SuggestRun; done: Promise<SuggestRun> }> {
    await this.getModels()
    const count = Math.max(SUGGEST_MIN, Math.min(SUGGEST_MAX, Math.round(req.count ?? SUGGEST_DEFAULT)))
    const run = await this.suggest.start(req)
    const done = this.suggest.execute(run, count, req.feedback)
    return { run, done }
  }

  async runSuggest(req: SuggestRequest): Promise<SuggestRun> {
    const { done } = await this.startSuggest(req)
    return done
  }

  lock(req: LockRequest): Promise<StyleGroup> {
    return lockStyle(req, { suggest: this.suggest, templates: this.templates })
  }

  unlock(projectPath: string, group: StyleGroup): Promise<StyleGroup> {
    return unlockStyle(projectPath, group)
  }
}

export function registerStyleIpc(ipcMain: IpcMain, getWindow: () => BrowserWindow | null, deps: StyleDeps | { service: StyleService }): StyleService {
  const service = 'service' in deps ? deps.service : new StyleService(deps)
  const send = (channel: string, payload: unknown): void => {
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }
  service.suggest.on('progress', (p: SuggestProgress) => send(STYLE_IPC.suggestProgress, p))
  ipcMain.handle(STYLE_IPC.templatesList, () => service.listTemplates())
  ipcMain.handle(STYLE_IPC.templateSave, (_e, req: SaveTemplateRequest) => service.saveTemplate(req))
  ipcMain.handle(STYLE_IPC.templateDelete, (_e, id: string) => service.deleteTemplate(id))
  ipcMain.handle(STYLE_IPC.promptPolish, (_e, req: PromptPolishRequest) => service.polish(req))
  ipcMain.handle(STYLE_IPC.suggestStart, async (_e, req: SuggestRequest) => {
    const { run, done } = await service.startSuggest(req)
    void done.catch(() => undefined)
    return run
  })
  ipcMain.handle(STYLE_IPC.suggestCancel, (_e, runId: string) => service.suggest.cancel(runId))
  ipcMain.handle(STYLE_IPC.suggestGet, (_e, projectPath: string, runId?: string) =>
    runId ? service.suggest.getRun(projectPath, runId) : service.suggest.listRuns(projectPath)
  )
  ipcMain.handle(STYLE_IPC.suggestRegen, async (_e, projectPath: string, runId: string, suggestionId: string | null, feedback?: string) => {
    const run = await service.suggest.getRun(projectPath, runId)
    if (!run) throw new Error(`Suggestion run ${runId} not found`)
    if (service.suggest.isBusy(runId)) throw new Error('This suggestion run is still busy')
    void service.suggest.regen(projectPath, runId, suggestionId, feedback).catch(() => undefined)
    return true
  })
  ipcMain.handle(STYLE_IPC.lock, (_e, req: LockRequest) => service.lock(req))
  ipcMain.handle(STYLE_IPC.modelsGet, () => service.getModels())
  ipcMain.handle(STYLE_IPC.modelsSet, (_e, patch: Partial<TaskModels>) => service.setModels(patch))
  return service
}
