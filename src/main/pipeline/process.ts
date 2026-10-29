import { removeBackground } from './background'
import { extractMainBlock } from './blocks'
import { CHROMA_COLORS, resolveChroma } from './chroma'
import { fitToOriginal } from './fit'
import { decode, encodePng, rawSharp } from './image'
import { qa } from './qa'
import type { ImageInput, ProcessInput, ProcessResult, ScaleFactor } from './types'

export async function scale(png: ImageInput, factor: ScaleFactor): Promise<Uint8Array> {
  if (factor === 1 && typeof png !== 'string') return png
  const img = await decode(png)
  if (factor === 1) return encodePng(img)
  const buf = await rawSharp(img)
    .resize(img.width * factor, img.height * factor, { fit: 'fill', kernel: 'lanczos3' })
    .png({ compressionLevel: 9, adaptiveFiltering: true })
    .toBuffer()
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
}

export async function processAsset(input: ProcessInput): Promise<ProcessResult> {
  const opts = input.options ?? {}
  const timings: Record<string, number> = {}
  let t = performance.now()
  const lap = (k: string): void => {
    const now = performance.now()
    timings[k] = Math.round(now - t)
    t = now
  }
  const chroma = resolveChroma(opts.chroma ?? CHROMA_COLORS.magenta)
  const [ai, original] = await Promise.all([decode(input.ai), decode(input.original)])
  lap('decode')
  const keyed = removeBackground(ai, chroma.rgb, opts.removeBackground)
  lap('removeBackground')
  const block = extractMainBlock(keyed.image, opts.extract)
  lap('extract')
  const fit = await fitToOriginal(block.image, original, opts.fit)
  lap('fit')
  const report = qa(fit.image, original, true, {
    ...opts.qa,
    edgeAnchored: opts.qa?.edgeAnchored ?? fit.info.edgeAnchored,
    chroma: opts.qa?.chroma ?? keyed.info.bg
  })
  lap('qa')
  const png1x = await encodePng(fit.image)
  const factor = opts.scale ?? 1
  const png = factor === 1 ? png1x : await scale(png1x, factor)
  lap('encode')
  const images = opts.debugImages
    ? { keyed: await encodePng(keyed.image), block: await encodePng(block.image) }
    : undefined
  return {
    png,
    png1x,
    width: original.width * factor,
    height: original.height * factor,
    qa: report,
    debug: { background: keyed.info, extract: block.info, fit: fit.info, timingsMs: timings, images }
  }
}
