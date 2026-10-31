import { useCallback, useEffect, useRef, useState, type DragEvent, type KeyboardEvent, type MouseEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { FolderNode } from '@shared/workspace'
import { useApp } from '@renderer/store/app'
import { findNode, useWs } from '@renderer/store/workspace'
import { ContextMenu, type MenuItem } from './ContextMenu'
import { Icon } from './Icon'
import { KIND_ICON } from './ProjectKinds'
import { Logo } from './Logo'

const DND = 'application/x-gas-node'

interface MenuState {
  x: number
  y: number
  items: MenuItem[]
}

function RenameInput({ node }: { node: FolderNode }): ReactElement {
  const { t } = useTranslation()
  const rename = useWs((s) => s.rename)
  const setRenaming = useWs((s) => s.setRenaming)
  const ref = useRef<HTMLInputElement>(null)
  const done = useRef(false)
  useEffect(() => {
    ref.current?.focus()
    ref.current?.select()
  }, [])
  const commit = (v: string): void => {
    if (done.current) return
    done.current = true
    void rename(node.rel, v)
  }
  return (
    <input
      ref={ref}
      className="rn"
      defaultValue={node.name}
      aria-label={t('tree.rename')}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') commit(e.currentTarget.value)
        if (e.key === 'Escape') {
          done.current = true
          setRenaming(null)
        }
      }}
      onBlur={(e) => commit(e.currentTarget.value)}
    />
  )
}

interface NodeProps {
  node: FolderNode
  depth: number
  onMenu: (e: MouseEvent, node: FolderNode) => void
  drag: DragApi
}

interface DragApi {
  over: string | null
  dragging: string | null
  start: (e: DragEvent, node: FolderNode) => void
  enter: (e: DragEvent, rel: string, canDrop: boolean) => void
  leave: (rel: string) => void
  drop: (e: DragEvent, rel: string) => void
  end: () => void
}

function TreeNode({ node, depth, onMenu, drag }: NodeProps): ReactElement {
  const route = useApp((s) => s.route)
  const curFolder = useWs((s) => s.curFolder)
  const curProject = useWs((s) => s.curProject)
  const open = useWs((s) => !!s.expanded[node.rel])
  const renaming = useWs((s) => s.renaming === node.rel)
  const toggle = useWs((s) => s.toggle)
  const openFolder = useWs((s) => s.openFolder)
  const openProject = useWs((s) => s.openProject)
  const setRenaming = useWs((s) => s.setRenaming)
  const setDialog = useWs((s) => s.setDialog)
  const isFolder = node.kind === 'folder'
  const act = isFolder ? route === 'workspace' && curFolder === node.rel : route === 'project' && curProject === node.rel
  const hasKids = isFolder && node.children.length > 0
  const cls = ['tn', act && 'act', drag.over === node.rel && 'drop', drag.dragging === node.rel && 'dragging'].filter(Boolean).join(' ')

  const onKey = (e: KeyboardEvent): void => {
    if (renaming) return
    if (e.key === 'Enter') isFolder ? openFolder(node.rel) : void openProject(node.rel)
    else if (e.key === 'F2') setRenaming(node.rel)
    else if (e.key === 'Delete') setDialog({ kind: 'trash', rel: node.rel, name: node.name, project: !isFolder, count: node.projectCount })
    else if (e.key === 'ArrowRight' && hasKids) toggle(node.rel, true)
    else if (e.key === 'ArrowLeft' && hasKids) toggle(node.rel, false)
  }

  return (
    <>
      <div
        className={cls}
        role="treeitem"
        tabIndex={0}
        aria-selected={act}
        aria-expanded={hasKids ? open : undefined}
        style={{ ['--d' as string]: depth }}
        draggable={!renaming}
        onDragStart={(e) => drag.start(e, node)}
        onDragEnd={drag.end}
        onDragOver={(e) => drag.enter(e, node.rel, isFolder)}
        onDragLeave={() => drag.leave(node.rel)}
        onDrop={(e) => isFolder && drag.drop(e, node.rel)}
        onClick={() => {
          if (renaming) return
          if (isFolder) openFolder(node.rel)
          else void openProject(node.rel)
        }}
        onDoubleClick={(e) => {
          if ((e.target as HTMLElement).closest('.tl')) setRenaming(node.rel)
          else if (hasKids) toggle(node.rel)
        }}
        onContextMenu={(e) => onMenu(e, node)}
        onKeyDown={onKey}
        title={node.name}
      >
        <span
          className={hasKids ? (open ? 'tw open' : 'tw') : 'tw none'}
          onClick={(e) => {
            if (!hasKids) return
            e.stopPropagation()
            toggle(node.rel)
          }}
          onDoubleClick={(e) => e.stopPropagation()}
        >
          {hasKids && <Icon name="chev" size={12} />}
        </span>
        <span className={isFolder ? 'ti' : `ti p k-${node.projectKind ?? 'reskin'}`}>
          <Icon name={isFolder ? 'folder' : KIND_ICON[node.projectKind ?? 'reskin']} size={15} />
        </span>
        {renaming ? <RenameInput node={node} /> : <span className="tl">{node.name}</span>}
        <span className="tcount">{isFolder ? node.projectCount : node.imageCount}</span>
        <span
          className="tmore"
          role="button"
          tabIndex={-1}
          onClick={(e) => {
            e.stopPropagation()
            onMenu(e, node)
          }}
        >
          <Icon name="more" size={14} />
        </span>
      </div>
      {hasKids && (
        <div className={open ? 'tc open' : 'tc'} role="group">
          <div>
            {node.children.map((c) => (
              <TreeNode key={c.rel} node={c} depth={depth + 1} onMenu={onMenu} drag={drag} />
            ))}
          </div>
        </div>
      )}
    </>
  )
}

