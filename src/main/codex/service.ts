import { app } from 'electron'
import { EventEmitter } from 'node:events'
import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { extname, join } from 'node:path'
import sharp from 'sharp'
import type { AccountInfo, CodexServiceState, ModelInfo, RateLimits, RateWindow } from '@shared/types'
import { codexHome, codexHomeOverridden } from '../paths'
import type { LogFn } from '../logger'
import type { CodexInstaller } from './installer'
import { AppServerConnection, RpcError, type RpcNotification } from './rpc'

export const DEFAULT_MODEL = 'gpt-6-luna'
export const DEFAULT_EFFORT = 'medium'

const CONFIG_TOML = [
  `model = "${DEFAULT_MODEL}"`,
  `model_reasoning_effort = "${DEFAULT_EFFORT}"`,
  'check_for_update_on_startup = false',
  '',
  '[windows]',
  'sandbox = "unelevated"',
  ''
].join('\n')

export type SandboxPolicy =
  | { type: 'readOnly'; networkAccess: boolean }
  | { type: 'workspaceWrite'; writableRoots: string[]; networkAccess: boolean; excludeTmpdirEnvVar: boolean; excludeSlashTmp: boolean }

export interface ThreadOptions {
  cwd: string
  model?: string
  baseInstructions?: string
  developerInstructions?: string
  sandbox?: 'read-only' | 'workspace-write'
  ephemeral?: boolean
}

export interface TurnOptions {
  model?: string
  effort?: string
  sandboxPolicy?: SandboxPolicy
  outputSchema?: unknown
  timeoutMs?: number
  onDelta?: (delta: string, itemId: string) => void
  onTurnStarted?: (turnId: string) => void
  onThreadStarted?: (threadId: string) => void
}

export interface GeneratedImage {
  itemId: string
  status: string | null
  savedPath: string | null
  base64: string | null
  revisedPrompt: string | null
  failure: unknown
}

export interface TurnResult {
  threadId: string
  turnId: string
  status: string
  error: string | null
  errorInfo: unknown
  agentText: string
  images: GeneratedImage[]
  durationMs: number
}

export type UserInput =
  | { type: 'text'; text: string; text_elements: [] }
  | { type: 'localImage'; path: string; detail?: 'auto' | 'low' | 'high' | 'original' }

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

function str(v: unknown): string | null {
  return typeof v === 'string' ? v : null
}

function parseWindow(v: unknown): RateWindow | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  const used = num(o['usedPercent'])
  if (used === null) return null
  return { usedPercent: used, windowDurationMins: num(o['windowDurationMins']), resetsAt: num(o['resetsAt']) }
}

export function parseRateSnapshot(v: unknown): RateLimits | null {
  if (!v || typeof v !== 'object') return null
  const o = v as Record<string, unknown>
  return {
    primary: parseWindow(o['primary']),
    secondary: parseWindow(o['secondary']),
    reachedType: str(o['rateLimitReachedType']),
    planType: str(o['planType']),
    updatedAt: Date.now()
  }
}

function parseAccount(v: unknown): AccountInfo {
  const o = (v ?? {}) as Record<string, unknown>
  const acc = o['account'] as Record<string, unknown> | null | undefined
  if (!acc) return { loggedIn: false, type: null, email: null, planType: null }
  return { loggedIn: true, type: str(acc['type']), email: str(acc['email']), planType: str(acc['planType']) }
}

const CODEX_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp'])

async function codexReadable(p: string): Promise<string> {
  if (CODEX_EXTS.has(extname(p).toLowerCase())) return p
  const dir = join(tmpdir(), 'gas-codex-input')
  await fs.mkdir(dir, { recursive: true })
  const out = join(dir, `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.png`)
  await sharp(p).png().toFile(out)
  return out
}

