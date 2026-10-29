import { useCallback, useMemo, useState, type MouseEvent, type ReactElement } from 'react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import type { ProjectSummary } from '@shared/workspace'
import { Icon } from '@renderer/components/Icon'
import { ContextMenu, type MenuItem } from '@renderer/components/ContextMenu'
import { EASE } from '@renderer/lib/motion'
import { relTime } from '@renderer/lib/format'
import { useApp } from '@renderer/store/app'
import { findNode, useWs, type SortKey } from '@renderer/store/workspace'

const SORTS: SortKey[] = ['recent', 'name', 'images']

function Card({ p, index, onMenu }: { p: ProjectSummary; index: number; onMenu: (e: MouseEvent, p: ProjectSummary) => void }): ReactElement {
  const { t } = useTranslation()
  const lang = useApp((s) => s.settings.lang)
  const openProject = useWs((s) => s.openProject)
  const pct = p.imageCount ? Math.round((p.approved / p.imageCount) * 100) : 0
  return (
    <motion.button
      type="button"
      className="card"
      initial={{ opacity: 0, y: 10, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.32, ease: EASE, delay: Math.min(index, 12) * 0.035 }}
      onClick={() => void openProject(p.rel)}
      onContextMenu={(e) => onMenu(e, p)}
    >
      <div className={p.thumbs.length > 1 ? 'card-thumb ck' : 'card-thumb ck one'}>
        {p.thumbs.length ? (
          p.thumbs.map((src) => (
            <div className="ct" key={src}>
              <img src={src} alt="" draggable={false} loading="lazy" />
            </div>
          ))
        ) : (
          <div className="empty-t">
            <Icon name="image" size={28} />
          </div>
        )}
      </div>
      <div className="card-body">
        <div className="card-title">{p.name}</div>
        <div className="card-meta">{p.parentRel ? p.parentRel.split('/').join(' / ') : t('workspace.root')}</div>
        <div className="card-row">
          <span>{t('workspace.card.images', { count: p.imageCount })}</span>
          <span>{t('workspace.card.groups', { count: p.groupCount })}</span>
        </div>
        <div className="bar green" title={t('workspace.card.approved', { a: p.approved, n: p.imageCount })}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="card-foot">
          <span className={p.status === 'new' ? 'chip c-gray' : 'chip c-blue'}>
            <Icon name={p.status === 'new' ? 'plus' : 'image'} size={11} />
            {t(`workspace.card.status.${p.status}`)}
          </span>
          <span className="muted">{relTime(p.updatedAt, lang)}</span>
        </div>
      </div>
    </motion.button>
  )
}

function Empty({ icon, title, desc, children }: { icon: 'layers' | 'folder' | 'search' | 'alert'; title: string; desc: string; children?: ReactElement }): ReactElement {
  return (
    <motion.div className="empty" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE, delay: 0.05 }}>
      <Icon name={icon} size={34} />
      <h3>{title}</h3>
      <p>{desc}</p>
      {children}
    </motion.div>
  )
}

