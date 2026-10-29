export interface LocalizedText {
  vi: string
  en: string
}

export interface StyleTemplate {
  id: string
  name: LocalizedText
  description: LocalizedText
  promptEn: string
  palette: string[]
  chroma: string | null
  builtin: boolean
  dir: string
  previewPath: string | null
  previewSmPath: string | null
  createdAt: number | null
}

export type NineSliceOverride = 'auto' | 'on' | 'off'

export interface StyleGroup {
  id: string
  name: string
  promptEn: string
  notes: string
  templateId?: string
  refImages: string[]
  lockImage?: string
  lockPrompt?: boolean
  assetIds: string[]
  nineSliceOverrides: Record<string, NineSliceOverride>
  suggestRunId?: string
  palette?: string[]
  lockName?: string
  lockedAt?: number
}

export interface StyleSuggestion {
  id: string
  name: string
  summary: LocalizedText
  palette: string[]
  promptEn: string
  previewPath: string | null
  status: 'pending' | 'running' | 'done' | 'error'
  error: string | null
  durationMs: number | null
}

export interface PromptPolishResult {
  promptEn: string
  changes: string[]
}

export type StyleTask = 'promptPolish' | 'styleSuggest' | 'assetGen'

export interface ModelChoice {
  model: string
  effort: string
}

export type TaskModels = Record<StyleTask, ModelChoice>

export const DEFAULT_STYLE_MODEL = 'gpt-6-luna'
export const DEFAULT_STYLE_EFFORT = 'medium'

export const DEFAULT_TASK_MODELS: TaskModels = {
  promptPolish: { model: DEFAULT_STYLE_MODEL, effort: DEFAULT_STYLE_EFFORT },
  styleSuggest: { model: DEFAULT_STYLE_MODEL, effort: DEFAULT_STYLE_EFFORT },
  assetGen: { model: DEFAULT_STYLE_MODEL, effort: DEFAULT_STYLE_EFFORT }
}

export type SampleKind = 'button' | 'panel' | 'icon' | 'bar' | 'character' | 'other'

export interface StyleSample {
  path: string
  kind: SampleKind
  name?: string
}

export interface PromptPolishRequest {
  prompt: string
  context?: 'group' | 'regenNote'
  lang?: 'vi' | 'en'
}

export interface SuggestRequest {
  projectPath: string
  samples: StyleSample[]
  prompt?: string
  refImages?: string[]
  count?: number
  feedback?: string
  avoidNames?: string[]
}

export interface SuggestRun {
  runId: string
  projectPath: string
  dir: string
  prompt: string
  samples: StyleSample[]
  refImages: string[]
  avoidNames?: string[]
  createdAt: number
  phase: 'planning' | 'rendering' | 'done' | 'error' | 'canceled'
  error: string | null
  suggestions: StyleSuggestion[]
}

export type SuggestProgress =
  | { type: 'phase'; runId: string; phase: SuggestRun['phase']; error?: string | null }
  | { type: 'directions'; runId: string; suggestions: StyleSuggestion[] }
  | { type: 'direction'; runId: string; suggestion: StyleSuggestion }
  | { type: 'delta'; runId: string; text: string }

export type LockSource =
  | { kind: 'suggestion'; projectPath: string; runId: string; suggestionId: string }
  | { kind: 'template'; templateId: string }

export interface LockRequest {
  projectPath: string
  group: StyleGroup
  source: LockSource
}

export interface SaveTemplateRequest {
  group: StyleGroup
  projectPath: string
  name: LocalizedText
  description?: LocalizedText
  palette?: string[]
}

export const SUGGEST_MIN = 1
export const SUGGEST_MAX = 6
export const SUGGEST_DEFAULT = 3

export const STYLE_IPC = {
  templatesList: 'style:templates-list',
  templateSave: 'style:template-save',
  templateDelete: 'style:template-delete',
  promptPolish: 'style:prompt-polish',
  suggestStart: 'style:suggest-start',
  suggestCancel: 'style:suggest-cancel',
  suggestGet: 'style:suggest-get',
  suggestRegen: 'style:suggest-regen',
  suggestProgress: 'style:suggest-progress',
  lock: 'style:lock',
  unlock: 'style:unlock',
  modelsGet: 'style:models-get',
  modelsSet: 'style:models-set'
} as const

export interface StyleApi {
  templates: () => Promise<StyleTemplate[]>
  saveTemplate: (req: SaveTemplateRequest) => Promise<StyleTemplate>
  deleteTemplate: (id: string) => Promise<boolean>
  polish: (req: PromptPolishRequest) => Promise<PromptPolishResult>
  suggestStart: (req: SuggestRequest) => Promise<SuggestRun>
  suggestCancel: (runId: string) => Promise<void>
  suggestGet: (projectPath: string, runId: string) => Promise<SuggestRun | null>
  suggestRegen: (projectPath: string, runId: string, suggestionId: string | null, feedback?: string) => Promise<boolean>
  lock: (req: LockRequest) => Promise<StyleGroup>
  unlock: (projectPath: string, group: StyleGroup) => Promise<StyleGroup>
  modelsGet: () => Promise<TaskModels>
  modelsSet: (patch: Partial<TaskModels>) => Promise<TaskModels>
  onSuggestProgress: (cb: (p: SuggestProgress) => void) => () => void
}
