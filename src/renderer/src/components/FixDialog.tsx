import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useEnv } from '@renderer/store/env'
import { retryContext } from '@renderer/lib/env'
import { Icon } from './Icon'
import { Modal } from './Modal'

export function FixDialog(): ReactElement {
  const { t } = useTranslation()
  const fix = useEnv((s) => s.fix)
  const open = fix.phase !== 'idle'
  const close = (): void => {
    void window.gas.fix.cancel()
  }
  const retry = (): void => {
    const ctx = fix.context
    void window.gas.fix.cancel().then(() => retryContext(ctx))
  }
  const busy = fix.phase === 'analyzing' || fix.phase === 'applying'

  return (
    <Modal open={open} onClose={busy ? undefined : close} className="wide" label={t('fix.title')}>
      <h2>
        <span className="dlg-ic">
          <Icon name="sparkles" size={22} />
        </span>
        {t('fix.title')}
      </h2>
      <h4>{t('fix.error')}</h4>
      <pre className="cmd err">{fix.context?.error ?? ''}</pre>

      {busy && (
        <>
          <div className="fix-wait">
            <span className="spin" />
            {fix.phase === 'analyzing' ? t('fix.analyzing') : t('fix.applying')}
            <span className="chip c-gray">luna · medium</span>
          </div>
          {fix.text && <pre className="cmd stream">{fix.text}</pre>}
        </>
      )}

      {fix.phase === 'proposal' && fix.proposal && (
        <>
          <h4>{t('fix.cause')}</h4>
          <p className="fix-cause">{fix.proposal.cause}</p>
          {fix.proposal.steps.length > 0 && (
            <>
              <h4>{t('fix.proposed')}</h4>
              <ol className="fix-steps">
                {fix.proposal.steps.map((s, i) => (
                  <li key={i}>{s}</li>
                ))}
              </ol>
            </>
          )}
          {fix.proposal.commands.trim() && (
            <>
              <h4>{t('fix.commands')}</h4>
              <pre className="cmd">{fix.proposal.commands}</pre>
            </>
          )}
          <div className="tip">
            <Icon name="shield" size={14} />
            <span>{t('fix.tip')}</span>
          </div>
        </>
      )}

      {fix.phase === 'applied' && (
        <>
          <h4>{t('fix.result')}</h4>
          <pre className="cmd">{fix.result}</pre>
          <p className="fix-ok">
            <Icon name="check" size={14} />
            {t('fix.applied')}
          </p>
        </>
      )}

      {fix.phase === 'error' && (
        <>
          <h4>{t('fix.failed')}</h4>
          <pre className="cmd err">{fix.error}</pre>
        </>
      )}

      <div className="acts">
        {fix.phase === 'proposal' && (
          <>
            <button type="button" className="btn ghost" onClick={() => void window.gas.app.exportLog()}>
              <Icon name="download" size={14} />
              {t('setup.exportLog')}
            </button>
            <div className="grow" />
            <button type="button" className="btn" onClick={close}>
              {t('fix.cancel')}
            </button>
            <button type="button" className="btn primary" onClick={() => void window.gas.fix.apply()}>
              <Icon name="check" size={14} />
              {t('fix.apply')}
            </button>
          </>
        )}
        {busy && (
          <button type="button" className="btn" onClick={close}>
            {t('fix.cancel')}
          </button>
        )}
        {(fix.phase === 'applied' || fix.phase === 'error') && (
          <>
            {fix.phase === 'error' && (
              <button type="button" className="btn ghost" onClick={() => void window.gas.app.exportLog()}>
                <Icon name="download" size={14} />
                {t('setup.exportLog')}
              </button>
            )}
            <div className="grow" />
            <button type="button" className="btn" onClick={close}>
              {t('fix.close')}
            </button>
            <button type="button" className="btn primary" onClick={retry}>
              <Icon name="refresh" size={14} />
              {t('fix.retry')}
            </button>
          </>
        )}
      </div>
    </Modal>
  )
}
