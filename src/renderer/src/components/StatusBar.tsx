import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp } from '@renderer/store/app'

const ENV_TOTAL = 6
const MODEL = 'luna'
const EFFORT = 'medium'

export function StatusBar(): ReactElement {
  const { t } = useTranslation()
  const route = useApp((s) => s.route)
  const navigate = useApp((s) => s.navigate)
  const year = new Date().getFullYear()

  return (
    <footer className="status">
      {route === 'setup' ? (
        <span className="seg-i">
          <span className="dot warn" />
          {t('status.notReady')}
        </span>
      ) : (
        <>
          <button type="button" className="st-btn" title={t('status.environmentTitle')} onClick={() => navigate('setup')}>
            <span className="dot warn" />
            {t('status.environment', { ok: 0, total: ENV_TOTAL })}
          </button>
          <span className="seg-i">Codex · {MODEL} · {EFFORT}</span>
          <span className="seg-i">
            <span className="dot idle" />
            {t('status.queueIdle')}
          </span>
        </>
      )}
      <div className="grow" />
      <span>{t('status.copyright', { year })}</span>
    </footer>
  )
}
