import { parentPort } from 'node:worker_threads'
import { ops, type WorkerRequest, type WorkerResponse } from './ops'

function collectTransfers(value: unknown, out: ArrayBuffer[], seen: Set<unknown>): void {
  if (value === null || typeof value !== 'object' || seen.has(value)) return
  seen.add(value)
  if (value instanceof Uint8Array) {
    if (value.byteOffset === 0 && value.byteLength === value.buffer.byteLength && value.buffer instanceof ArrayBuffer) {
      if (!out.includes(value.buffer)) out.push(value.buffer)
    }
    return
  }
  for (const v of Object.values(value)) collectTransfers(v, out, seen)
}

function own(value: unknown): unknown {
  if (value instanceof Uint8Array) return new Uint8Array(value)
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(own)
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(value)) out[k] = own(v)
  return out
}

const port = parentPort
if (!port) throw new Error('pipeline worker must run in a worker thread')

port.on('message', async (msg: WorkerRequest) => {
  let res: WorkerResponse
  try {
    const fn = ops[msg.op] as (a: unknown) => Promise<unknown>
    if (typeof fn !== 'function') throw new Error(`Unknown pipeline op: ${String(msg.op)}`)
    res = { id: msg.id, ok: true, result: own(await fn(msg.args)) }
  } catch (e) {
    res = { id: msg.id, ok: false, error: e instanceof Error ? (e.stack ?? e.message) : String(e) }
  }
  const transfers: ArrayBuffer[] = []
  collectTransfers(res, transfers, new Set())
  port.postMessage(res, transfers)
})
