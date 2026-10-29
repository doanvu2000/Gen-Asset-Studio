import type { ReactElement } from 'react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Icon } from '@renderer/components/Icon'
import { EASE } from '@renderer/lib/motion'

export function WorkspaceScreen(): ReactElement {
  const { t } = useTranslation()

  return (
    <>
      <div className="mhead">
        <div>
          <h1>{t('workspace.title')}</h1>
          <p className="sub">{t('workspace.subtitle')}</p>
        </div>
        <div className="mh-actions">
          <button type="button" className="btn primary" disabled>
            <Icon name="plus" size={14} />
            {t('workspace.newProject')}
          </button>
        </div>
      </div>
      <motion.div
        className="empty-drop"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: EASE, delay: 0.06 }}
      >
        <Icon name="folder" size={40} />
        <h2>{t('workspace.emptyTitle')}</h2>
        <p>{t('workspace.emptyDesc')}</p>
        <div className="actions">
          <button type="button" className="btn primary" disabled>
            <Icon name="plus" size={14} />
            {t('workspace.newProject')}
          </button>
          <button type="button" className="btn" disabled>
            <Icon name="folder" size={14} />
            {t('workspace.openFolder')}
          </button>
        </div>
      </motion.div>
    </>
  )
}
