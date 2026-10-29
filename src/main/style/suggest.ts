import { EventEmitter } from 'node:events'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  SUGGEST_DEFAULT,
  SUGGEST_MAX,
  SUGGEST_MIN,
  type ModelChoice,
  type SampleKind,
  type StyleSample,
  type StyleSuggestion,
  type SuggestProgress,
  type SuggestRequest,
  type SuggestRun
} from '@shared/style'
import type { GeneratedImage } from '../codex/service'
import { cleanPalette, cleanStr, extractJson, newId, readJson, safeId, turnFailure, writeJsonAtomic, type StyleCodex } from './common'

const KIND_ORDER: SampleKind[] = ['button', 'icon', 'panel', 'bar', 'character', 'other']

const DIRECTIONS_SCHEMA = {
  type: 'object',
  properties: {
    directions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: { type: 'string' },
          summaryVi: { type: 'string' },
          summaryEn: { type: 'string' },
          palette: { type: 'array', items: { type: 'string' } },
          promptEn: { type: 'string' }
        },
        required: ['name', 'summaryVi', 'summaryEn', 'palette', 'promptEn'],
        additionalProperties: false
      }
    }
  },
  required: ['directions'],
  additionalProperties: false
}

export function suggestionsRoot(projectPath: string): string {
  return join(projectPath, 'styles', 'suggestions')
}

export function pickDiverseSamples(samples: StyleSample[], max = 6): StyleSample[] {
  const valid = samples.filter((s) => s.path && existsSync(s.path))
  const buckets = new Map<SampleKind, StyleSample[]>()
  for (const s of valid) {
    const k = KIND_ORDER.includes(s.kind) ? s.kind : 'other'
    if (!buckets.has(k)) buckets.set(k, [])
    buckets.get(k)?.push(s)
  }
  const out: StyleSample[] = []
  const limit = Math.max(1, Math.min(6, max))
  for (let round = 0; out.length < limit; round++) {
    let added = false
    for (const k of KIND_ORDER) {
      const b = buckets.get(k)
      if (b && b[round] && out.length < limit) {
        out.push(b[round])
        added = true
      }
    }
    if (!added) break
  }
  return out
}

function describeSamples(samples: StyleSample[]): string {
  return samples.map((s, i) => `image ${i + 1}: ${s.kind}${s.name ? ` "${s.name}"` : ''}`).join('; ')
}

export function buildDirectionsPrompt(samples: StyleSample[], refCount: number, prompt: string, count: number, feedback?: string): string {
  return [
    `You are an art director for casual mobile games. The first ${samples.length} attached images are original UI assets from one game (${describeSamples(samples)}).`,
    refCount > 0 ? `The next ${refCount} attached images are style references chosen by the user.` : 'No style reference images were provided.',
    prompt.trim() ? `User wishes (may be Vietnamese): ${prompt.trim()}` : 'The user gave no style wishes; infer good options from the assets and the game genre they suggest.',
    feedback?.trim() ? `Feedback on previous suggestions: ${feedback.trim()}` : '',
    `Propose exactly ${count} clearly different visual reskin directions for this whole asset set.${prompt.trim() ? ' All of them must honour the user wishes; vary material, lighting, outline and palette.' : ''}`,
    'Colors must be vivid and saturated; never pale, washed-out or pastel-glass looks.',
    'For each direction give:',
    '- name: 2 to 4 words, English title case;',
    '- summaryVi: one short Vietnamese sentence (max 22 words) describing the look;',
    '- summaryEn: the same in English;',
    '- palette: 5 or 6 hex colors like #FF3EA5;',
    '- promptEn: a professional English style prompt (70 to 140 words, one paragraph, imperative) describing material, outline, lighting, shading and palette, ending with these constraints: keep the original silhouette, layout and proportions; keep every existing symbol, icon and text exactly; keep semantic role colors (green = confirm/on, red = close/cancel, grey = disabled, blue = secondary); add no extra decorations or background elements.',
    'Do not run commands or create files. Reply ONLY with JSON: {"directions": [{"name","summaryVi","summaryEn","palette","promptEn"}]}'
  ]
    .filter(Boolean)
    .join('\n')
}

