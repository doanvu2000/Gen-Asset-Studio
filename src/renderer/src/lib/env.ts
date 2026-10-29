import type { EnvItemId, EnvState, FixContext, SetupStepId } from '@shared/types'

export type EnvKind = 'install' | 'toggle' | 'login' | 'check' | 'pick'

export const ENV_KIND: Record<EnvItemId, EnvKind> = {
  codex: 'install',
  path: 'install',
  longPath: 'toggle',
  login: 'login',
  imageGen: 'check',
  workspace: 'pick'
}

export const ENV_STEP: Record<EnvItemId, SetupStepId | 'testGen'> = {
  codex: 'codex',
  path: 'path',
  longPath: 'longPath',
  login: 'login',
  imageGen: 'testGen',
  workspace: 'workspace'
}

export const CHIP_COLOR: Record<EnvState, string> = {
  installed: 'c-green',
  installing: 'c-blue',
  missing: 'c-gray',
  error: 'c-red'
}

export function mb(bytes: number): string {
  return (bytes / 1048576).toFixed(1)
}

export function retryTarget(target: string): Promise<void> {
  if (target === 'testGen') return window.gas.setup.testGen()
  return window.gas.setup.retry(target as SetupStepId)
}

export function retryContext(ctx: FixContext | null): Promise<void> {
  if (!ctx) return Promise.resolve()
  return retryTarget(ctx.target)
}

export function formatReset(resetsAt: number | null, lang: string): { relative: boolean; text: string } | null {
  if (!resetsAt) return null
  const ms = resetsAt * 1000 - Date.now()
  if (ms <= 0) return { relative: true, text: '0m' }
  if (ms < 24 * 3600 * 1000) {
    const h = Math.floor(ms / 3600000)
    const m = Math.floor((ms % 3600000) / 60000)
    return { relative: true, text: h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m` }
  }
  const d = new Date(resetsAt * 1000)
  return {
    relative: false,
    text: d.toLocaleString(lang === 'vi' ? 'vi-VN' : 'en-GB', { weekday: 'long', hour: '2-digit', minute: '2-digit' })
  }
}

type LooseT = (key: string, params?: Record<string, unknown>) => string

export function tDyn(t: unknown, key: string, params?: Record<string, unknown>): string {
  return (t as LooseT)(key, params)
}
