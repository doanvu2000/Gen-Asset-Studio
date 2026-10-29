import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from './Icon'
import { toast } from '@renderer/store/toast'

const KINDS = [
  { id: 'png', icon: 'image', ready: true },
  { id: 'spine', icon: 'layers', ready: false },
  { id: 'sprite', icon: 'grid', ready: false }
] as const

export function AssetKinds({ variant = 'cards' }: { variant?: 'cards' | 'compact' }): ReactElement {
  const { t } = useTranslation()
  const soon = (name: string): void => toast(t('kinds.soonToast', { name }), 'info')
  if (variant === 'compact') {
    return (
      <div className="kinds-c" role="radiogroup" aria-label={t('kinds.label')}>
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            role="radio"
            aria-checked={k.ready}
            aria-disabled={!k.ready}
            className={k.ready ? 'kc on' : 'kc soon'}
            title={k.ready ? t(`kinds.${k.id}.desc`) : t('kinds.soonHint')}
            onClick={() => !k.ready && soon(t(`kinds.${k.id}.name`))}
          >
            <Icon name={k.icon} size={13} />
            {t(`kinds.${k.id}.name`)}
            {!k.ready && <span className="chip c-gray">{t('kinds.soon')}</span>}
          </button>
        ))}
      </div>
    )
  }
  return (
    <div className="fld">
      <span>{t('kinds.label')}</span>
      <div className="kinds" role="radiogroup" aria-label={t('kinds.label')}>
        {KINDS.map((k) => (
          <button
            key={k.id}
            type="button"
            role="radio"
            aria-checked={k.ready}
            aria-disabled={!k.ready}
            className={k.ready ? 'kind on' : 'kind soon'}
            onClick={() => !k.ready && soon(t(`kinds.${k.id}.name`))}
          >
            <span className="kind-ic">
              <Icon name={k.icon} size={18} />
            </span>
            <b>{t(`kinds.${k.id}.name`)}</b>
            <small>{k.ready ? t(`kinds.${k.id}.desc`) : t('kinds.soon')}</small>
          </button>
        ))}
      </div>
    </div>
  )
}
