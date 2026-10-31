import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import type { JobErrorCode, JobResult, JobStep, QaSummary, QueueJob } from '@shared/queue'
import type { RateLimits } from '@shared/types'
import type { CodexService, GeneratedImage, TurnResult } from '../codex/service'
import type { PipelineClient } from '../pipeline/client'
import type { LogFn } from '../logger'

export type CodexLike = Pick<CodexService, 'generateImage' | 'interrupt' | 'readRateLimits' | 'on' | 'off'> & {
  rateLimits: RateLimits | null
}

export type PipelineLike = Pick<PipelineClient, 'pickChroma' | 'processAsset'>

export interface GenContext {
  codex: CodexLike
  pipeline: PipelineLike
  log: LogFn
  model: string
  effort: string
  timeoutMs: number
  signal: AbortSignal
  onStep: (step: JobStep, progress: string) => void
  afterRawCopy?: (savedPath: string) => Promise<void>
}

export class JobFailure extends Error {
  constructor(
    readonly code: JobErrorCode,
    message: string,
    readonly resetsAt: number | null = null
  ) {
    super(message)
  }
}

const DEVELOPER_INSTRUCTIONS = [
  'You are an image restyling worker inside Gen Asset Studio.',
  'For every request, call the image generation tool exactly once and produce exactly one image.',
  'Never run shell commands, never write or edit files, never write code.',
  'Reply in English with one short sentence after the image is generated.'
].join(' ')

const reserved = new Set<string>()

export function assetSegments(assetRelPath: string): string[] {
  const parts = assetRelPath.split(/[\\/]+/).filter((p) => p && p !== '.' && p !== '..')
  if (parts.length === 0) throw new JobFailure('io', `invalid asset path: ${assetRelPath}`)
  const last = parts[parts.length - 1]
  const dot = last.lastIndexOf('.')
  parts[parts.length - 1] = dot > 0 ? last.slice(0, dot) : last
  return parts
}

export function versionsDir(projectPath: string, assetRelPath: string): string {
  return join(projectPath, 'versions', ...assetSegments(assetRelPath))
}

export async function reserveVersion(dir: string): Promise<number> {
  await fs.mkdir(dir, { recursive: true })
  const names = await fs.readdir(dir).catch(() => [] as string[])
  let max = 0
  for (const n of names) {
    const m = /^v(\d+)(?:-raw)?\.(?:png|json)$/i.exec(n)
    if (m) max = Math.max(max, Number(m[1]))
  }
  let v = max + 1
  while (reserved.has(`${dir}|${v}`)) v++
  reserved.add(`${dir}|${v}`)
  return v
}

