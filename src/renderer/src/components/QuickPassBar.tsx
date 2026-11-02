import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from './Icon'

export function QuickPassBar({ done, total, onExit, className }: { done: number; total: number; onExit: () => void; className?: string }): ReactElement {
  const { t } = useTranslation()
  return (
    <div className={className ? `qp-bar ${className}` : 'qp-bar'} role="status">
      <Icon name="eye" size={13} />
      <b>{t('quickPass.title')}</b>
      <div className="qp-track" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
        <i style={{ width: `${total ? (done / total) * 100 : 0}%` }} />
      </div>
      <span className="mono">{t('quickPass.progress', { k: Math.min(done + 1, total), n: total })}</span>
      <span className="muted qp-hint">{t('quickPass.hint')}</span>
      <button type="button" className="btn sm ghost" onClick={onExit}>
        <Icon name="x" size={13} />
        {t('quickPass.exit')}
      </button>
    </div>
  )
}

export function BulkApproveQa({ count, onConfirm }: { count: number; onConfirm: () => void }): ReactElement {
  const { t } = useTranslation()
  const [asking, setAsking] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), [])
  useEffect(() => {
    if (!count) setAsking(false)
  }, [count])

  const ask = (): void => {
    setAsking(true)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setAsking(false), 4000)
  }

  if (asking && count > 0) {
    return (
      <span className="rv-batch">
        <button type="button" className="btn sm ghost" onClick={() => setAsking(false)}>
          {t('bulk.cancel')}
        </button>
        <button
          type="button"
          className="btn sm primary"
          onClick={() => {
            setAsking(false)
            onConfirm()
          }}
        >
          <Icon name="check" size={13} />
          {t('bulk.confirm', { count })}
        </button>
      </span>
    )
  }
  return (
    <button type="button" className="btn sm" disabled={!count} title={t('bulk.hint')} onClick={ask}>
      <Icon name="check" size={13} />
      {t('bulk.approveQa', { count })}
    </button>
  )
}
