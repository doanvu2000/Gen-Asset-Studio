import { useCallback, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { SHORTCUTS, type ReviewScreen } from './reviewShortcuts'

export function ShortcutsDialog({ screen, open, onClose }: { screen: ReviewScreen; open: boolean; onClose: () => void }): ReactElement {
  const { t } = useTranslation()
  const tt = t as unknown as (k: string) => string
  return (
    <Modal open={open} onClose={onClose} label={t('shortcuts.title')} className="shortcuts">
      <h2>
        {t('shortcuts.title')}
        <span className="muted sc-sub">{tt(`shortcuts.${screen}`)}</span>
        <button type="button" className="icon-btn sc-x" aria-label={t('shortcuts.close')} onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </h2>
      <dl className="sc-list">
        {SHORTCUTS[screen].map((row) => (
          <div className="sc-row" key={row.id}>
            <dt>
              {row.keys.map((k) => (
                <kbd key={k}>{k}</kbd>
              ))}
            </dt>
            <dd>{tt(`shortcuts.rows.${row.id}`)}</dd>
          </div>
        ))}
      </dl>
    </Modal>
  )
}

export function useShortcutsDialog(screen: ReviewScreen): { show: () => void; toggle: () => void; dialog: ReactElement } {
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])
  const show = useCallback(() => setOpen(true), [])
  const toggle = useCallback(() => setOpen((o) => !o), [])
  return { show, toggle, dialog: <ShortcutsDialog screen={screen} open={open} onClose={close} /> }
}
