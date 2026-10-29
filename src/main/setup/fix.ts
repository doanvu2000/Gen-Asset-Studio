import { EventEmitter } from 'node:events'
import { promises as fs } from 'node:fs'
import { release } from 'node:os'
import { join } from 'node:path'
import type { FixContext, FixProposal, FixSnapshot, Lang } from '@shared/types'
import type { CodexInstaller } from '../codex/installer'
import type { CodexService, SandboxPolicy } from '../codex/service'
import { logger } from '../logger'
import { appDataDir, codexCurrentDir, codexHome, codexReleasesDir, logsDir } from '../paths'

const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    cause: { type: 'string' },
    steps: { type: 'array', items: { type: 'string' } },
    commands: { type: 'string' }
  },
  required: ['cause', 'steps', 'commands'],
  additionalProperties: false
}

function parseProposal(text: string): FixProposal | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    const o = JSON.parse(text.slice(start, end + 1)) as Record<string, unknown>
    const steps = Array.isArray(o['steps']) ? (o['steps'] as unknown[]).map(String) : []
    return { cause: String(o['cause'] ?? ''), steps, commands: String(o['commands'] ?? '') }
  } catch {
    return null
  }
}

export class FixService extends EventEmitter {
  private state: FixSnapshot = { phase: 'idle', context: null, text: '', proposal: null, result: null, error: null }
  private threadId: string | null = null
  private turnId: string | null = null
  private generation = 0

  constructor(
    private readonly codex: CodexService,
    private readonly installer: CodexInstaller,
    private readonly lang: () => Lang
  ) {
    super()
  }

  snapshot(): FixSnapshot {
    return { ...this.state, proposal: this.state.proposal ? { ...this.state.proposal, steps: [...this.state.proposal.steps] } : null }
  }

  async available(): Promise<boolean> {
    if (!(await this.installer.installedVersion())) return false
    try {
      const acc = this.codex.account ?? (await this.codex.readAccount())
      return acc.loggedIn
    } catch {
      return false
    }
  }

  private update(patch: Partial<FixSnapshot>): void {
    this.state = { ...this.state, ...patch }
    this.emit('changed', this.snapshot())
  }

  private writableSandbox(): SandboxPolicy {
    return { type: 'workspaceWrite', writableRoots: [appDataDir], networkAccess: false, excludeTmpdirEnvVar: false, excludeSlashTmp: false }
  }

  private async context(ctx: FixContext): Promise<string> {
    const recent = logger.recent().slice(-120).join('\n')
    let config = ''
    try {
      config = await fs.readFile(join(codexHome, 'config.toml'), 'utf8')
    } catch {
      config = '(missing)'
    }
    const version = await this.installer.installedVersion()
    return [
      `Source: ${ctx.source} / ${ctx.target}`,
      `Error: ${ctx.error}`,
      '',
      `OS: Windows ${release()} ${process.arch}`,
      `App data folder: ${appDataDir}`,
      `Codex CLI: ${version ?? 'not installed'} at ${codexCurrentDir} (releases in ${codexReleasesDir})`,
      `App CODEX_HOME: ${codexHome}`,
      `App log folder: ${logsDir}`,
      '',
      'App CODEX_HOME config.toml:',
      config,
      '',
      'Recent app log:',
      recent
    ].join('\n')
  }

  async start(ctx: FixContext): Promise<void> {
    const gen = ++this.generation
    this.threadId = null
    this.turnId = null
    this.update({ phase: 'analyzing', context: ctx, text: '', proposal: null, result: null, error: null })
    try {
      if (!(await this.available())) throw new Error('Codex CLI is not installed or not signed in')
      const language = this.lang() === 'vi' ? 'Vietnamese' : 'English'
      const threadId = await this.codex.startThread({
        cwd: appDataDir,
        sandbox: 'workspace-write',
        developerInstructions: [
          'You are the built-in repair assistant of Gen Asset Studio, a Windows desktop app that drives Codex CLI to generate 2D game assets.',
          `You may only change files inside ${appDataDir} (this includes the app's Codex config at ${codexHome}).`,
          'Never touch the user home folder, ~/.codex, system settings or the registry. If a fix needs system changes or administrator rights, describe them as manual steps instead of doing them.',
          `Always answer in ${language}. Be concise and concrete.`
        ].join('\n')
      })
      if (gen !== this.generation) return
      this.threadId = threadId
      const prompt = [
        'The app hit the error below. Read the context, inspect the relevant files under the app data folder if useful (read-only for now), find the most likely cause and propose a fix.',
        'Do NOT modify anything in this turn.',
        'Reply ONLY with JSON: {"cause": string, "steps": string[], "commands": string} where "commands" lists the exact config changes or commands you would apply (empty string if none).',
        '',
        await this.context(ctx)
      ].join('\n')
      let streamed = ''
      const r = await this.codex.runTurn(threadId, [{ type: 'text', text: prompt, text_elements: [] }], {
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
        outputSchema: PROPOSAL_SCHEMA,
        timeoutMs: 300000,
        onTurnStarted: (id) => {
          this.turnId = id
        },
        onDelta: (d) => {
          if (gen !== this.generation) return
          streamed += d
          this.update({ text: streamed })
        }
      })
      if (gen !== this.generation) return
      this.turnId = null
      if (r.status !== 'completed') throw new Error(r.error ?? `turn ${r.status}`)
      const text = r.agentText || streamed
      const proposal = parseProposal(text) ?? { cause: text.trim(), steps: [], commands: '' }
      logger.write('fix', `proposal for ${ctx.source}/${ctx.target}: ${proposal.cause.slice(0, 300)}`)
      this.update({ phase: 'proposal', text, proposal })
    } catch (e) {
      if (gen !== this.generation) return
      logger.write('fix', `analyze failed: ${(e as Error).message}`)
      this.update({ phase: 'error', error: (e as Error).message })
    }
  }

  async apply(): Promise<void> {
    const threadId = this.threadId
    if (!threadId || this.state.phase !== 'proposal') return
    const gen = this.generation
    this.update({ phase: 'applying', text: '', result: null, error: null })
    try {
      let streamed = ''
      const r = await this.codex.runTurn(
        threadId,
        [
          {
            type: 'text',
            text: [
              'The user approved your proposal. Apply the fix now.',
              `Only change files inside ${appDataDir}. Skip anything that needs administrator rights or system changes and say so.`,
              'When done, reply with a short plain-text summary of exactly what you changed.'
            ].join('\n'),
            text_elements: []
          }
        ],
        {
          sandboxPolicy: this.writableSandbox(),
          timeoutMs: 600000,
          onTurnStarted: (id) => {
            this.turnId = id
          },
          onDelta: (d) => {
            if (gen !== this.generation) return
            streamed += d
            this.update({ text: streamed })
          }
        }
      )
      if (gen !== this.generation) return
      this.turnId = null
      if (r.status !== 'completed') throw new Error(r.error ?? `turn ${r.status}`)
      const result = (r.agentText || streamed).trim()
      logger.write('fix', `applied: ${result.slice(0, 500)}`)
      this.update({ phase: 'applied', result })
    } catch (e) {
      if (gen !== this.generation) return
      logger.write('fix', `apply failed: ${(e as Error).message}`)
      this.update({ phase: 'error', error: (e as Error).message })
    }
  }

  async cancel(): Promise<void> {
    this.generation++
    const threadId = this.threadId
    const turnId = this.turnId
    this.turnId = null
    if (threadId && turnId) await this.codex.interrupt(threadId, turnId)
    this.update({ phase: 'idle', context: null, text: '', proposal: null, result: null, error: null })
  }
}
