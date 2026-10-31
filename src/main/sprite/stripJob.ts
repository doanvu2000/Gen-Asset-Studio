import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { JobResult, QaSummary, QueueJob } from '@shared/queue'
import type { StripQa } from '@shared/sprite'
import type { GeneratedImage } from '../codex/service'
import { JobFailure, releaseVersion, reserveVersion, versionsDir, type GenContext } from '../queue/GenJob'
import { decode, hexToRgb } from '../pipeline/image'
import { buildNewStripPrompt, composeGuide, fitNewStrip } from './create'
import { buildStripPrompt, composeSource, fitStrip, joinFrames, keyStrip, loadSheet, savePng, stripLayout, uprightFrame } from './strip'

const DEVELOPER_INSTRUCTIONS = [
  'You are a sprite animation restyling worker inside Gen Asset Studio.',
  'For every request, call the image generation tool exactly once and produce exactly one image containing the whole frame grid.',
  'Never run shell commands, never write or edit files, never write code.',
  'Reply in English with one short sentence after the image is generated.'
].join(' ')

function usable(i: GeneratedImage): boolean {
  if (i.failure) return false
  return (!!i.savedPath && existsSync(i.savedPath)) || !!i.base64
}

export function stripQaSummary(q: StripQa): QaSummary {
  return { pass: q.pass, checks: q.checks.map((c) => ({ id: c.id, status: c.status, value: c.value, threshold: c.threshold, message: c.message })) }
}

