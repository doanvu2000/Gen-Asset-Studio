import type { ReactElement, ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from './Icon'

export interface BarVersion {
  v: number
  title?: string
  warn?: boolean
}

interface Toggle {
  active: boolean
  onToggle: () => void
  disabled?: boolean
}

interface Decision {
  label: string
  on: boolean
  disabled?: boolean
  onClick: () => void
}

interface Props {
  className?: string
  versions: BarVersion[]
  selected: number
  onPick?: (v: number) => void
  numberKeys: boolean
  compare?: Toggle
  recolor?: Toggle
  regen?: { label: string; busy?: boolean; disabled?: boolean; noKey?: boolean; onClick: () => void }
  reject: Decision
  approve: Decision
  onShortcuts: () => void
  extra?: ReactNode
}

export function ReviewBar({ className, versions, selected, onPick, numberKeys, compare, recolor, regen, reject, approve, onShortcuts, extra }: Props): ReactElement {
  const { t } = useTranslation()
  return (
    <div className={className ? `rvb ${className}` : 'rvb'} role="toolbar" aria-label={t('reviewBar.versions')}>
      {versions.length > 0 && (
        <div className="rvb-vers" role="group" aria-label={t('reviewBar.versions')}>
          {versions.map((x) => {
            const on = x.v === selected
            return (
              <button
                key={x.v}
                type="button"
                className={on ? 'rvb-chip on' : 'rvb-chip'}
                aria-pressed={on}
                disabled={!onPick}
                title={[t('reviewBar.pick', { v: x.v }), x.title, x.warn ? t('reviewBar.flagged') : ''].filter(Boolean).join('\n')}
                onClick={() => onPick && !on && onPick(x.v)}
              >
                v{x.v}
                {x.warn && <i className="rvb-warn" />}
                {numberKeys && x.v <= 9 && <kbd>{x.v}</kbd>}
              </button>
            )
          })}
        </div>
      )}
      {compare && (
        <button type="button" className={compare.active ? 'btn sm on' : 'btn sm'} aria-pressed={compare.active} disabled={compare.disabled} title={`${t('reviewBar.compareHint')} (C)`} onClick={compare.onToggle}>
          <Icon name="layers" size={13} />
          {t('reviewBar.compare')}
          <span className="kbd">C</span>
        </button>
      )}
      {recolor && (
        <button type="button" className={recolor.active ? 'btn sm on' : 'btn sm'} aria-pressed={recolor.active} disabled={recolor.disabled} onClick={recolor.onToggle}>
          <Icon name="palette" size={13} />
          {t('reviewBar.recolor')}
        </button>
      )}
      {regen && (
        <button type="button" className="btn sm" disabled={regen.disabled} title={regen.noKey ? regen.label : `${regen.label} (R)`} onClick={regen.onClick}>
          {regen.busy ? <span className="spin xs" /> : <Icon name="refresh" size={13} />}
          {regen.label}
          {!regen.noKey && <span className="kbd">R</span>}
        </button>
      )}
      <div className="rvb-end">
        <button type="button" className="icon-btn" aria-label={t('reviewBar.shortcutsTitle')} title={`${t('reviewBar.shortcutsTitle')} (?)`} onClick={onShortcuts}>
          <Icon name="help" size={14} />
        </button>
        {extra}
        <button type="button" className={reject.on ? 'btn on-flag' : 'btn'} disabled={reject.disabled} title={`${reject.label} (X)`} onClick={reject.onClick}>
          <Icon name="flag" size={14} />
          {reject.label}
          <span className="kbd">X</span>
        </button>
        <button type="button" className={approve.on ? 'btn green solid' : 'btn primary'} disabled={approve.disabled} title={`${approve.label} (A)`} onClick={approve.onClick}>
          <Icon name="check" size={14} />
          {approve.label}
          <span className="kbd">A</span>
        </button>
      </div>
    </div>
  )
}