export class CodexService extends EventEmitter {
  state: CodexServiceState = 'stopped'
  lastError: string | null = null
  account: AccountInfo | null = null
  rateLimits: RateLimits | null = null
  private conn: AppServerConnection | null = null
  private starting: Promise<void> | null = null
  private stopping = false
  private crashes: number[] = []
  private restartTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly installer: CodexInstaller,
    private readonly log: LogFn
  ) {
    super()
    this.setMaxListeners(100)
  }

  get home(): string {
    return codexHome
  }

  async ensureStarted(): Promise<void> {
    if (this.state === 'ready' && this.conn?.alive) return
    if (!this.starting) {
      this.starting = this.launch().finally(() => {
        this.starting = null
      })
    }
    return this.starting
  }

  private setState(state: CodexServiceState, error: string | null = null): void {
    this.state = state
    this.lastError = error
    this.emit('state', state, error)
  }

  private async writeConfig(): Promise<void> {
    if (codexHomeOverridden) return
    await fs.mkdir(codexHome, { recursive: true })
    const file = join(codexHome, 'config.toml')
    if (!existsSync(file)) {
      await fs.writeFile(file, CONFIG_TOML, 'utf8')
      this.log(`wrote ${file}`)
    }
  }

  private async launch(): Promise<void> {
    this.stopping = false
    const exe = this.installer.exePath()
    if (!existsSync(exe)) {
      this.setState('error', 'Codex CLI is not installed')
      throw new Error('Codex CLI is not installed')
    }
    this.setState('starting')
    await this.writeConfig()
    const env: NodeJS.ProcessEnv = { ...process.env, CODEX_HOME: codexHome }
    delete env['CODEX_MANAGED_BY_NPM']
    delete env['ELECTRON_RUN_AS_NODE']
    const conn = new AppServerConnection({ exe, args: ['app-server'], env, log: this.log })
    this.conn = conn
    conn.on('notification', (n: RpcNotification) => this.onNotification(n))
    conn.on('serverRequest', (r: { id: number | string; method: string; params: Record<string, unknown> }) => this.onServerRequest(conn, r))
    conn.on('exit', (e: { code: number | null; reason: string }) => this.onExit(conn, e))
    this.log(`spawn ${exe} app-server (CODEX_HOME=${codexHome})`)
    conn.start()
    try {
      const init = await conn.request<{ userAgent?: string; codexHome?: string }>(
        'initialize',
        {
          clientInfo: { name: 'gen_asset_studio', title: 'Gen Asset Studio', version: app?.getVersion?.() ?? process.env['npm_package_version'] ?? '0.0.0' },
          capabilities: { experimentalApi: true, requestAttestation: false }
        },
        30000
      )
      conn.notify('initialized')
      this.log(`initialized: ${init.userAgent ?? ''} home=${init.codexHome ?? ''}`)
      this.setState('ready')
    } catch (e) {
      const msg = (e as Error).message
      this.setState('error', msg)
      conn.killTree()
      throw e
    }
  }

  private onExit(conn: AppServerConnection, e: { code: number | null; reason: string }): void {
    if (this.conn !== conn) return
    this.conn = null
    this.log(e.reason)
    if (this.stopping) {
      this.setState('stopped')
      return
    }
    this.setState('error', e.reason)
    this.emit('crash', e.reason)
    const now = Date.now()
    this.crashes = this.crashes.filter((t) => now - t < 60000)
    this.crashes.push(now)
    if (this.crashes.length > 4) {
      this.log('app-server crashed repeatedly, not restarting automatically')
      return
    }
    const delay = 1000 * 2 ** (this.crashes.length - 1)
    this.log(`restarting app-server in ${delay} ms`)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      void this.ensureStarted()
        .then(() => this.readAccount().catch(() => null))
        .catch((err: Error) => this.log(`restart failed: ${err.message}`))
    }, delay)
  }

  async stop(): Promise<void> {
    this.stopping = true
    if (this.restartTimer) clearTimeout(this.restartTimer)
    this.restartTimer = null
    const conn = this.conn
    if (!conn) return
    await conn.stop(1500)
    this.conn = null
    this.setState('stopped')
  }

  killNow(): void {
    this.stopping = true
    this.conn?.killTree()
  }

  async restart(): Promise<void> {
    await this.stop()
    await this.ensureStarted()
  }

  private onServerRequest(conn: AppServerConnection, r: { id: number | string; method: string; params: Record<string, unknown> }): void {
    this.log(`server request ${r.method}`)
    if (r.method.endsWith('requestApproval')) {
      conn.respond(r.id, { decision: 'decline' })
      return
    }
    conn.respondError(r.id, -32601, `Gen Asset Studio does not handle ${r.method}`)
  }

  private onNotification(n: RpcNotification): void {
    const p = n.params
    switch (n.method) {
      case 'account/rateLimits/updated': {
        const rl = parseRateSnapshot(p['rateLimits'])
        if (rl) {
          this.rateLimits = rl
          this.emit('rateLimits', rl)
        }
        break
      }
      case 'account/updated': {
        this.log(`account/updated authMode=${String(p['authMode'])} plan=${String(p['planType'])}`)
        if (p['authMode'] === null) {
          this.account = { loggedIn: false, type: null, email: null, planType: null }
          this.rateLimits = null
          this.emit('account', this.account)
        } else {
          void this.readAccount().catch(() => null)
        }
        break
      }
      case 'account/login/completed':
        this.emit('loginCompleted', {
          loginId: str(p['loginId']),
          success: p['success'] === true,
          error: str(p['error'])
        })
        break
      case 'configWarning':
        this.log(`configWarning: ${String(p['summary'] ?? '')} ${String(p['details'] ?? '')}`)
        break
      default:
        break
    }
    this.emit('notification', n)
  }

  async request<T>(method: string, params?: unknown, timeoutMs = 60000): Promise<T> {
    await this.ensureStarted()
    if (!this.conn) throw new RpcError('codex app-server is not running', null)
    return this.conn.request<T>(method, params, timeoutMs)
  }

  async readAccount(refreshToken = false): Promise<AccountInfo> {
    const r = await this.request<unknown>('account/read', { refreshToken }, 30000)
    this.account = parseAccount(r)
    this.emit('account', this.account)
    return this.account
  }

  async readRateLimits(): Promise<RateLimits> {
    const r = await this.request<Record<string, unknown>>('account/rateLimits/read', { excludeResetCreditDetails: true }, 30000)
    const byId = r['rateLimitsByLimitId'] as Record<string, unknown> | undefined
    const rl = parseRateSnapshot(byId?.['codex'] ?? r['rateLimits'])
    if (!rl) throw new Error('rate limits unavailable')
    this.rateLimits = rl
    this.emit('rateLimits', rl)
    return rl
  }

  async listModels(includeHidden = false): Promise<ModelInfo[]> {
    const out: ModelInfo[] = []
    let cursor: string | null = null
    for (let page = 0; page < 10; page++) {
      const r: { data?: Record<string, unknown>[]; nextCursor?: string | null } = await this.request(
        'model/list',
        { includeHidden, limit: 100, ...(cursor ? { cursor } : {}) },
        30000
      )
      for (const m of r.data ?? []) {
        const efforts = Array.isArray(m['supportedReasoningEfforts'])
          ? (m['supportedReasoningEfforts'] as unknown[])
              .map((e) => (typeof e === 'string' ? e : str((e as Record<string, unknown>)['reasoningEffort'])))
              .filter((e): e is string => !!e)
          : []
        out.push({
          id: str(m['id']) ?? '',
          model: str(m['model']) ?? str(m['id']) ?? '',
          displayName: str(m['displayName']) ?? str(m['id']) ?? '',
          isDefault: m['isDefault'] === true,
          hidden: m['hidden'] === true,
          efforts,
          defaultEffort: str(m['defaultReasoningEffort'])
        })
      }
      cursor = r.nextCursor ?? null
      if (!cursor) break
    }
    return out
  }

  async loginStart(): Promise<{ loginId: string; authUrl: string }> {
    const r = await this.request<{ loginId?: string; authUrl?: string }>('account/login/start', { type: 'chatgpt' }, 30000)
    if (!r.loginId || !r.authUrl) throw new Error('login/start returned no authUrl')
    return { loginId: r.loginId, authUrl: r.authUrl }
  }

  async loginCancel(loginId: string): Promise<string> {
    const r = await this.request<{ status?: string }>('account/login/cancel', { loginId }, 15000)
    return r.status ?? 'unknown'
  }

  async logout(): Promise<void> {
    await this.request('account/logout', undefined, 30000)
    this.account = { loggedIn: false, type: null, email: null, planType: null }
    this.rateLimits = null
    this.emit('account', this.account)
  }

  async startThread(opts: ThreadOptions): Promise<string> {
    const params: Record<string, unknown> = {
      cwd: opts.cwd,
      sandbox: opts.sandbox ?? 'workspace-write',
      approvalPolicy: 'never',
      config: { windows: { sandbox: 'unelevated' } },
      ephemeral: opts.ephemeral ?? false
    }
    if (opts.model) params['model'] = opts.model
    if (opts.baseInstructions) params['baseInstructions'] = opts.baseInstructions
    if (opts.developerInstructions) params['developerInstructions'] = opts.developerInstructions
    const r = await this.request<{ thread?: { id?: string } }>('thread/start', params, 60000)
    const id = r.thread?.id
    if (!id) throw new Error('thread/start returned no thread id')
    return id
  }

  async interrupt(threadId: string, turnId: string): Promise<void> {
    await this.request('turn/interrupt', { threadId, turnId }, 15000).catch(() => undefined)
  }

  async runTurn(threadId: string, input: UserInput[], opts: TurnOptions = {}): Promise<TurnResult> {
    await this.ensureStarted()
    const started = Date.now()
    const result: TurnResult = {
      threadId,
      turnId: '',
      status: 'inProgress',
      error: null,
      errorInfo: null,
      agentText: '',
      images: [],
      durationMs: 0
    }
    let lastAgentText = ''
    let resolveDone: () => void = () => undefined
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve
    })
    const onNote = (n: RpcNotification): void => {
      const p = n.params
      if (p['threadId'] !== threadId) return
      if (n.method === 'item/agentMessage/delta') {
        const delta = str(p['delta'])
        if (delta && opts.onDelta) opts.onDelta(delta, str(p['itemId']) ?? '')
        return
      }
      if (n.method === 'item/completed') {
        const item = (p['item'] ?? {}) as Record<string, unknown>
        if (item['type'] === 'agentMessage') lastAgentText = str(item['text']) ?? lastAgentText
        if (item['type'] === 'imageGeneration') {
          result.images.push({
            itemId: str(item['id']) ?? '',
            status: str(item['status']),
            savedPath: str(item['savedPath']),
            base64: str(item['result']),
            revisedPrompt: str(item['revisedPrompt']),
            failure: item['failure'] ?? null
          })
        }
        return
      }
      if (n.method === 'error') {
        const err = (p['error'] ?? {}) as Record<string, unknown>
        if (p['willRetry'] !== true) {
          result.error = str(err['message']) ?? JSON.stringify(err)
          result.errorInfo = err['codexErrorInfo'] ?? null
        }
        return
      }
      if (n.method === 'turn/completed') {
        const turn = (p['turn'] ?? {}) as Record<string, unknown>
        result.turnId = str(turn['id']) ?? result.turnId
        result.status = str(turn['status']) ?? 'completed'
        const terr = turn['error'] as Record<string, unknown> | null | undefined
        if (terr) {
          result.error = str(terr['message']) ?? JSON.stringify(terr)
          result.errorInfo = terr['codexErrorInfo'] ?? result.errorInfo
        }
        resolveDone()
      }
    }
    const onCrash = (reason: string): void => {
      result.status = 'failed'
      result.error = reason
      resolveDone()
    }
    this.on('notification', onNote)
    this.on('crash', onCrash)
    let timer: NodeJS.Timeout | null = null
    try {
      const params: Record<string, unknown> = { threadId, input }
      if (opts.model) params['model'] = opts.model
      if (opts.effort) params['effort'] = opts.effort
      if (opts.sandboxPolicy) params['sandboxPolicy'] = opts.sandboxPolicy
      if (opts.outputSchema) params['outputSchema'] = opts.outputSchema
      const r = await this.request<{ turn?: { id?: string } }>('turn/start', params, 60000)
      result.turnId = r.turn?.id ?? ''
      if (opts.onTurnStarted && result.turnId) opts.onTurnStarted(result.turnId)
      const timeoutMs = opts.timeoutMs ?? 300000
      const timedOut = new Promise<'timeout'>((resolve) => {
        timer = setTimeout(() => resolve('timeout'), timeoutMs)
      })
      const r2 = await Promise.race([done.then(() => 'done' as const), timedOut])
      if (r2 === 'timeout') {
        await this.interrupt(threadId, result.turnId)
        result.status = 'failed'
        result.error = `turn timed out after ${Math.round(timeoutMs / 1000)}s`
      }
    } finally {
      if (timer) clearTimeout(timer)
      this.off('notification', onNote)
      this.off('crash', onCrash)
    }
    result.agentText = lastAgentText
    result.durationMs = Date.now() - started
    return result
  }

  async generateImage(thread: ThreadOptions, prompt: string, imagePaths: string[], turn: TurnOptions = {}): Promise<TurnResult> {
    const threadId = await this.startThread({ sandbox: 'workspace-write', ...thread })
    turn.onThreadStarted?.(threadId)
    const input: UserInput[] = [
      { type: 'text', text: prompt, text_elements: [] },
      ...(await Promise.all(imagePaths.map(codexReadable))).map((p) => ({ type: 'localImage' as const, path: p }))
    ]
    const result = await this.runTurn(threadId, input, { timeoutMs: 240000, ...turn })
    if (result.status === 'completed' && result.images.length === 0 && !result.error) {
      const said = result.agentText.replace(/\s+/g, ' ').trim()
      result.error = said ? `turn completed without an image. Codex said: ${said.slice(0, 500)}` : 'turn completed without an image'
    }
    return result
  }
}
