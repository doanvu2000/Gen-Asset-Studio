import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp } from '@renderer/store/app'
import { useEnv } from '@renderer/store/env'
import { useQueue } from '@renderer/store/queue'
import { useStyle } from '@renderer/store/style'
import { modelLabel } from '@renderer/lib/files'

export function StatusBar(): ReactElement {
  const { t } = useTranslation()
  const route = useApp((s) => s.route)
  const openSettings = useApp((s) => s.openSettings)
  const env = useEnv((s) => s.env)
  const setupRunning = useEnv((s) => !!s.setup?.running)
  const workspace = useApp((s) => s.settings.workspace)
  const year = new Date().getFullYear()
  const gen = useStyle((s) => s.models.assetGen)
  const list = useStyle((s) => s.modelList)
  const snap = useQueue((s) => s.snap)
  const drawer = useQueue((s) => s.drawer)
  const setDrawer = useQueue((s) => s.setDrawer)
  const running = snap?.running ?? 0
  const queued = snap?.queued ?? 0
  const qPaused = !!snap?.paused
  const qDot = qPaused ? 'warn' : running ? 'run' : queued ? 'warn' : 'idle'

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
          <button type="button" className="st-btn" title={t('gen.modelHint')} onClick={() => openSettings('gen')}>
            Codex · {modelLabel(gen.model, list)} · {gen.effort}
          </button>
          <button type="button" className={drawer ? 'st-btn on' : 'st-btn'} data-coach="ws-queue" title={t('queue.title')} onClick={() => setDrawer(!drawer)}>
            <span className={`dot ${qDot}`} />
            {snap?.pauseReason === 'quota'
              ? t('status.queueQuota', { queued: queued + running })
              : qPaused && (running || queued)
                ? t('status.queuePaused', { queued: queued + running })
                : running || queued
                  ? t('status.queueBusy', { running, queued })
                  : t('status.queueIdle')}
          </button>
        </>
      )}
      <div className="grow" />
      {route !== 'setup' && workspace && <span className="mono st-ws">{workspace}</span>}
      <span>{t('status.copyright', { year })}</span>
    </footer>
  )
}
