import { useCallback, useMemo, useState, type MouseEvent, type ReactElement } from 'react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import type { ProjectStatus, ProjectSummary } from '@shared/workspace'
import { Icon, type IconName } from '@renderer/components/Icon'
import { ContextMenu, type MenuItem } from '@renderer/components/ContextMenu'
import { PromoFooter } from '@renderer/components/Promo'
import { EASE } from '@renderer/lib/motion'
import { relTime } from '@renderer/lib/format'
import { useApp } from '@renderer/store/app'
import { findNode, useWs, type KindFilter, type SortKey } from '@renderer/store/workspace'
import { COACH, coachAttr } from '@renderer/lib/tours'
import { KindBadge } from '@renderer/components/ProjectKinds'
import { Segmented } from '@renderer/components/Segmented'
import { PROJECT_KINDS } from '@shared/sprite'

const SORTS: SortKey[] = ['recent', 'name', 'images']
const STATUS_CHIP: Record<ProjectStatus, [string, IconName]> = {
  new: ['c-gray', 'plus'],
  draft: ['c-gray', 'image'],
  review: ['c-orange', 'eye'],
  exported: ['c-green', 'check']
}

function Card({ p, index, onMenu }: { p: ProjectSummary; index: number; onMenu: (e: MouseEvent, p: ProjectSummary) => void }): ReactElement {
  const { t } = useTranslation()
  const lang = useApp((s) => s.settings.lang)
  const openProject = useWs((s) => s.openProject)
  const pct = p.imageCount ? Math.round((p.approved / p.imageCount) * 100) : 0
  return (
    <motion.button
      type="button"
      className={`card k-${p.kind}`}
      data-coach={p.sample ? COACH.wsSample : undefined}
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
        <div className="card-title">
          <span className="ct-n">{p.name}</span>
          <KindBadge kind={p.kind} />
        </div>
        <div className="card-meta">{p.parentRel ? p.parentRel.split('/').join(' / ') : t('workspace.root')}</div>
        <div className="card-row">
          <span>{p.kind === 'sprite' ? t('workspace.card.sheets', { count: p.imageCount }) : p.kind === 'spine' ? t('workspace.card.regions', { count: p.imageCount }) : t('workspace.card.images', { count: p.imageCount })}</span>
          {p.kind === 'reskin' && <span>{t('workspace.card.groups', { count: p.groupCount })}</span>}
        </div>
        <div className="bar green" title={t('workspace.card.approved', { a: p.approved, n: p.imageCount })}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <div className="card-foot">
          <span
            className={`chip ${STATUS_CHIP[p.status][0]}`}
            title={p.status === 'exported' ? t('workspace.card.exportedTip', { count: p.exported, time: relTime(p.exportedAt, lang) }) : undefined}
          >
            <Icon name={STATUS_CHIP[p.status][1]} size={11} />
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
  const sampleBusy = useWs((s) => s.sampleBusy)
  const createSample = useWs((s) => s.createSample)
  const snap = useWs((s) => s.snap)
  const curFolder = useWs((s) => s.curFolder)
  const search = useWs((s) => s.search)
  const sort = useWs((s) => s.sort)
  const kindFilter = useWs((s) => s.kindFilter)
  const setKindFilter = useWs((s) => s.setKindFilter)
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
    const all = (snap?.projects ?? []).filter((p) => (isRoot || p.rel.startsWith(`${curFolder}/`)) && (kindFilter === 'all' || p.kind === kindFilter))
    const q = search.trim().toLowerCase()
    const list = q ? all.filter((p) => p.name.toLowerCase().includes(q) || p.rel.toLowerCase().includes(q)) : all
    const sorted = [...list]
    if (sort === 'name') sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    else if (sort === 'images') sorted.sort((a, b) => b.imageCount - a.imageCount)
    else sorted.sort((a, b) => b.updatedAt - a.updatedAt)
    return sorted
  }, [snap, curFolder, isRoot, search, sort, kindFilter])

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

  const hasProjects = snap.projects.length > 0
  const hasSample = snap.projects.some((p) => p.sample)
  const kinds = new Set(snap.projects.map((p) => p.kind))
  const hasKinds = kinds.size > 1 || kindFilter !== 'all'
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
          {hasKinds && (
            <Segmented<KindFilter>
              value={kindFilter}
              ariaLabel={t('kinds.label')}
              onChange={setKindFilter}
              options={[{ value: 'all', label: t('workspace.kindAll') }, ...PROJECT_KINDS.filter((k) => kinds.has(k)).map((k) => ({ value: k, label: t(`kinds.${k}.short`) }))]}
            />
          )}
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
          {hasProjects && !hasSample && (
            <button type="button" className="btn" disabled={sampleBusy} title={t('coach.ui.sampleHint')} onClick={() => void createSample()} {...coachAttr(COACH.wsSample)}>
              <Icon name="sparkles" size={14} />
              {sampleBusy ? t('coach.ui.sampleCreating') : t('workspace.sampleShort')}
            </button>
          )}
          <button type="button" className="btn primary" onClick={() => setDialog({ kind: 'newProject', parent })} {...coachAttr(COACH.wsNewProject)}>
            <Icon name="plus" size={14} />
            {t('workspace.newProject')}
          </button>
        </div>
      </div>
      <div className="cards" key={`${curFolder}|${sort}`}>
        {projects.length ? (
          projects.map((p, i) => <Card key={p.rel} p={p} index={i} onMenu={cardMenu} />)
        ) : search || kindFilter !== 'all' ? (
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
              {isRoot && (
                <button type="button" className="btn" disabled={sampleBusy} title={t('coach.ui.sampleHint')} onClick={() => void createSample()} {...coachAttr(COACH.wsSample)}>
                  <Icon name="sparkles" size={14} />
                  {sampleBusy ? t('coach.ui.sampleCreating') : t('coach.ui.sampleCreate')}
                </button>
              )}
            </div>
          </Empty>
        )}
      </div>
      <PromoFooter />
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </>
  )
}
