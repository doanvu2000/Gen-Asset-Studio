import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { selectResolvedTheme, useApp } from '@renderer/store/app'
import { Icon } from './Icon'

function TrafficLights(): ReactElement {
  const { t } = useTranslation()
  const maximized = useApp((s) => s.maximized)
  return (
    <div className="lights">
      <button type="button" className="l lr" aria-label={t('window.close')} title={t('window.close')} onClick={() => window.gas.window.close()}>
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
          <path d="M1.5 1.5l5 5M6.5 1.5l-5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
        </svg>
      </button>
      <button type="button" className="l ly" aria-label={t('window.minimize')} title={t('window.minimize')} onClick={() => window.gas.window.minimize()}>
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
          <path d="M1.2 4h5.6" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
        </svg>
      </button>
      <button
        type="button"
        className="l lg"
        aria-label={maximized ? t('window.restore') : t('window.maximize')}
        title={maximized ? t('window.restore') : t('window.maximize')}
        onClick={() => window.gas.window.toggleMaximize()}
      >
        <svg width="8" height="8" viewBox="0 0 8 8" aria-hidden="true">
          {maximized ? (
            <path d="M4.4 0.9v2.7h2.7zM3.6 7.1V4.4H0.9z" fill="currentColor" />
          ) : (
            <path d="M1.4 1.4h3.4L1.4 4.8zM6.6 6.6H3.2l3.4-3.4z" fill="currentColor" />
          )}
        </svg>
      </button>
    </div>
  )
}

export function TitleBar(): ReactElement {
  const { t } = useTranslation()
  const route = useApp((s) => s.route)
  const lang = useApp((s) => s.settings.lang)
  const dark = useApp((s) => selectResolvedTheme(s) === 'dark')
  const sidebarOpen = useApp((s) => s.sidebarOpen)
  const toggleSidebar = useApp((s) => s.toggleSidebar)
  const setLang = useApp((s) => s.setLang)
  const setTheme = useApp((s) => s.setTheme)
  const openSettings = useApp((s) => s.openSettings)
  const inApp = route !== 'setup'

  return (
    <header className="titlebar" onDoubleClick={(e) => {
      if (e.target === e.currentTarget) window.gas.window.toggleMaximize()
    }}>
      <TrafficLights />
      {inApp && (
        <button
          type="button"
          className={sidebarOpen ? 'icon-btn' : 'icon-btn on'}
          aria-label={t('titlebar.toggleSidebar')}
          title={t('titlebar.toggleSidebar')}
          onClick={toggleSidebar}
        >
          <Icon name="sidebar" />
        </button>
      )}
      <div className="crumbs">
        {inApp ? (
          <>
            <span className="c-dim">{t('sidebar.workspace')}</span>
            <Icon name="chev" size={12} />
            <span>{t('titlebar.allProjects')}</span>
          </>
        ) : (
          <>
            <span>{t('app.name')}</span>
            <span className="c-dim">— {t('titlebar.setupCrumb')}</span>
          </>
        )}
      </div>
      <div className="tb-right">
        <button type="button" className="pill-btn" title={t('titlebar.switchLang')} onClick={() => void setLang(lang === 'vi' ? 'en' : 'vi')}>
          {lang === 'vi' ? 'VI' : 'EN'}
        </button>
        <button
          type="button"
          className="icon-btn"
          aria-label={t('titlebar.toggleTheme')}
          title={t('titlebar.toggleTheme')}
          onClick={() => void setTheme(dark ? 'light' : 'dark')}
        >
          <Icon name={dark ? 'sun' : 'moon'} />
        </button>
        <button type="button" className="icon-btn" aria-label={t('titlebar.settings')} title={t('titlebar.settings')} onClick={openSettings}>
          <Icon name="gear" />
        </button>
      </div>
    </header>
  )
}
