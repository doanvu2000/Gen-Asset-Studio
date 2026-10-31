import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { PROJECT_KINDS, READY_KINDS, type ProjectKind } from '@shared/sprite'
import { Icon, type IconName } from './Icon'

export const KIND_ICON: Record<ProjectKind, IconName> = { reskin: 'image', sprite: 'grid', spine: 'layers' }

export function KindBadge({ kind, compact = false }: { kind: ProjectKind; compact?: boolean }): ReactElement {
  const { t } = useTranslation()
  return (
    <span className={`kbadge k-${kind}${compact ? ' sm' : ''}`} title={t(`kinds.${kind}.audience`)}>
      <Icon name={KIND_ICON[kind]} size={compact ? 10 : 11} />
      {!compact && t(`kinds.${kind}.short`)}
    </span>
  )
}

export function ProjectKindPicker({ value, onChange }: { value: ProjectKind; onChange: (k: ProjectKind) => void }): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="fld">
      <span>{t('kinds.label')}</span>
      <div className="pkinds" role="radiogroup" aria-label={t('kinds.label')}>
        {PROJECT_KINDS.map((k) => {
          const ready = READY_KINDS.includes(k)
          const on = value === k
          return (
            <button
              key={k}
              type="button"
              role="radio"
              aria-checked={on}
              aria-disabled={!ready || undefined}
              className={['pkind', `k-${k}`, on && 'on', !ready && 'soon'].filter(Boolean).join(' ')}
              onClick={() => ready && onChange(k)}
            >
              <span className="pk-head">
                <span className="pk-ic">
                  <Icon name={KIND_ICON[k]} size={18} />
                </span>
                <span className="pk-title">
                  <b>{t(`kinds.${k}.name`)}</b>
                  <small>{t(`kinds.${k}.audience`)}</small>
                </span>
                {!ready ? <span className="chip c-gray">{t('kinds.soon')}</span> : on ? <Icon name="check" size={15} /> : null}
              </span>
              <span className="pk-desc">{t(`kinds.${k}.desc`)}</span>
              <span className="pk-flow">{t(`kinds.${k}.flow`)}</span>
              <span className="pk-io">
                <span>
                  <em>{t('kinds.in')}</em>
                  {t(`kinds.${k}.input`)}
                </span>
                <span>
                  <em>{t('kinds.out')}</em>
                  {t(`kinds.${k}.output`)}
                </span>
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
