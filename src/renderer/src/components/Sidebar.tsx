import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp } from '@renderer/store/app'
import { Icon } from './Icon'
import { Logo } from './Logo'

export function Sidebar(): ReactElement {
  const { t } = useTranslation()
  const workspace = useApp((s) => s.settings.workspace)
  const openSettings = useApp((s) => s.openSettings)
  const sidebarOpen = useApp((s) => s.sidebarOpen)

  return (
    <aside className="side" aria-hidden={!sidebarOpen} inert={!sidebarOpen}>
      <div className="side-inner">
        <button type="button" className="ws-switch">
          <Logo />
          <div>
            <b>{t('sidebar.workspace')}</b>
            <small title={workspace ?? undefined}>{workspace ? workspace.split(/[\\/]/).filter(Boolean).pop() : t('sidebar.noWorkspace')}</small>
          </div>
        </button>
        <div className="side-label">{t('sidebar.library')}</div>
        <nav className="tree" role="tree">
          <button type="button" className="tn act" role="treeitem" aria-selected="true">
            <span className="ti">
              <Icon name="grid" size={15} />
            </span>
            <span className="tl">{t('sidebar.allProjects')}</span>
            <span className="tcount">0</span>
          </button>
        </nav>
        <div className="side-foot">
          <button type="button" className="btn ghost sm" onClick={() => openSettings('env')}>
            <Icon name="box" size={14} />
            {t('sidebar.environment')}
          </button>
          <div className="grow" />
          <button type="button" className="icon-btn" aria-label={t('sidebar.settings')} title={t('sidebar.settings')} onClick={() => openSettings()}>
            <Icon name="gear" />
          </button>
        </div>
      </div>
    </aside>
  )
}
