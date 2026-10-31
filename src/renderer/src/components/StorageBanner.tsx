import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { formatBytes } from '@renderer/lib/updateText'
import { useApp } from '@renderer/store/app'
import { useStorageSnapshot } from './StorageSettings'
import { Icon } from './Icon'
import '../styles/update.css'

export function StorageBanner(): ReactElement | null {
  const { t } = useTranslation()
  const [snap] = useStorageSnapshot()
  const [hidden, setHidden] = useState(false)
  const openSettings = useApp((s) => s.openSettings)
  if (!snap || !snap.banner || hidden) return null
  const crit = snap.warn === 'critical'

  const later = (): void => {
    setHidden(true)
    if (!crit) void window.gas.storage.dismissBanner()
  }

  return (
    <div className={crit ? 'upd-banner stg-banner crit' : 'upd-banner stg-banner'} role="dialog" aria-live="polite">
      <div className="upd-head">
        <div className="upd-icon" aria-hidden>
          <Icon name={crit ? 'alert' : 'drive'} size={18} />
        </div>
        <div className="upd-titles">
          <div className="upd-title">
            {crit ? t('storage.bannerCritical', { free: formatBytes(snap.dataDrive?.free ?? 0) }) : t('storage.bannerTitle', { size: formatBytes(snap.appBytes) })}
          </div>
          <div className="upd-sub">{t('storage.bannerDesc')}</div>
        </div>
      </div>
      <div className="upd-actions">
        <button type="button" className="btn sm" onClick={later}>
          {t('storage.later')}
        </button>
        <button
          type="button"
          className="btn sm primary"
          onClick={() => {
            setHidden(true)
            openSettings('storage')
          }}
        >
          <Icon name="drive" size={13} />
          {t('queue.openStorage')}
        </button>
      </div>
    </div>
  )
}