export function releaseVersion(dir: string, v: number): void {
  reserved.delete(`${dir}|${v}`)
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

export interface PromptInput {
  stylePrompt: string
  note?: string
  width: number
  height: number
  chromaName: string
  chromaHex: string
  styleImageCount: number
  refImageCount: number
  nineSlice: boolean
}

export function buildPrompt(p: PromptInput): string {
  const g = gcd(p.width, p.height) || 1
  const ratio = `${p.width / g}:${p.height / g}`
  const lines: string[] = []
  lines.push('Restyle the attached game asset into the target art style. Generate exactly one image with the image generation tool.')
  lines.push('')
  lines.push(`Attachments: image 1 is the SOURCE asset to restyle (${p.width}x${p.height} px).`)
  if (p.styleImageCount > 0) {
    lines.push(
      `Images 2${p.styleImageCount > 1 ? `-${p.styleImageCount + 1}` : ''} are the STYLE LOCK sheet: copy their rendering style, materials, outline weight, shading, gloss and palette, but never copy their objects or layout.`
    )
  }
  if (p.refImageCount > 0) {
    const from = p.styleImageCount + 2
    const to = from + p.refImageCount - 1
    lines.push(`Image${p.refImageCount > 1 ? `s ${from}-${to} are` : ` ${from} is an`} extra style reference${p.refImageCount > 1 ? 's' : ''} only.`)
  }
  lines.push('')
  lines.push('Target style:')
  lines.push(p.stylePrompt.trim() || 'Match the style lock sheet exactly.')
  if (p.note && p.note.trim()) {
    lines.push('')
    lines.push(`Notes for this asset: ${p.note.trim()}`)
  }
  lines.push('')
  lines.push('Hard rules:')
  lines.push('- Keep the same subject, silhouette, proportions, layout and orientation as the source asset.')
  lines.push('- Keep every symbol, icon, glyph and text exactly as in the source: same characters, same position, same reading. Do not add, remove or translate text.')
  lines.push('- Keep semantic role colors: green = confirm / on / done, red = close / cancel / danger, grey = disabled, blue = secondary. White masks stay pure white.')
  lines.push('- Add no extra elements: no new icons, sparkles, stars, characters, frames, labels, buttons or background objects.')
  if (p.nineSlice) {
    lines.push('- This is a nine-slice asset: keep the middle area plain and evenly stretchable, with no decoration in the center; detail belongs only to the border and corners.')
  }
  lines.push(
    `- Background: fill the entire canvas with one ${p.chromaName}, exact hex ${p.chromaHex}. No gradient, vignette, texture, floor, reflection or cast shadow on the background. Never use this color inside the asset.`
  )
  lines.push('- No drop shadow, glow or particle may touch the canvas edges; leave a clear margin of background on every side.')
  lines.push(`- Center the asset on the canvas. The output canvas must have the same aspect ratio as the source (${ratio}).`)
  lines.push('- Crisp clean anti-aliased edges, no pixel-art stair-stepping, no blur.')
  lines.push('')
  lines.push('Do not write code, files or scripts.')
  return lines.join('\n')
}

function classifyTurn(r: TurnResult): JobFailure | null {
  const failures = r.images.map((i) => i.failure).filter((f) => f !== null && f !== undefined)
  const blob = JSON.stringify([r.errorInfo, failures, r.error ?? ''])
  let resetsAt: number | null = null
  for (const f of failures) {
    const v = (f as Record<string, unknown>)['resetsAt']
    if (typeof v === 'number') resetsAt = v
  }
  if (/usageLimitExceeded|usage_limit|credits_depleted|usageLimitReached/i.test(blob)) {
    return new JobFailure('quota', `Codex usage limit reached${r.error ? `: ${r.error}` : ''}`, resetsAt)
  }
  if (/rateLimitExceeded|rate_limit/i.test(blob)) {
    return new JobFailure('rateLimited', `Codex rate limited${r.error ? `: ${r.error}` : ''}`, resetsAt)
  }
  if (r.error && /timed out/i.test(r.error)) return new JobFailure('timeout', r.error)
  if (failures.length > 0 && !r.images.some(usable)) {
    return new JobFailure('imageGenFailed', `image generation failed: ${JSON.stringify(failures[0]).slice(0, 400)}`)
  }
  if (r.status !== 'completed') {
    const code: JobErrorCode = /serverOverloaded|httpConnectionFailed|ECONN|not running|crash/i.test(blob) ? 'codex' : 'imageGenFailed'
    return new JobFailure(code, `Codex turn ${r.status}: ${r.error ?? 'no detail'}`)
  }
  if (!r.images.some(usable)) return new JobFailure('noImage', r.error ?? 'Codex finished the turn without producing an image')
  return null
}

function usable(i: GeneratedImage): boolean {
  if (i.failure) return false
  return (!!i.savedPath && existsSync(i.savedPath)) || !!i.base64
}

function toQaSummary(q: { pass: boolean; checks: QaSummary['checks'] }): QaSummary {
  return { pass: q.pass, checks: q.checks.map((c) => ({ id: c.id, status: c.status, value: c.value, threshold: c.threshold, message: c.message })) }
}

export async function runGenJob(job: QueueJob, ctx: GenContext): Promise<JobResult> {
  const timings: Record<string, number> = {}
  let t = Date.now()
  const lap = (k: string): void => {
    const now = Date.now()
    timings[k] = now - t
    t = now
  }
  const checkAbort = (): void => {
    if (ctx.signal.aborted) throw new JobFailure('canceled', 'job canceled')
  }
  if (!existsSync(job.sourcePath)) throw new JobFailure('sourceMissing', `source file not found: ${job.sourcePath}`)
  const styleImages = job.styleImages.filter((p) => existsSync(p))
  const refImages = (job.refImages ?? []).filter((p) => existsSync(p))
  if (styleImages.length !== job.styleImages.length) ctx.log(`job ${job.id}: some style images are missing`)

  ctx.onStep('chroma', 'picking chroma color')
  const meta = await sharp(job.sourcePath).metadata()
  const width = meta.width ?? 0
  const height = meta.height ?? 0
  if (!width || !height) throw new JobFailure('sourceMissing', `cannot read source size: ${job.sourcePath}`)
  const chroma = await ctx.pipeline.pickChroma({ source: job.sourcePath, styleRefs: [...styleImages, ...refImages] })
  lap('chroma')
  checkAbort()

  ctx.onStep('prompt', 'building prompt')
  const dir = versionsDir(job.projectPath, job.assetRelPath)
  const version = await reserveVersion(dir)
  try {
    const prompt = buildPrompt({
      stylePrompt: job.stylePrompt,
      note: job.note,
      width,
      height,
      chromaName: chroma.promptName,
      chromaHex: chroma.hex,
      styleImageCount: styleImages.length,
      refImageCount: refImages.length,
      nineSlice: job.nineSlice === true
    })
    const model = job.model || ctx.model
    const effort = job.effort || ctx.effort

    ctx.onStep('codex', `sending to Codex (${model} · ${effort})`)
    let threadId = ''
    let turnId = ''
    const onAbort = (): void => {
      if (threadId && turnId) void ctx.codex.interrupt(threadId, turnId)
    }
    ctx.signal.addEventListener('abort', onAbort)
    let turn: TurnResult
    try {
      turn = await ctx.codex.generateImage(
        { cwd: dir, model, developerInstructions: DEVELOPER_INSTRUCTIONS },
        prompt,
        [job.sourcePath, ...styleImages, ...refImages],
        {
          model,
          effort,
          timeoutMs: ctx.timeoutMs,
          onThreadStarted: (id) => {
            threadId = id
          },
          onTurnStarted: (id) => {
            turnId = id
            ctx.onStep('image', 'waiting for image')
            if (ctx.signal.aborted) onAbort()
          }
        }
      )
    } catch (e) {
      checkAbort()
      throw new JobFailure('codex', `Codex request failed: ${(e as Error).message}`)
    } finally {
      ctx.signal.removeEventListener('abort', onAbort)
    }
    lap('codex')
    checkAbort()
    const failure = classifyTurn(turn)
    if (failure) throw failure
    const image = turn.images.find(usable) as GeneratedImage

    ctx.onStep('save', 'saving raw image')
    const rawPath = join(dir, `v${version}-raw.png`)
    if (image.savedPath && existsSync(image.savedPath)) {
      await fs.copyFile(image.savedPath, rawPath)
      if (ctx.afterRawCopy) await ctx.afterRawCopy(image.savedPath).catch(() => undefined)
    } else await fs.writeFile(rawPath, Buffer.from(image.base64 ?? '', 'base64'))
    lap('saveRaw')
    checkAbort()

    ctx.onStep('background', 'removing background, fitting, QA')
    let processed
    try {
      processed = await ctx.pipeline.processAsset({
        ai: rawPath,
        original: job.sourcePath,
        options: {
          chroma: chroma.hex,
          fit: { nineSlice: job.nineSlice ?? 'auto', edgeAnchored: job.edgeAnchored ?? 'auto', name: job.assetRelPath }
        }
      })
    } catch (e) {
      throw new JobFailure('pipeline', `image pipeline failed: ${(e as Error).message.split('\n')[0]}`)
    }
    lap('pipeline')
    checkAbort()

    ctx.onStep('save', 'saving version')
    const versionPath = join(dir, `v${version}.png`)
    const metaPath = join(dir, `v${version}.json`)
    await fs.writeFile(versionPath, processed.png1x)
    const qa = toQaSummary(processed.qa)
    const record = {
      version,
      jobId: job.id,
      attempt: job.attempt,
      createdAt: new Date().toISOString(),
      asset: job.assetRelPath,
      source: job.sourcePath,
      sourceSize: { width, height },
      groupId: job.groupId,
      styleImages,
      refImages,
      note: job.note ?? null,
      prompt,
      model,
      effort,
      chroma: { name: chroma.name, hex: chroma.hex, scores: chroma.scores },
      threadId: turn.threadId,
      turnId: turn.turnId,
      revisedPrompt: image.revisedPrompt,
      codexImagePath: image.savedPath,
      raw: `v${version}-raw.png`,
      output: `v${version}.png`,
      fit: processed.debug.fit,
      background: processed.debug.background,
      qa,
      timings: { ...timings, turnMs: turn.durationMs, pipelineSteps: processed.debug.timingsMs }
    }
    await fs.writeFile(metaPath, JSON.stringify(record, null, 2), 'utf8')
    return { version, versionPath, rawPath, metaPath, qa }
  } finally {
    releaseVersion(dir, version)
  }
}