export function Sidebar(): ReactElement {
  const { t } = useTranslation()
  const createSample = useWs((s) => s.createSample)
  const openSettings = useApp((s) => s.openSettings)
  const sidebarOpen = useApp((s) => s.sidebarOpen)
  const route = useApp((s) => s.route)
  const snap = useWs((s) => s.snap)
  const curFolder = useWs((s) => s.curFolder)
  const openFolder = useWs((s) => s.openFolder)
  const openProject = useWs((s) => s.openProject)
  const setDialog = useWs((s) => s.setDialog)
  const setRenaming = useWs((s) => s.setRenaming)
  const move = useWs((s) => s.move)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [over, setOver] = useState<string | null>(null)
  const [dragging, setDragging] = useState<string | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const tree = snap?.tree ?? null
  const parentForNew = findNode(tree, curFolder)?.kind === 'folder' ? curFolder : ''

  const nodeMenu = (e: MouseEvent, node: FolderNode): void => {
    e.preventDefault()
    const isFolder = node.kind === 'folder'
    const items: MenuItem[] = [
      { label: t('tree.menu.open'), icon: isFolder ? 'folder' : 'layers', onSelect: () => (isFolder ? openFolder(node.rel) : void openProject(node.rel)) },
      { sep: true }
    ]
    if (isFolder) {
      items.push(
        { label: t('tree.menu.newFolder'), icon: 'folderPlus', onSelect: () => setDialog({ kind: 'newFolder', parent: node.rel }) },
        { label: t('tree.menu.newProject'), icon: 'plus', onSelect: () => setDialog({ kind: 'newProject', parent: node.rel }) },
        { sep: true }
      )
    }
    items.push(
      { label: t('tree.menu.rename'), icon: 'edit', onSelect: () => setRenaming(node.rel) },
      { label: t('tree.menu.reveal'), icon: 'external', onSelect: () => void window.gas.workspace.reveal(node.rel) },
      { sep: true },
      {
        label: t('tree.menu.trash'),
        icon: 'trash',
        danger: true,
        onSelect: () => setDialog({ kind: 'trash', rel: node.rel, name: node.name, project: !isFolder, count: node.projectCount })
      }
    )
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  const rootMenu = (e: MouseEvent): void => {
    e.preventDefault()
    setMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: t('tree.menu.newFolder'), icon: 'folderPlus', onSelect: () => setDialog({ kind: 'newFolder', parent: '' }) },
        { label: t('tree.menu.newProject'), icon: 'plus', onSelect: () => setDialog({ kind: 'newProject', parent: '' }) },
        { label: t('coach.ui.sampleCreate'), icon: 'sparkles', onSelect: () => void createSample() },
        { sep: true },
        { label: t('tree.menu.reveal'), icon: 'external', onSelect: () => void window.gas.workspace.reveal('') }
      ]
    })
  }

  const wsMenu = (e: MouseEvent): void => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    setMenu({
      x: r.left + 8,
      y: r.bottom + 4,
      items: [
        { label: t('sidebar.changeWorkspace'), icon: 'folder', onSelect: () => void window.gas.workspace.choose() },
        { label: t('sidebar.revealWorkspace'), icon: 'external', disabled: !snap?.exists, onSelect: () => void window.gas.workspace.reveal('') }
      ]
    })
  }

  const drag: DragApi = {
    over,
    dragging,
    start: (e, node) => {
      e.dataTransfer.setData(DND, node.rel)
      e.dataTransfer.effectAllowed = 'move'
      setDragging(node.rel)
    },
    enter: (e, rel, canDrop) => {
      if (!dragging || !canDrop) return
      if (rel === dragging || rel.startsWith(`${dragging}/`)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (over !== rel) setOver(rel)
    },
    leave: (rel) => {
      if (over === rel) setOver(null)
    },
    drop: (e, rel) => {
      e.preventDefault()
      e.stopPropagation()
      const src = e.dataTransfer.getData(DND)
      setOver(null)
      setDragging(null)
      if (src) void move(src, rel)
    },
    end: () => {
      setOver(null)
      setDragging(null)
    }
  }

  const allAct = route === 'workspace' && curFolder === ''
  const wsPath = snap?.root ?? null

  return (
    <aside className="side" data-coach="ws-tree" aria-hidden={!sidebarOpen} inert={!sidebarOpen}>
      <div className="side-inner">
        <button type="button" className="ws-switch" onClick={wsMenu} title={wsPath ?? undefined}>
          <Logo />
          <div>
            <b>{snap?.name ?? t('sidebar.workspace')}</b>
            <small className={snap && snap.root && !snap.exists ? 'warn' : undefined}>
              {!wsPath ? t('sidebar.noWorkspace') : snap?.exists ? wsPath : t('sidebar.wsMissing')}
            </small>
          </div>
          <Icon name="chev" size={12} className="ws-chev" />
        </button>
        <div className="side-label">
          {t('sidebar.folders')}
          <button
            type="button"
            className="icon-btn"
            aria-label={t('sidebar.newFolder')}
            title={t('sidebar.newFolder')}
            disabled={!tree}
            onClick={() => setDialog({ kind: 'newFolder', parent: parentForNew })}
          >
            <Icon name="folderPlus" size={14} />
          </button>
        </div>
        <nav className="tree" role="tree" onContextMenu={(e) => tree && e.target === e.currentTarget && rootMenu(e)}>
          <div
            className={['tn', allAct && 'act', over === '' && 'drop'].filter(Boolean).join(' ')}
            role="treeitem"
            tabIndex={0}
            aria-selected={allAct}
            style={{ ['--d' as string]: 0 }}
            onClick={() => openFolder('')}
            onKeyDown={(e) => e.key === 'Enter' && openFolder('')}
            onContextMenu={(e) => tree && rootMenu(e)}
            onDragOver={(e) => drag.enter(e, '', true)}
            onDragLeave={() => drag.leave('')}
            onDrop={(e) => drag.drop(e, '')}
          >
            <span className="tw none" />
            <span className="ti">
              <Icon name="grid" size={15} />
            </span>
            <span className="tl">{t('sidebar.allProjects')}</span>
            <span className="tcount">{tree?.projectCount ?? 0}</span>
          </div>
          {tree?.children.map((c) => <TreeNode key={c.rel} node={c} depth={0} onMenu={nodeMenu} drag={drag} />)}
        </nav>
        <div className="side-foot">
          <button type="button" className="btn ghost sm" disabled={!tree} onClick={() => setDialog({ kind: 'newFolder', parent: parentForNew })}>
            <Icon name="folderPlus" size={14} />
            {t('sidebar.newFolder')}
          </button>
          <button type="button" className="btn ghost sm" disabled={!tree} onClick={() => setDialog({ kind: 'newProject', parent: parentForNew })}>
            <Icon name="plus" size={14} />
            {t('sidebar.newProject')}
          </button>
          <div className="grow" />
          <button type="button" className="icon-btn" data-coach="ws-settings" aria-label={t('sidebar.settings')} title={t('sidebar.settings')} onClick={() => openSettings()}>
            <Icon name="gear" />
          </button>
        </div>
      </div>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
    </aside>
  )
}
