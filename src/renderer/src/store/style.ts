import { create } from 'zustand'
import { DEFAULT_TASK_MODELS, type StyleTask, type StyleTemplate, type SuggestRun, type TaskModels } from '@shared/style'
import type { ModelInfo } from '@shared/types'

interface StyleStore {
  templates: StyleTemplate[]
  models: TaskModels
  modelList: ModelInfo[]
  runs: Record<string, SuggestRun>
  init: () => () => void
  loadTemplates: () => Promise<void>
  loadModelList: () => Promise<void>
  setModel: (task: StyleTask, model: string, effort: string) => Promise<void>
  resetModels: () => Promise<void>
  loadRun: (projectPath: string, runId: string) => Promise<SuggestRun | null>
  putRun: (run: SuggestRun) => void
}

export const useStyle = create<StyleStore>()((set, get) => ({
  templates: [],
  models: structuredClone(DEFAULT_TASK_MODELS),
  modelList: [],
  runs: {},
  init: () => {
    const g = window.gas
    void g.style.modelsGet().then((models) => set({ models }))
    void get().loadTemplates()
    const off = g.style.onSuggestProgress((p) => {
      const run = get().runs[p.runId]
      if (!run) return
      let next: SuggestRun = run
      if (p.type === 'phase') next = { ...run, phase: p.phase, error: p.error ?? (p.phase === 'error' ? run.error : null) }
      else if (p.type === 'directions') next = { ...run, suggestions: p.suggestions }
      else if (p.type === 'direction') {
        const has = run.suggestions.some((s) => s.id === p.suggestion.id)
        next = { ...run, suggestions: has ? run.suggestions.map((s) => (s.id === p.suggestion.id ? p.suggestion : s)) : [...run.suggestions, p.suggestion] }
      } else return
      set({ runs: { ...get().runs, [p.runId]: next } })
    })
    return off
  },
  loadTemplates: async () => {
    const templates = await window.gas.style.templates().catch(() => [] as StyleTemplate[])
    set({ templates })
  },
  loadModelList: async () => {
    if (get().modelList.length) return
    const modelList = await window.gas.account.models().catch(() => [] as ModelInfo[])
    set({ modelList: modelList.filter((m) => !m.hidden) })
  },
  setModel: async (task, model, effort) => {
    const models = await window.gas.style.modelsSet({ [task]: { model, effort } })
    set({ models })
  },
  resetModels: async () => {
    const models = await window.gas.style.modelsSet(structuredClone(DEFAULT_TASK_MODELS))
    set({ models })
  },
  loadRun: async (projectPath, runId) => {
    const run = await window.gas.style.suggestGet(projectPath, runId).catch(() => null)
    if (run) set({ runs: { ...get().runs, [runId]: run } })
    return run
  },
  putRun: (run) => set({ runs: { ...get().runs, [run.runId]: run } })
}))