export async function runStripJob(job: QueueJob, ctx: GenContext): Promise<JobResult> {
  const spec = job.sprite
  if (!spec) throw new JobFailure('io', 'missing sprite spec')
  const checkAbort = (): void => {
    if (ctx.signal.aborted) throw new JobFailure('canceled', 'job canceled')
  }
  if (!existsSync(job.sourcePath)) throw new JobFailure('sourceMissing', `sheet not found: ${job.sourcePath}`)
  if (!spec.frames.length) throw new JobFailure('sourceMissing', 'animation has no frames')
  const styleImages = job.styleImages.filter((p) => existsSync(p))
  const refImages = (job.refImages ?? []).filter((p) => existsSync(p))
  const lockImages = spec.lockImages.filter((p) => existsSync(p))
  const timings: Record<string, number> = {}
  let t = Date.now()
  const lap = (k: string): void => {
    const now = Date.now()
    timings[k] = now - t
    t = now
  }

  ctx.onStep('chroma', 'building frame grid')
  const create = spec.create
  if (create && !existsSync(create.character)) throw new JobFailure('sourceMissing', `character image not found: ${create.character}`)
  const originals = create ? [] : await loadSheet(job.sourcePath).then((sheet) => Promise.all(spec.frames.map((f) => uprightFrame(sheet, f))))
  const layout = create
    ? stripLayout(spec.frames.length, create.cell, create.cell)
    : stripLayout(originals.length, Math.max(...originals.map((o) => o.width)), Math.max(...originals.map((o) => o.height)))
  const dir = versionsDir(job.projectPath, job.assetRelPath)
  const version = await reserveVersion(dir)
  try {
    const srcPath = join(dir, `v${version}-src.png`)
    await savePng(create ? await composeGuide(await decode(create.character), layout) : composeSource(originals, layout), srcPath)
    const chroma = await ctx.pipeline.pickChroma({ source: srcPath, styleRefs: [...lockImages, ...styleImages, ...refImages] })
    lap('compose')
    checkAbort()

    ctx.onStep('prompt', 'building prompt')
    const common = {
      stylePrompt: job.stylePrompt,
      note: job.note,
      anim: spec.anim,
      dir: spec.dir,
      view: spec.view,
      layout,
      chromaName: chroma.promptName,
      chromaHex: chroma.hex,
      lockCount: lockImages.length,
      styleImageCount: styleImages.length,
      refImageCount: refImages.length
    }
    const prompt = create ? buildNewStripPrompt({ ...common, description: create.description }) : buildStripPrompt({
      stylePrompt: job.stylePrompt,
      note: job.note,
      anim: spec.anim,
      dir: spec.dir,
      view: spec.view,
      layout,
      chromaName: chroma.promptName,
      chromaHex: chroma.hex,
      lockCount: lockImages.length,
      styleImageCount: styleImages.length,
      refImageCount: refImages.length
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
    let turn
    try {
      turn = await ctx.codex.generateImage({ cwd: dir, model, developerInstructions: DEVELOPER_INSTRUCTIONS }, prompt, [srcPath, ...lockImages, ...styleImages, ...refImages], {
        model,
        effort,
        timeoutMs: Math.max(ctx.timeoutMs, 300000),
        onThreadStarted: (id) => {
          threadId = id
        },
        onTurnStarted: (id) => {
          turnId = id
          ctx.onStep('image', 'waiting for image')
          if (ctx.signal.aborted) onAbort()
        }
      })
    } catch (e) {
      checkAbort()
      throw new JobFailure('codex', `Codex request failed: ${(e as Error).message}`)
    } finally {
      ctx.signal.removeEventListener('abort', onAbort)
    }
    lap('codex')
    checkAbort()
    const image = turn.images.find(usable)
    if (!image) {
      const blob = JSON.stringify([turn.errorInfo, turn.images.map((i) => i.failure), turn.error ?? ''])
      if (/usageLimitExceeded|usage_limit|credits_depleted|usageLimitReached/i.test(blob)) throw new JobFailure('quota', `Codex usage limit reached${turn.error ? `: ${turn.error}` : ''}`)
      if (/rateLimitExceeded|rate_limit/i.test(blob)) throw new JobFailure('rateLimited', 'Codex rate limited')
      if (turn.error && /timed out/i.test(turn.error)) throw new JobFailure('timeout', turn.error)
      throw new JobFailure('noImage', `${turn.error ?? 'Codex finished the turn without producing an image'}${turn.agentText ? ` — Codex said: ${turn.agentText.slice(0, 300)}` : ''}`)
    }

    ctx.onStep('save', 'saving raw image')
    const rawPath = join(dir, `v${version}-raw.png`)
    if (image.savedPath && existsSync(image.savedPath)) {
      await fs.copyFile(image.savedPath, rawPath)
      if (ctx.afterRawCopy) await ctx.afterRawCopy(image.savedPath).catch(() => undefined)
    } else await fs.writeFile(rawPath, Buffer.from(image.base64 ?? '', 'base64'))
    checkAbort()

    ctx.onStep('background', 'removing background, aligning frames')
    let fit
    try {
      const keyed = await keyStrip(rawPath, layout, hexToRgb(chroma.hex))
      fit = create
        ? await fitNewStrip(keyed, layout, Math.round(create.cell * 0.78), create.cell - Math.max(2, Math.round(create.cell * 0.05)), !/jump/i.test(spec.anim)).then((r) => ({ ...r, offsetX: 0, offsetY: 0 }))
        : await fitStrip(keyed, layout, originals)
    } catch (e) {
      throw new JobFailure('pipeline', `strip pipeline failed: ${(e as Error).message.split('\n')[0]}`)
    }
    lap('pipeline')
    checkAbort()

    ctx.onStep('save', 'saving version')
    const versionPath = join(dir, `v${version}.png`)
    const metaPath = join(dir, `v${version}.json`)
    await savePng(joinFrames(fit.frames), versionPath)
    const record = {
      version,
      kind: 'strip',
      jobId: job.id,
      attempt: job.attempt,
      createdAt: new Date().toISOString(),
      asset: job.assetRelPath,
      source: job.sourcePath,
      sheetId: spec.sheetId,
      animId: spec.animId,
      anim: spec.anim,
      dir: spec.dir,
      frameSizes: fit.frames.map((f) => ({ w: f.width, h: f.height })),
      layout,
      scale: fit.scale,
      offset: { x: fit.offsetX, y: fit.offsetY },
      lockImages,
      styleImages,
      refImages,
      note: job.note ?? null,
      prompt,
      model,
      effort,
      chroma: { name: chroma.name, hex: chroma.hex },
      threadId: turn.threadId,
      turnId: turn.turnId,
      src: `v${version}-src.png`,
      raw: `v${version}-raw.png`,
      output: `v${version}.png`,
      stripQa: fit.qa,
      qa: stripQaSummary(fit.qa),
      timings: { ...timings, turnMs: turn.durationMs }
    }
    await fs.writeFile(metaPath, JSON.stringify(record, null, 2), 'utf8')
    return { version, versionPath, rawPath, metaPath, qa: stripQaSummary(fit.qa) }
  } finally {
    releaseVersion(dir, version)
  }
}
