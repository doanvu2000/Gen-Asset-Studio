import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useEnv } from '@renderer/store/env'
import { Icon } from './Icon'
import { Modal } from './Modal'

export function UacDialog(): ReactElement {
  const { t } = useTranslation()
  const need = useEnv((s) => s.setup?.steps.find((x) => x.id === 'longPath')?.need ?? null)
  const dismissed = useEnv((s) => s.uacDismissed)
  const dismiss = useEnv((s) => s.dismissUac)
  const open = need === 'uac' && !dismissed

  const act = (grant: boolean): void => {
    dismiss(true)
    void window.gas.setup.uac(grant)
  }

  return (
    <Modal open={open} onClose={() => dismiss(true)} label={t('setup.uac.title')} role="alertdialog">
      <h2>
        <span className="dlg-ic warn">
          <Icon name="shield" size={22} />
        </span>
        {t('setup.uac.title')}
      </h2>
      <p>{t('setup.uac.body')}</p>
      <div className="tip">
        <Icon name="help" size={14} />
        <span>{t('setup.uac.tip')}</span>
      </div>
      <div className="acts">
        <button type="button" className="btn" onClick={() => act(false)}>
          {t('setup.uac.skip')}
        </button>
        <button type="button" className="btn primary" onClick={() => act(true)}>
          <Icon name="shield" size={14} />
          {t('setup.uac.grant')}
        </button>
      </div>
    </Modal>
  )
}
