import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp } from '@renderer/store/app'
import { useEnv } from '@renderer/store/env'

const MODEL = 'luna'
const EFFORT = 'medium'

export function StatusBar(): ReactElement {
  const { t } = useTranslation()
  const route = useApp((s) => s.route)
  const openSettings = useApp((s) => s.openSettings)
  const env = useEnv((s) => s.env)
  const setupRunning = useEnv((s) => !!s.setup?.running)
  const workspace = useApp((s) => s.settings.workspace)
  const year = new Date().getFullYear()

  const items = env?.items ?? []
  const ok = items.filter((i) => i.state === 'installed').length
  const hasErr = items.some((i) => i.state === 'error')
  const busy = items.some((i) => i.state === 'installing')
  const dot = hasErr ? 'err' : busy ? 'run' : ok < items.length ? 'warn' : ''

  return (
    <footer className="status">
      {route === 'setup' ? (
        <span className="seg-i">
          <span className={setupRunning ? 'dot run' : 'dot warn'} />
          {t('status.notReady')}
        </span>
      ) : (
        <>
          <button type="button" className="st-btn" title={t('status.environmentTitle')} onClick={() => openSettings('env')}>
            <span className={dot ? `dot ${dot}` : 'dot'} />
            {t('status.environment', { ok, total: items.length || 6 })}
            {hasErr && ` · ${t('status.hasErrors')}`}
          </button>
          <span className="seg-i">
            Codex · {MODEL} · {EFFORT}
          </span>
          <span className="seg-i">
            <span className="dot idle" />
            {t('status.queueIdle')}
          </span>
        </>
      )}
      <div className="grow" />
      {route !== 'setup' && workspace && <span className="mono st-ws">{workspace}</span>}
      <span>{t('status.copyright', { year })}</span>
    </footer>
  )
}
