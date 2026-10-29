import workerPath from '../pipeline/worker?modulePath'
import { PipelineClient, type PipelineClientOptions } from './client'

export { PipelineClient } from './client'
export type { PipelineClientOptions } from './client'
export type { OpArgs, OpResult, PipelineOp } from './ops'
export { CHROMA_COLORS } from './chroma'
export * from './types'

let shared: PipelineClient | null = null

export function getPipeline(options: PipelineClientOptions = {}): PipelineClient {
  if (!shared) shared = new PipelineClient(workerPath, options)
  return shared
}

export async function closePipeline(): Promise<void> {
  const c = shared
  shared = null
  if (c) await c.close()
}
