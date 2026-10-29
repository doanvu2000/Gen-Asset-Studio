import type { ModelChoice, PromptPolishRequest, PromptPolishResult } from '@shared/style'
import { cleanStr, extractJson, turnFailure, type StyleCodex } from './common'

const SCHEMA = {
  type: 'object',
  properties: {
    promptEn: { type: 'string' },
    changes: { type: 'array', items: { type: 'string' } }
  },
  required: ['promptEn', 'changes'],
  additionalProperties: false
}

const INSTRUCTIONS = [
  'You are a senior prompt engineer for an app that reskins 2D casual mobile game UI assets (buttons, panels, popups, icons, bars, tabs, toggles, characters) with an image generation model.',
  'You only rewrite text. Do not run commands, do not read or write files, do not generate images.'
].join('\n')

export function buildPolishPrompt(req: PromptPolishRequest): string {
  const target =
    req.context === 'regenNote'
      ? 'The text is a reviewer note asking to adjust ONE already generated asset. Rewrite it as a short, precise English correction instruction for the image model (what to change and what to keep).'
      : 'The text describes the visual style for a whole group of game UI assets. Rewrite it as a professional English style prompt for reskinning 2D casual game UI.'
  return [
    target,
    'The input may be Vietnamese, rough English or a mix. Translate faithfully and keep every intent of the user; do not invent a different style.',
    'Write clear imperative sentences covering, when relevant: material and rendering (e.g. glossy, jelly, wood), outline weight and color, lighting and highlights, shading, palette with vivid saturated colors (never pale or pastel unless the user explicitly asks), mood.',
    'Always append these fixed constraints in natural English: keep the original silhouette, layout and proportions; keep every existing symbol, icon and text exactly; keep semantic role colors (green = confirm/on, red = close/cancel, grey = disabled, blue = secondary); add no extra decorations or background elements; render on a flat solid chroma-key background that does not appear in the asset.',
    'Keep it under 160 words, one paragraph, no markdown, no lists, no quotes.',
    `In "changes" list 2 to 6 very short notes (max 12 words each, written in ${req.lang === 'en' ? 'English' : req.lang === 'vi' ? 'Vietnamese' : 'the same language as the user input'}) describing what you fixed or added.`,
    'Reply ONLY with JSON: {"promptEn": string, "changes": string[]}',
    '',
    'User text:',
    req.prompt.trim()
  ].join('\n')
}

export function parsePolish(text: string): PromptPolishResult {
  const v = extractJson(text, 'object') as Record<string, unknown> | null
  if (!v) throw new Error(`Codex did not return JSON for the polished prompt: ${text.slice(0, 200) || '(empty reply)'}`)
  const promptEn = cleanStr(v['promptEn'] ?? v['prompt'], 4000)
  if (promptEn.length < 20) throw new Error('Codex returned an empty or too short polished prompt')
  if (/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i.test(promptEn)) {
    throw new Error('Codex returned a polished prompt that is not in English')
  }
  const rawChanges = Array.isArray(v['changes']) ? (v['changes'] as unknown[]) : []
  const changes = rawChanges.map((c) => cleanStr(c, 160)).filter(Boolean).slice(0, 8)
  return { promptEn, changes }
}

export async function polishPrompt(
  codex: StyleCodex,
  req: PromptPolishRequest,
  opts: { cwd: string; models: ModelChoice; timeoutMs?: number; onDelta?: (t: string) => void }
): Promise<PromptPolishResult> {
  if (!req.prompt || !req.prompt.trim()) throw new Error('Prompt is empty')
  const threadId = await codex.startThread({
    cwd: opts.cwd,
    model: opts.models.model,
    sandbox: 'read-only',
    ephemeral: true,
    developerInstructions: INSTRUCTIONS
  })
  let streamed = ''
  const r = await codex.runTurn(threadId, [{ type: 'text', text: buildPolishPrompt(req), text_elements: [] }], {
    model: opts.models.model,
    effort: opts.models.effort,
    sandboxPolicy: { type: 'readOnly', networkAccess: false },
    outputSchema: SCHEMA,
    timeoutMs: opts.timeoutMs ?? 180000,
    onDelta: (d) => {
      streamed += d
      opts.onDelta?.(streamed)
    }
  })
  const fail = turnFailure(r)
  if (fail) throw new Error(`Prompt polish failed: ${fail}`)
  return parsePolish(r.agentText || streamed)
}
