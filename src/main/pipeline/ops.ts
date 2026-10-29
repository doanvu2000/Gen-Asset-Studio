import { removeBackground } from './background'
import { extractMainBlock } from './blocks'
import { pickChroma, resolveChroma } from './chroma'
import { fitToOriginal } from './fit'
import { decode, encodePng, hasAlphaChannel } from './image'
import { processAsset, scale } from './process'
import { qa } from './qa'
import type {
  ChromaColor,
  ChromaPick,
  ExtractInfo,
  ExtractOptions,
  FitInfo,
  FitOptions,
  ImageInput,
  PickChromaOptions,
  ProcessInput,
  ProcessResult,
  QaOptions,
  QaReport,
  RemoveBackgroundInfo,
  RemoveBackgroundOptions,
  ScaleFactor
} from './types'

export const ops = {
  pickChroma: (a: { source: ImageInput; styleRefs?: ImageInput[]; options?: PickChromaOptions }): Promise<ChromaPick> =>
    pickChroma(a.source, a.styleRefs ?? [], a.options),
  removeBackground: async (a: {
    ai: ImageInput
    chroma: ChromaColor | string
    options?: RemoveBackgroundOptions
  }): Promise<{ png: Uint8Array; info: RemoveBackgroundInfo }> => {
    const r = removeBackground(await decode(a.ai), resolveChroma(a.chroma).rgb, a.options)
    return { png: await encodePng(r.image), info: r.info }
  },
  extractMainBlock: async (a: { image: ImageInput; options?: ExtractOptions }): Promise<{ png: Uint8Array; info: ExtractInfo }> => {
    const r = extractMainBlock(await decode(a.image), a.options)
    return { png: await encodePng(r.image), info: r.info }
  },
  fitToOriginal: async (a: {
    image: ImageInput
    original: ImageInput
    options?: FitOptions
  }): Promise<{ png: Uint8Array; info: FitInfo }> => {
    const r = await fitToOriginal(await decode(a.image), await decode(a.original), a.options)
    return { png: await encodePng(r.image), info: r.info }
  },
  scale: (a: { png: ImageInput; factor: ScaleFactor }): Promise<Uint8Array> => scale(a.png, a.factor),
  qa: async (a: { result: ImageInput; original: ImageInput; options?: QaOptions }): Promise<QaReport> =>
    qa(await decode(a.result), await decode(a.original), await hasAlphaChannel(a.result), a.options),
  processAsset: (a: ProcessInput): Promise<ProcessResult> => processAsset(a)
}

export type PipelineOps = typeof ops
export type PipelineOp = keyof PipelineOps
export type OpArgs<K extends PipelineOp> = Parameters<PipelineOps[K]>[0]
export type OpResult<K extends PipelineOp> = Awaited<ReturnType<PipelineOps[K]>>

export interface WorkerRequest {
  id: number
  op: PipelineOp
  args: unknown
}

export type WorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string }
