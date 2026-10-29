import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { LogFn } from '../logger'

export interface RpcNotification {
  method: string
  params: Record<string, unknown>
}

export class RpcError extends Error {
  constructor(
    message: string,
    readonly code: number | null,
    readonly data: unknown = null
  ) {
    super(message)
  }
}

interface Pending {
  method: string
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: NodeJS.Timeout | null
}

export interface ConnectionOptions {
  exe: string
  args: string[]
  env: NodeJS.ProcessEnv
  log: LogFn
}

export class AppServerConnection extends EventEmitter {
  private child: ChildProcessWithoutNullStreams | null = null
  private pending = new Map<number, Pending>()
  private nextId = 1
  private buffer = ''
  private closed = false

  constructor(private readonly opts: ConnectionOptions) {
    super()
  }

  get pid(): number | null {
    return this.child?.pid ?? null
  }

  get alive(): boolean {
    return !!this.child && !this.closed
  }

  start(): void {
    const child = spawn(this.opts.exe, this.opts.args, {
      env: this.opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true
    })
    this.child = child
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => this.onData(chunk))
    child.stderr.on('data', (chunk: string) => {
      const text = chunk.replace(/\u001b\[[0-9;]*m/g, '').trim()
      if (text) this.opts.log(`stderr: ${text.slice(0, 2000)}`)
    })
    child.on('error', (err) => {
      this.opts.log(`process error: ${err.message}`)
      this.finish(null, err)
    })
    child.on('exit', (code, signal) => this.finish(code, null, signal))
    child.stdin.on('error', () => undefined)
  }

  request<T = unknown>(method: string, params?: unknown, timeoutMs = 60000): Promise<T> {
    if (!this.child || this.closed) return Promise.reject(new RpcError('codex app-server is not running', null))
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      const timer =
        timeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id)
              reject(new RpcError(`${method} timed out after ${Math.round(timeoutMs / 1000)}s`, null))
            }, timeoutMs)
          : null
      this.pending.set(id, { method, resolve: resolve as (v: unknown) => void, reject, timer })
      this.write(params === undefined ? { id, method } : { id, method, params })
    })
  }

  notify(method: string, params?: unknown): void {
    this.write(params === undefined ? { method } : { method, params })
  }

  respond(id: number | string, result: unknown): void {
    this.write({ id, result })
  }

  respondError(id: number | string, code: number, message: string): void {
    this.write({ id, error: { code, message } })
  }

  async stop(graceMs = 1500): Promise<void> {
    const child = this.child
    if (!child || this.closed) return
    const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
    try {
      child.stdin.end()
    } catch {
      undefined
    }
    const timer = new Promise<'timeout'>((resolve) => setTimeout(() => resolve('timeout'), graceMs))
    const r = await Promise.race([exited.then(() => 'exited' as const), timer])
    if (r === 'timeout') this.killTree()
  }

  killTree(): void {
    const pid = this.child?.pid
    if (!pid || this.closed) return
    if (process.platform === 'win32') {
      spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], { windowsHide: true })
    } else {
      this.child?.kill('SIGKILL')
    }
  }

  private write(obj: unknown): void {
    if (!this.child || this.closed) return
    this.child.stdin.write(`${JSON.stringify(obj)}\n`)
  }

  private onData(chunk: string): void {
    this.buffer += chunk
    let idx: number
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, idx).trim()
      this.buffer = this.buffer.slice(idx + 1)
      if (line) this.onLine(line)
    }
  }

  private onLine(line: string): void {
    let msg: Record<string, unknown>
    try {
      msg = JSON.parse(line) as Record<string, unknown>
    } catch {
      this.opts.log(`bad line: ${line.slice(0, 300)}`)
      return
    }
    const id = msg['id']
    const method = msg['method']
    if ((typeof id === 'number' || typeof id === 'string') && typeof method === 'string') {
      this.emit('serverRequest', { id, method, params: (msg['params'] ?? {}) as Record<string, unknown> })
      return
    }
    if (typeof id === 'number' && this.pending.has(id)) {
      const p = this.pending.get(id)
      this.pending.delete(id)
      if (!p) return
      if (p.timer) clearTimeout(p.timer)
      const err = msg['error'] as { code?: number; message?: string; data?: unknown } | undefined
      if (err) p.reject(new RpcError(err.message ?? `${p.method} failed`, err.code ?? null, err.data ?? null))
      else p.resolve(msg['result'])
      return
    }
    if (typeof method === 'string') {
      this.emit('notification', { method, params: (msg['params'] ?? {}) as Record<string, unknown> } satisfies RpcNotification)
    }
  }

  private finish(code: number | null, err: Error | null, signal?: NodeJS.Signals | null): void {
    if (this.closed) return
    this.closed = true
    const reason = err ? err.message : `codex app-server exited (code ${String(code)}${signal ? `, ${signal}` : ''})`
    for (const [, p] of this.pending) {
      if (p.timer) clearTimeout(p.timer)
      p.reject(new RpcError(reason, null))
    }
    this.pending.clear()
    this.emit('exit', { code, reason })
  }
}