export function parseDirections(text: string, count: number): Omit<StyleSuggestion, 'id' | 'previewPath' | 'status' | 'error' | 'durationMs'>[] {
  const arr = extractJson(text, 'array')
  if (!Array.isArray(arr)) throw new Error(`Codex did not return a JSON list of style directions: ${text.slice(0, 200) || '(empty reply)'}`)
  const out = arr
    .map((x) => {
      const o = (x ?? {}) as Record<string, unknown>
      const summary = (o['summary'] ?? {}) as Record<string, unknown>
      const en = cleanStr(o['summaryEn'] ?? summary['en'], 400)
      const vi = cleanStr(o['summaryVi'] ?? summary['vi'], 400)
      return {
        name: cleanStr(o['name'], 80),
        summary: { vi: vi || en, en: en || vi },
        palette: cleanPalette(o['palette']),
        promptEn: cleanStr(o['promptEn'] ?? o['prompt'], 4000)
      }
    })
    .filter((d) => d.name && d.promptEn.length >= 30)
  if (out.length === 0) throw new Error('Codex returned no usable style directions')
  return out.slice(0, count)
}

export function buildPreviewPrompt(s: Pick<StyleSuggestion, 'name' | 'palette' | 'promptEn'>, samples: StyleSample[], refCount: number, feedback?: string): string {
  return [
    'Use your image generation tool to create ONE image: a style preview sheet for a casual mobile game UI reskin.',
    `The first ${samples.length} attached images are the original assets (${describeSamples(samples)}).${refCount > 0 ? ` The last ${refCount} attached images are style references only; do not copy their content.` : ''}`,
    `Redraw each original asset exactly once in the new style "${s.name}": ${s.promptEn}`,
    s.palette.length ? `Key palette: ${s.palette.join(', ')}.` : '',
    'Each redrawn asset must keep its own silhouette, proportions, symbols and any text of the original; do not add new elements and do not merge assets.',
    'Landscape canvas about 16:10. Plain flat light grey background #F2F2F7 filling the whole canvas, no scene, no frame, no gradient, no labels or captions.',
    'Arrange the redrawn assets in a neat evenly spaced grid with generous gaps, every asset fully visible and not overlapping, roughly similar visual weight.',
    'All assets share one consistent style. Colors vivid and saturated, not pale or pastel.',
    feedback?.trim() ? `Reviewer feedback to apply: ${feedback.trim()}` : '',
    'Do not write any code or files yourself; just generate the image and reply with one short sentence.'
  ]
    .filter(Boolean)
    .join(' ')
}

function pickImage(images: GeneratedImage[]): GeneratedImage | null {
  const ok = images.filter((i) => (i.savedPath && existsSync(i.savedPath)) || i.base64)
  return ok.length ? ok[ok.length - 1] : null
}

async function saveImage(img: GeneratedImage, out: string): Promise<void> {
  const bytes = img.savedPath && existsSync(img.savedPath) ? await fs.readFile(img.savedPath) : Buffer.from(img.base64 ?? '', 'base64')
  if (bytes.length < 100) throw new Error('generated image is empty')
  const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
  if (isPng) {
    await fs.writeFile(out, bytes)
    return
  }
  const sharp = (await import('sharp')).default
  await sharp(bytes).png().toFile(out)
}

export interface SuggestDeps {
  codex: StyleCodex
  models: () => ModelChoice
  log?: (m: string) => void
  concurrency?: number
  maxRetries?: number
  imageTimeoutMs?: number
}

interface ActiveRun {
  canceled: boolean
  turns: Map<string, { threadId: string; turnId: string }>
}

export class SuggestService extends EventEmitter {
  private runs = new Map<string, SuggestRun>()
  private active = new Map<string, ActiveRun>()

  constructor(private readonly deps: SuggestDeps) {
    super()
  }

  private log(m: string): void {
    this.deps.log?.(m)
  }

  private emitProgress(p: SuggestProgress): void {
    this.emit('progress', p)
  }

  private async persist(run: SuggestRun): Promise<void> {
    await writeJsonAtomic(join(run.dir, 'suggestions.json'), run)
  }

  async getRun(projectPath: string, runId: string): Promise<SuggestRun | null> {
    const mem = this.runs.get(runId)
    if (mem) return mem
    if (!/^[a-z0-9-]+$/i.test(runId)) return null
    const run = await readJson<SuggestRun>(join(suggestionsRoot(projectPath), runId, 'suggestions.json'))
    if (run) this.runs.set(runId, run)
    return run
  }

