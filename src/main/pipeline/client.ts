import { Worker } from 'node:worker_threads'
import type { OpArgs, OpResult, PipelineOp, WorkerRequest, WorkerResponse } from './ops'

export interface PipelineClientOptions {
  size?: number
  execArgv?: string[]
}

interface Pending {
  resolve: (v: unknown) => void
  reject: (e: Error) => void
  slot: Slot
}

interface Slot {
  worker: Worker | null
  busy: number
}

export class PipelineClient {
  private readonly slots: Slot[]
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private closed = false

  constructor(
    private readonly workerFile: string,
    private readonly options: PipelineClientOptions = {}
  ) {
    const size = Math.max(1, Math.min(8, options.size ?? 1))
    this.slots = Array.from({ length: size }, () => ({ worker: null, busy: 0 }))
  }

  call<K extends PipelineOp>(op: K, args: OpArgs<K>): Promise<OpResult<K>> {
    if (this.closed) return Promise.reject(new Error('PipelineClient is closed'))
    const slot = this.slots.reduce((a, b) => (b.busy < a.busy ? b : a))
    const worker = this.ensure(slot)
    const id = this.nextId++
    slot.busy++
    return new Promise<OpResult<K>>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject, slot })
      const req: WorkerRequest = { id, op, args }
      worker.postMessage(req)
    })
  }

  pickChroma(args: OpArgs<'pickChroma'>): Promise<OpResult<'pickChroma'>> {
    return this.call('pickChroma', args)
  }

  removeBackground(args: OpArgs<'removeBackground'>): Promise<OpResult<'removeBackground'>> {
    return this.call('removeBackground', args)
  }

  extractMainBlock(args: OpArgs<'extractMainBlock'>): Promise<OpResult<'extractMainBlock'>> {
    return this.call('extractMainBlock', args)
  }

  fitToOriginal(args: OpArgs<'fitToOriginal'>): Promise<OpResult<'fitToOriginal'>> {
    return this.call('fitToOriginal', args)
  }

  scale(args: OpArgs<'scale'>): Promise<OpResult<'scale'>> {
    return this.call('scale', args)
  }

  qa(args: OpArgs<'qa'>): Promise<OpResult<'qa'>> {
    return this.call('qa', args)
  }

  processAsset(args: OpArgs<'processAsset'>): Promise<OpResult<'processAsset'>> {
    return this.call('processAsset', args)
  }

  async close(): Promise<void> {
    this.closed = true
    const err = new Error('PipelineClient closed')
    for (const p of this.pending.values()) p.reject(err)
    this.pending.clear()
    await Promise.all(
      this.slots.map(async (s) => {
        const w = s.worker
        s.worker = null
        if (w) await w.terminate()
      })
    )
  }

  private ensure(slot: Slot): Worker {
    if (slot.worker) return slot.worker
    const worker = new Worker(this.workerFile, { execArgv: this.options.execArgv })
    worker.on('message', (res: WorkerResponse) => {
      const p = this.pending.get(res.id)
      if (!p) return
      this.pending.delete(res.id)
      p.slot.busy--
      if (res.ok) p.resolve(res.result)
      else p.reject(new Error(res.error))
    })
    const fail = (e: Error): void => {
      if (slot.worker === worker) slot.worker = null
      for (const [id, p] of this.pending) {
        if (p.slot !== slot) continue
        this.pending.delete(id)
        p.reject(e)
      }
      slot.busy = 0
    }
    worker.on('error', fail)
    worker.on('exit', (code) => {
      if (!this.closed && code !== 0) fail(new Error(`pipeline worker exited with code ${code}`))
      else if (slot.worker === worker) slot.worker = null
    })
    slot.worker = worker
    return worker
  }
}