export function WorkspaceScreen(): ReactElement {
  const { t } = useTranslation()
  const snap = useWs((s) => s.snap)
  const curFolder = useWs((s) => s.curFolder)
  const search = useWs((s) => s.search)
  const sort = useWs((s) => s.sort)
  const setSearch = useWs((s) => s.setSearch)
  const setSort = useWs((s) => s.setSort)
  const setDialog = useWs((s) => s.setDialog)
  const openProject = useWs((s) => s.openProject)
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])

  const folder = findNode(snap?.tree ?? null, curFolder)
  const isRoot = curFolder === ''
  const parent = folder?.kind === 'folder' ? curFolder : ''

  const projects = useMemo(() => {
    const all = (snap?.projects ?? []).filter((p) => isRoot || p.rel.startsWith(`${curFolder}/`))
    const q = search.trim().toLowerCase()
    const list = q ? all.filter((p) => p.name.toLowerCase().includes(q) || p.rel.toLowerCase().includes(q)) : all
    const sorted = [...list]
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    else if (sort === 'images') sorted.sort((a, b) => b.imageCount - a.imageCount)
    else sorted.sort((a, b) => b.updatedAt - a.updatedAt)
    return sorted
  }, [snap, curFolder, isRoot, search, sort])

  const cardMenu = (e: MouseEvent, p: ProjectSummary): void => {
    e.preventDefault()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t('tree.menu.open'), icon: 'layers', onSelect: () => void openProject(p.rel) },
        { label: t('tree.menu.reveal'), icon: 'external', onSelect: () => void window.gas.workspace.reveal(p.rel) },
        { sep: true },
        { label: t('tree.menu.trash'), icon: 'trash', danger: true, onSelect: () => setDialog({ kind: 'trash', rel: p.rel, name: p.name, project: true, count: 1 }) }
      ]
    })
  }

  const sortMenu = (e: MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({
      x: r.left,
      y: r.bottom + 4,
      items: SORTS.map((k) => ({ label: t(`workspace.sort.${k}`), icon: sort === k ? 'check' : undefined, onSelect: () => setSort(k) }))
    })
  }

  if (!snap?.root || !snap.exists) {
    const missing = !!snap?.root && !snap.exists
    return (
      <>
        <div className="mhead">
          <div>
            <h1>{t('workspace.title')}</h1>
          </div>
        </div>
        <motion.div className="empty-drop" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE, delay: 0.06 }}>
          <Icon name={missing ? 'alert' : 'folder'} size={40} />
          <h2>{missing ? t('workspace.wsMissingTitle') : t('workspace.noWsTitle')}</h2>
          <p>{missing ? t('workspace.wsMissingDesc', { path: snap?.root ?? '' }) : t('workspace.noWsDesc')}</p>
          <div className="actions">
            <button type="button" className="btn primary" onClick={() => void window.gas.workspace.choose()}>
              <Icon name="folder" size={14} />
              {t('workspace.chooseWs')}
            </button>
          </div>
        </motion.div>
      </>
    )
  }

  const total = isRoot ? snap.projects.length : (folder?.projectCount ?? 0)

  return (
    <>
      <div className="mhead">
        <div className="mh-title">
          <h1>{isRoot ? t('workspace.title') : (folder?.name ?? '')}</h1>
          <p className="sub">
            {t('workspace.count', { count: total })} <span className="mono">{snap.root}</span>
          </p>
        </div>
        <div className="mh-actions">
          <label className="search">
            <Icon name="search" size={14} />
            <input value={search} placeholder={t('workspace.search')} aria-label={t('workspace.search')} onChange={(e) => setSearch(e.target.value)} spellCheck={false} />
            {search && (
              <button type="button" className="search-x" aria-label={t('dialogs.cancel')} onClick={() => setSearch('')}>
                <Icon name="x" size={12} />
              </button>
            )}
          </label>
          <button type="button" className="btn" onClick={sortMenu}>
            <Icon name="sort" size={14} />
            {t(`workspace.sort.${sort}`)}
          </button>
          <button type="button" className="btn primary" onClick={() => setDialog({ kind: 'newProject', parent })}>
            <Icon name="plus" size={14} />
            {t('workspace.newProject')}
          </button>
        </div>
      </div>
      <div className="cards" key={`${curFolder}|${sort}`}>
        {projects.length ? (
          projects.map((p, i) => <Card key={p.rel} p={p} index={i} onMenu={cardMenu} />)
        ) : search ? (
          <Empty icon="search" title={t('workspace.noMatchTitle')} desc={t('workspace.noMatchDesc')} />
        ) : (
          <Empty
            icon="layers"
            title={isRoot ? t('workspace.emptyTitle') : t('workspace.folderEmptyTitle')}
            desc={isRoot ? t('workspace.emptyDesc') : t('workspace.folderEmptyDesc')}
          >
            <div className="actions">
              <button type="button" className="btn primary" onClick={() => setDialog({ kind: 'newProject', parent })}>
                <Icon name="plus" size={14} />
                {t('workspace.newProject')}
              </button>
              <button type="button" className="btn" onClick={() => setDialog({ kind: 'newFolder', parent })}>
                <Icon name="folderPlus" size={14} />
                {t('sidebar.newFolder')}
              </button>
            </div>
          </Empty>
        )}
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </>
  )
}