  async listRuns(projectPath: string): Promise<SuggestRun[]> {
    const root = suggestionsRoot(projectPath)
    let names: string[] = []
    try {
      names = (await fs.readdir(root, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name)
    } catch {
      return []
    }
    const out: SuggestRun[] = []
    for (const n of names) {
      const r = await this.getRun(projectPath, n)
      if (r) out.push(r)
    }
    return out.sort((a, b) => b.createdAt - a.createdAt)
  }

  async start(req: SuggestRequest): Promise<SuggestRun> {
    const samples = pickDiverseSamples(req.samples)
    if (samples.length === 0) throw new Error('No readable sample images to analyse')
    const refImages = (req.refImages ?? []).filter((p) => existsSync(p)).slice(0, 4)
    const runId = newId('run-')
    const dir = join(suggestionsRoot(req.projectPath), runId)
    await fs.mkdir(dir, { recursive: true })
    const run: SuggestRun = {
      runId,
      projectPath: req.projectPath,
      dir,
      prompt: req.prompt ?? '',
      samples,
      refImages,
      createdAt: Date.now(),
      phase: 'planning',
      error: null,
      suggestions: []
    }
    this.runs.set(runId, run)
    this.active.set(runId, { canceled: false, turns: new Map() })
    await this.persist(run)
    this.emitProgress({ type: 'phase', runId, phase: 'planning' })
    return run
  }

  async execute(run: SuggestRun, count: number, feedback?: string): Promise<SuggestRun> {
    const act = this.active.get(run.runId) ?? { canceled: false, turns: new Map() }
    this.active.set(run.runId, act)
    try {
      const dirs = await this.planDirections(run, count, act, feedback)
      if (act.canceled) return await this.finish(run, 'canceled', null)
      run.suggestions = dirs.map((d, i) => ({
        ...d,
        id: `${String(i + 1).padStart(2, '0')}-${safeId(d.name) || 'style'}`,
        previewPath: null,
        status: 'pending',
        error: null,
        durationMs: null
      }))
      run.phase = 'rendering'
      await this.persist(run)
      this.emitProgress({ type: 'directions', runId: run.runId, suggestions: run.suggestions })
      this.emitProgress({ type: 'phase', runId: run.runId, phase: 'rendering' })
      await this.renderMany(run, run.suggestions.map((s) => s.id), act)
      if (act.canceled) return await this.finish(run, 'canceled', null)
      const okCount = run.suggestions.filter((s) => s.status === 'done').length
      return await this.finish(run, okCount > 0 ? 'done' : 'error', okCount > 0 ? null : 'All preview generations failed')
    } catch (e) {
      return await this.finish(run, act.canceled ? 'canceled' : 'error', (e as Error).message)
    } finally {
      this.active.delete(run.runId)
    }
  }

  async run(req: SuggestRequest): Promise<SuggestRun> {
    const run = await this.start(req)
    const count = Math.max(SUGGEST_MIN, Math.min(SUGGEST_MAX, Math.round(req.count ?? SUGGEST_DEFAULT)))
    return this.execute(run, count, req.feedback)
  }

  private async finish(run: SuggestRun, phase: SuggestRun['phase'], error: string | null): Promise<SuggestRun> {
    run.phase = phase
    run.error = error
    await this.persist(run).catch(() => undefined)
    this.emitProgress({ type: 'phase', runId: run.runId, phase, error })
    if (error) this.log(`suggest ${run.runId} ${phase}: ${error}`)
    return run
  }

  private async planDirections(run: SuggestRun, count: number, act: ActiveRun, feedback?: string): Promise<ReturnType<typeof parseDirections>> {
    const m = this.deps.models()
    const threadId = await this.deps.codex.startThread({ cwd: run.dir, model: m.model, sandbox: 'read-only', ephemeral: true })
    let streamed = ''
    const input = [
      { type: 'text' as const, text: buildDirectionsPrompt(run.samples, run.refImages.length, run.prompt, count, feedback), text_elements: [] as [] },
      ...run.samples.map((s) => ({ type: 'localImage' as const, path: s.path })),
      ...run.refImages.map((p) => ({ type: 'localImage' as const, path: p }))
    ]
    const r = await this.deps.codex.runTurn(threadId, input, {
      model: m.model,
      effort: m.effort,
      sandboxPolicy: { type: 'readOnly', networkAccess: false },
      outputSchema: DIRECTIONS_SCHEMA,
      timeoutMs: 240000,
      onTurnStarted: (turnId) => act.turns.set('plan', { threadId, turnId }),
      onDelta: (d) => {
        streamed += d
        this.emitProgress({ type: 'delta', runId: run.runId, text: streamed })
      }
    })
    act.turns.delete('plan')
    const fail = turnFailure(r)
    if (fail) throw new Error(`Style suggestion failed: ${fail}`)
    return parseDirections(r.agentText || streamed, count)
  }

  private async renderMany(run: SuggestRun, ids: string[], act: ActiveRun, feedback?: string): Promise<void> {
    const queue = [...ids]
    const limit = Math.max(1, Math.min(2, this.deps.concurrency ?? 2))
    const worker = async (): Promise<void> => {
      while (queue.length && !act.canceled) {
        const id = queue.shift()
        if (id) await this.renderOne(run, id, act, feedback)
      }
    }
    await Promise.all(Array.from({ length: Math.min(limit, ids.length) }, (_, i) => new Promise<void>((res) => setTimeout(res, i * 1500)).then(worker)))
  }

  private update(run: SuggestRun, s: StyleSuggestion, patch: Partial<StyleSuggestion>): void {
    Object.assign(s, patch)
    this.emitProgress({ type: 'direction', runId: run.runId, suggestion: { ...s } })
  }

  private async renderOne(run: SuggestRun, id: string, act: ActiveRun, feedback?: string): Promise<void> {
    const s = run.suggestions.find((x) => x.id === id)
    if (!s) return
    const started = Date.now()
    this.update(run, s, { status: 'running', error: null })
    const m = this.deps.models()
    const prompt = buildPreviewPrompt(s, run.samples, run.refImages.length, feedback)
    const images = [...run.samples.map((x) => x.path), ...run.refImages]
    const attempts = 1 + Math.max(0, this.deps.maxRetries ?? 1)
    let lastErr = 'unknown error'
    for (let a = 1; a <= attempts && !act.canceled; a++) {
      try {
        let threadId = ''
        const r = await this.deps.codex.generateImage({ cwd: run.dir, model: m.model, ephemeral: true }, prompt, images, {
          model: m.model,
          effort: m.effort,
          timeoutMs: this.deps.imageTimeoutMs ?? 300000,
          onThreadStarted: (t) => {
            threadId = t
          },
          onTurnStarted: (turnId) => act.turns.set(id, { threadId, turnId })
        })
        act.turns.delete(id)
        const img = pickImage(r.images)
        if (!img) {
          const failure = r.images.find((i) => i.failure)?.failure
          throw new Error(turnFailure(r) ?? (failure ? `image generation failed: ${JSON.stringify(failure).slice(0, 300)}` : 'turn completed without an image'))
        }
        const file = join(run.dir, s.previewPath ? `${id}-${Date.now().toString(36)}.png` : `${id}.png`)
        await saveImage(img, file)
        this.update(run, s, { status: 'done', previewPath: file, error: null, durationMs: Date.now() - started })
        await this.persist(run)
        this.log(`suggest ${run.runId}/${id} preview ok in ${Date.now() - started} ms (attempt ${a})`)
        return
      } catch (e) {
        lastErr = (e as Error).message
        this.log(`suggest ${run.runId}/${id} attempt ${a} failed: ${lastErr}`)
      }
    }
    this.update(run, s, { status: 'error', error: act.canceled ? 'canceled' : lastErr, durationMs: Date.now() - started })
    await this.persist(run)
  }

  async regen(projectPath: string, runId: string, suggestionId: string | null, feedback?: string): Promise<SuggestRun> {
    const run = await this.getRun(projectPath, runId)
    if (!run) throw new Error(`Suggestion run ${runId} not found`)
    if (this.active.has(runId)) throw new Error('This suggestion run is still busy')
    const ids = suggestionId ? [suggestionId] : run.suggestions.map((s) => s.id)
    if (suggestionId && !run.suggestions.some((s) => s.id === suggestionId)) throw new Error(`Suggestion ${suggestionId} not found`)
    const act: ActiveRun = { canceled: false, turns: new Map() }
    this.active.set(runId, act)
    try {
      run.phase = 'rendering'
      this.emitProgress({ type: 'phase', runId, phase: 'rendering' })
      await this.renderMany(run, ids, act, feedback)
      const ok = run.suggestions.some((s) => s.status === 'done')
      return await this.finish(run, act.canceled ? 'canceled' : ok ? 'done' : 'error', ok || act.canceled ? null : 'All preview generations failed')
    } finally {
      this.active.delete(runId)
    }
  }

  async cancel(runId: string): Promise<void> {
    const act = this.active.get(runId)
    if (!act) return
    act.canceled = true
    await Promise.all([...act.turns.values()].map((t) => this.deps.codex.interrupt(t.threadId, t.turnId)))
  }

  isBusy(runId: string): boolean {
    return this.active.has(runId)
  }
}
