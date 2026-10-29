import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as RMouseEvent, type ReactElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { MAX_PER_RUN, type InputType, type InputView, type ProjectView } from '@shared/workspace'
import { Icon } from '@renderer/components/Icon'
import { EASE, fadeTransition } from '@renderer/lib/motion'
import { fileSize } from '@renderer/lib/format'
import { useWs } from '@renderer/store/workspace'
import { toast } from '@renderer/store/toast'

interface DirNode {
  path: string
  name: string
  count: number
  children: DirNode[]
}

function buildDirs(inputs: InputView[]): DirNode[] {
  const root: DirNode = { path: '', name: '', count: 0, children: [] }
  for (const i of inputs) {
    if (!i.dir) continue
    let node = root
    const parts = i.dir.split('/')
    parts.forEach((part, idx) => {
      const path = parts.slice(0, idx + 1).join('/')
      let child = node.children.find((c) => c.path === path)
      if (!child) {
        child = { path, name: part, count: 0, children: [] }
        node.children.push(child)
      }
      child.count++
      node = child
    })
  }
  const sort = (n: DirNode): void => {
    n.children.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    n.children.forEach(sort)
  }
  sort(root)
  return root.children
}

function inDir(i: InputView, dir: string | null): boolean {
  if (dir === null) return true
  return i.dir === dir || i.dir.startsWith(`${dir}/`)
}

function DirTree({ nodes, depth, filter, onPick }: { nodes: DirNode[]; depth: number; filter: string | null; onPick: (d: string) => void }): ReactElement {
  return (
    <>
      {nodes.map((n) => (
        <div key={n.path}>
          <button type="button" className={filter === n.path ? 'dt on' : 'dt'} style={{ ['--d' as string]: depth }} onClick={() => onPick(n.path)} title={n.path}>
            <Icon name="folder" size={14} />
            <span className="dt-n">{n.name}</span>
            <span className="dt-c">{n.count}</span>
          </button>
          {n.children.length > 0 && <DirTree nodes={n.children} depth={depth + 1} filter={filter} onPick={onPick} />}
        </div>
      ))}
    </>
  )
}

function TypeChip({ input, onCycle }: { input: InputView; onCycle: () => void }): ReactElement {
  const { t } = useTranslation()
  if (input.type === 'sprite') {
    return (
      <span className="tchip dev" title={t('input.type.spriteHint')}>
        <Icon name="lock" size={10} />
        {t('input.type.sprite')}
      </span>
    )
  }
  return (
    <button
      type="button"
      className={input.type === 'nine' ? 'tchip nine' : 'tchip'}
      title={t('input.type.hint')}
      onClick={(e) => {
        e.stopPropagation()
        onCycle()
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      {input.type === 'nine' ? t('input.type.nine') : t('input.type.normal')}
    </button>
  )
}

function Tile({
  input,
  index,
  selected,
  onPick,
  onCycle
}: {
  input: InputView
  index: number
  selected: boolean
  onPick: (e: RMouseEvent, id: string) => void
  onCycle: (input: InputView) => void
}): ReactElement {
  const { t } = useTranslation()
  const cls = ['tile', selected && 'sel', input.status === 'missing' && 'missing'].filter(Boolean).join(' ')
  return (
    <motion.div
      className={cls}
      data-id={input.id}
      tabIndex={0}
      role="option"
      aria-selected={selected}
      initial={{ opacity: 0, y: 8, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.28, ease: EASE, delay: Math.min(index, 24) * 0.018 }}
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => onPick(e, input.id)}
      onKeyDown={(e) => {
        if (e.key === ' ' || e.key === 'Enter') {
          e.preventDefault()
          onPick(e as unknown as RMouseEvent, input.id)
        }
      }}
    >
      <div className="thumb ck">
        {input.thumb ? (
          <img src={input.thumb} alt="" draggable={false} loading="lazy" />
        ) : (
          <span className="thumb-missing">
            <Icon name={input.status === 'missing' ? 'alert' : 'image'} size={22} />
          </span>
        )}
        {input.status !== 'ok' && (
          <span className={input.status === 'missing' ? 'chip c-red tstat' : 'chip c-orange tstat'}>
            <Icon name="alert" size={10} />
            {t(`input.status.${input.status}`)}
          </span>
        )}
      </div>
      <div className="tile-name" title={input.rel}>
        {input.name}
      </div>
      <div className="tile-meta">
        <span className="mono">
          {input.w}×{input.h}
        </span>
        <TypeChip input={input} onCycle={() => onCycle(input)} />
      </div>
    </motion.div>
  )
}

function Preview({
  selected,
  focus,
  onType,
  onRemove
}: {
  selected: InputView[]
  focus: InputView | null
  onType: (ids: string[], type: InputType) => void
  onRemove: (ids: string[]) => void
}): ReactElement {
  const { t } = useTranslation()
  const item = selected.length === 1 ? selected[0] : selected.length === 0 ? focus : null
  const ids = item ? [item.id] : selected.map((s) => s.id)
  const types: InputType[] = ['normal', 'nine', 'sprite']
  const curType = item ? item.type : selected.every((s) => s.type === selected[0]?.type) ? selected[0]?.type : null

  if (!item && !selected.length) {
    return (
      <aside className="insp">
        <div className="insp-empty">
          <Icon name="eye" size={26} />
          <span>{t('input.preview.empty')}</span>
        </div>
      </aside>
    )
  }

  return (
    <aside className="insp">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={item ? item.id : `multi-${selected.length}`} className="insp-in" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fadeTransition}>
          {item ? (
            <>
              <div className="pv ck">
                {item.status === 'missing' ? (
                  <span className="thumb-missing">
                    <Icon name="alert" size={30} />
                  </span>
                ) : (
                  <img src={item.url} alt={item.name} draggable={false} />
                )}
              </div>
              <section>
                <h3 className="pv-name" title={item.name}>
                  {item.name}
                </h3>
                <div className="pv-path mono" title={item.abs}>
                  {item.abs}
                </div>
                {item.status !== 'ok' && (
                  <div className={item.status === 'missing' ? 'note err' : 'note warn'}>
                    <Icon name="alert" size={14} />
                    <span>{t(`input.status.${item.status}`)}</span>
                  </div>
                )}
                <dl className="kv">
                  <dt>{t('input.preview.size')}</dt>
                  <dd className="mono">
                    {item.w} × {item.h}
                  </dd>
                  <dt>{t('input.preview.alpha')}</dt>
                  <dd>
                    <span className={item.alpha ? 'chip c-green' : 'chip c-orange'}>{item.alpha ? t('input.preview.yes') : t('input.preview.no')}</span>
                  </dd>
                  <dt>{t('input.preview.file')}</dt>
                  <dd className="mono">{fileSize(item.size)}</dd>
                  <dt>{t('input.preview.kind')}</dt>
                  <dd>
                    <span className="chip c-gray">{t(`input.kind.${item.kind}`)}</span>
                  </dd>
                </dl>
              </section>
            </>
          ) : (
            <section>
              <div className="multi-stack">
                {selected.slice(0, 3).map((s, i) => (
                  <div className="ms ck" key={s.id} style={{ ['--k' as string]: i }}>
                    {s.thumb && <img src={s.thumb} alt="" draggable={false} />}
                  </div>
                ))}
              </div>
              <h3>{t('input.preview.multi', { count: selected.length })}</h3>
            </section>
          )}
          <section>
            <h3 className="sec-t">{item ? t('input.preview.type') : t('input.preview.setType', { count: ids.length })}</h3>
            <div className="type-seg" role="radiogroup">
              {types.map((ty) => (
                <button
                  key={ty}
                  type="button"
                  role="radio"
                  aria-checked={curType === ty}
                  className={curType === ty ? 'on' : undefined}
                  disabled={ty === 'sprite'}
                  title={ty === 'sprite' ? t('input.type.spriteHint') : undefined}
                  onClick={() => onType(ids, ty)}
                >
                  {ty === 'sprite' && <Icon name="lock" size={11} />}
                  {t(`input.type.${ty}`)}
                </button>
              ))}
            </div>
            {item && item.typeAuto && <div className="hint">{t('input.type.hint')}</div>}
          </section>
          <div className="acts">
            <button type="button" className="btn danger" onClick={() => onRemove(ids)}>
              <Icon name="trash" size={14} />
              {t('input.remove')}
            </button>
          </div>
        </motion.div>
      </AnimatePresence>
    </aside>
  )
}

export function InputStep({ project }: { project: ProjectView }): ReactElement {
  const { t } = useTranslation()
  const busy = useWs((s) => s.busy)
  const runAdd = useWs((s) => s.runAdd)
  const setProject = useWs((s) => s.setProject)
  const setStep = useWs((s) => s.setStep)
  const skipped = useWs((s) => s.skipped)
  const clearSkipped = useWs((s) => s.clearSkipped)
  const [sel, setSel] = useState<Set<string>>(new Set())
  const [anchor, setAnchor] = useState<string | null>(null)
  const [focus, setFocus] = useState<string | null>(null)
  const [filter, setFilter] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const [box, setBox] = useState<{ x: number; y: number; w: number; h: number } | null>(null)
  const gridRef = useRef<HTMLDivElement>(null)
  const depth = useRef(0)
  const rel = project.rel

  const inputs = project.inputs
  const dirs = useMemo(() => buildDirs(inputs), [inputs])
  const visible = useMemo(() => inputs.filter((i) => inDir(i, filter)), [inputs, filter])
  const sections = useMemo(() => {
    const map = new Map<string, InputView[]>()
    for (const i of visible) {
      const list = map.get(i.dir) ?? []
      list.push(i)
      map.set(i.dir, list)
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0], undefined, { numeric: true, sensitivity: 'base' }))
  }, [visible])
  const ordered = useMemo(() => sections.flatMap(([, list]) => list), [sections])

  useEffect(() => {
    const ids = new Set(inputs.map((i) => i.id))
    setSel((s) => {
      const next = new Set([...s].filter((id) => ids.has(id)))
      return next.size === s.size ? s : next
    })
    if (focus && !ids.has(focus)) setFocus(null)
    if (filter !== null && !inputs.some((i) => inDir(i, filter))) setFilter(null)
  }, [inputs, focus, filter])

  const addPaths = useCallback((paths: string[]) => void runAdd(() => window.gas.project.addPaths(rel, paths)), [rel, runAdd])

  useEffect(() => {
    const hasFiles = (e: DragEvent): boolean => !!e.dataTransfer && [...e.dataTransfer.types].includes('Files')
    const enter = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current++
      setDrag(true)
    }
    const over = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const leave = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (!depth.current) setDrag(false)
    }
    const drop = (e: DragEvent): void => {
      if (!hasFiles(e)) return
      e.preventDefault()
      depth.current = 0
      setDrag(false)
      const paths = [...(e.dataTransfer?.files ?? [])].map((f) => window.gas.files.pathFor(f)).filter(Boolean)
      if (paths.length) addPaths(paths)
    }
    window.addEventListener('dragenter', enter)
    window.addEventListener('dragover', over)
    window.addEventListener('dragleave', leave)
    window.addEventListener('drop', drop)
    return () => {
      window.removeEventListener('dragenter', enter)
      window.removeEventListener('dragover', over)
      window.removeEventListener('dragleave', leave)
      window.removeEventListener('drop', drop)
    }
  }, [addPaths])

  const remove = useCallback(
    async (ids: string[]) => {
      if (!ids.length) return
      const view = await window.gas.project.remove(rel, ids)
      if (view) {
        setProject(view)
        toast(t('toast.removed', { count: ids.length }))
      }
      setSel(new Set())
      setFocus(null)
    },
    [rel, setProject, t]
  )

  const setType = useCallback(
    async (ids: string[], type: InputType) => {
      if (type === 'sprite' || !ids.length) return
      const view = await window.gas.project.setType(rel, ids, type)
      if (view) {
        setProject(view)
        if (ids.length > 1) toast(t('toast.typeSet', { count: ids.length, type: t(`input.type.${type}`) }))
      }
    },
    [rel, setProject, t]
  )

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || document.querySelector('.modal-root, .menu')) return
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSel(new Set(ordered.map((i) => i.id)))
      } else if (e.key === 'Delete' && sel.size) {
        e.preventDefault()
        void remove([...sel])
      } else if (e.key === 'Escape') {
        setSel(new Set())
      }
    }
    window.addEventListener('keydown', key)
    return () => window.removeEventListener('keydown', key)
  }, [ordered, sel, remove])

  const pick = (e: RMouseEvent, id: string): void => {
    if (e.shiftKey && anchor) {
      const a = ordered.findIndex((i) => i.id === anchor)
      const b = ordered.findIndex((i) => i.id === id)
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a]
        const range = ordered.slice(lo, hi + 1).map((i) => i.id)
        setSel(new Set(e.ctrlKey || e.metaKey ? [...sel, ...range] : range))
        setFocus(id)
        return
      }
    }
    if (e.ctrlKey || e.metaKey) {
      const next = new Set(sel)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setSel(next)
    } else {
      setSel(new Set([id]))
    }
    setAnchor(id)
    setFocus(id)
  }

  const startMarquee = (e: RMouseEvent): void => {
    if (e.button !== 0) return
    const wrap = gridRef.current
    if (!wrap) return
    const r0 = wrap.getBoundingClientRect()
    if (e.clientX > r0.left + wrap.clientWidth) return
    const sx = e.clientX - r0.left + wrap.scrollLeft
    const sy = e.clientY - r0.top + wrap.scrollTop
    const base = e.ctrlKey || e.metaKey || e.shiftKey ? new Set(sel) : new Set<string>()
    let moved = false
    let lastX = e.clientX
    let lastY = e.clientY
    const update = (): void => {
      const r = wrap.getBoundingClientRect()
      const cx = lastX - r.left + wrap.scrollLeft
      const cy = lastY - r.top + wrap.scrollTop
      const x = Math.min(sx, cx)
      const y = Math.min(sy, cy)
      const w = Math.abs(cx - sx)
      const h = Math.abs(cy - sy)
      if (!moved && w < 4 && h < 4) return
      moved = true
      setBox({ x, y, w, h })
      const hit = new Set(base)
      wrap.querySelectorAll<HTMLElement>('[data-id]').forEach((el) => {
        const tr = el.getBoundingClientRect()
        const tx = tr.left - r.left + wrap.scrollLeft
        const ty = tr.top - r.top + wrap.scrollTop
        if (tx < x + w && tx + tr.width > x && ty < y + h && ty + tr.height > y) hit.add(el.dataset.id as string)
      })
      setSel(hit)
    }
    const move = (ev: MouseEvent): void => {
      lastX = ev.clientX
      lastY = ev.clientY
      update()
    }
    const scroll = (): void => update()
    const up = (): void => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      wrap.removeEventListener('scroll', scroll)
      setBox(null)
      if (!moved) {
        setSel(base)
        if (!base.size) setFocus(null)
      }
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
    wrap.addEventListener('scroll', scroll)
  }

  const selected = useMemo(() => inputs.filter((i) => sel.has(i.id)), [inputs, sel])
  const focusItem = inputs.find((i) => i.id === focus) ?? null
  const missingRoots = project.roots.filter((r) => r.missingCount > 0)
  const changed = inputs.filter((i) => i.status === 'changed').length
  const rootLabel = project.commonRoot ? project.commonRoot.split(/[\\/]/).filter(Boolean).pop() ?? project.commonRoot : ''

  const overlay = (
    <AnimatePresence>
      {drag && (
        <motion.div className="drop-ov" initial={{ opacity: 0, scale: 0.985 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.985 }} transition={fadeTransition}>
          <Icon name="upload" size={30} />
          <b>{t('input.dropTitle')}</b>
          <span>{t('input.dropDesc')}</span>
        </motion.div>
      )}
    </AnimatePresence>
  )

  const actions = (
    <>
      <button type="button" className="btn" disabled={busy} onClick={() => void runAdd(() => window.gas.project.addDialog(rel, 'folder'))}>
        <Icon name="folder" size={14} />
        {t('input.openFolder')}
      </button>
      <button type="button" className="btn" disabled={busy} onClick={() => void runAdd(() => window.gas.project.addDialog(rel, 'files'))}>
        <Icon name="image" size={14} />
        {t('input.addFiles')}
      </button>
    </>
  )

  const skippedNote =
    skipped.length > 0 ? (
      <div className="note warn">
        <Icon name="alert" size={14} />
        <span className="note-t">
          {t('input.skippedNote', { count: skipped.length })}{' '}
          <span className="mono">
            {skipped
              .slice(0, 4)
              .map((s) => s.name)
              .join(', ')}
            {skipped.length > 4 ? '…' : ''}
          </span>
        </span>
        <button type="button" className="btn ghost sm" onClick={clearSkipped}>
          {t('input.dismiss')}
        </button>
      </div>
    ) : null

  if (!inputs.length) {
    return (
      <div className="input-wrap">
        {skippedNote && <div className="notes">{skippedNote}</div>}
        <div className="empty-drop big">
          {busy ? <span className="spin lg" /> : <Icon name="upload" size={40} />}
          <h2>{busy ? t('input.reading') : t('input.emptyTitle')}</h2>
          <p>{t('input.emptyDesc')}</p>
          <div className="actions">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void runAdd(() => window.gas.project.addDialog(rel, 'folder'))}>
              <Icon name="folder" size={14} />
              {t('input.openFolder')}
            </button>
            <button type="button" className="btn" disabled={busy} onClick={() => void runAdd(() => window.gas.project.addDialog(rel, 'files'))}>
              <Icon name="image" size={14} />
              {t('input.addFiles')}
            </button>
          </div>
        </div>
        {overlay}
      </div>
    )
  }

  let tileIndex = 0
  return (
    <div className="input-wrap">
      <div className="toolbar">
        {actions}
        <span className="sep-v" />
        <span className="muted">{t('input.selected', { sel: sel.size, total: inputs.length })}</span>
        <button type="button" className="btn ghost sm" onClick={() => setSel(sel.size === ordered.length && ordered.length ? new Set() : new Set(ordered.map((i) => i.id)))}>
          {sel.size === ordered.length && ordered.length ? t('input.deselect') : t('input.selectAll')}
        </button>
        <button type="button" className="btn ghost sm danger" disabled={!sel.size} onClick={() => void remove([...sel])}>
          <Icon name="trash" size={14} />
          {t('input.remove')}
        </button>
        <div className="grow" />
        {busy && (
          <span className="busy-chip">
            <span className="spin" />
            {t('input.reading')}
          </span>
        )}
        {project.commonRoot && (
          <span className="root-chip" title={project.commonRoot}>
            <span className="muted">{t('input.commonRoot')}:</span>
            <span className="mono">{project.commonRoot}</span>
          </span>
        )}
      </div>
      {(skippedNote || missingRoots.length > 0 || changed > 0 || inputs.length > MAX_PER_RUN) && (
        <div className="notes">
          {missingRoots.map((r) => (
            <div className="note err" key={r.index}>
              <Icon name="alert" size={14} />
              <span className="note-t">
                {t('input.missing', { count: r.missingCount, path: r.path })}
              </span>
              <button
                type="button"
                className="btn sm"
                onClick={async () => {
                  const view = await window.gas.project.relink(rel, r.index)
                  if (!view) return
                  setProject(view)
                  const still = view.roots.find((x) => x.index === r.index)?.missingCount ?? 0
                  toast(still ? t('toast.relinkStill', { count: still }) : t('toast.relinked'), still ? 'warn' : 'ok')
                }}
              >
                <Icon name="link" size={13} />
                {t('input.relink')}
              </button>
            </div>
          ))}
          {changed > 0 && (
            <div className="note warn">
              <Icon name="refresh" size={14} />
              <span className="note-t">{t('input.changed', { count: changed })}</span>
            </div>
          )}
          {inputs.length > MAX_PER_RUN && (
            <div className="note warn">
              <Icon name="alert" size={14} />
              <span className="note-t">{t('input.overLimit', { count: inputs.length })}</span>
            </div>
          )}
          {skippedNote}
        </div>
      )}
      <div className="split">
        <div className="dir-tree">
          <button type="button" className={filter === null ? 'dt on' : 'dt'} style={{ ['--d' as string]: 0 }} onClick={() => setFilter(null)}>
            <Icon name="grid" size={14} />
            <span className="dt-n">{t('input.all')}</span>
            <span className="dt-c">{inputs.length}</span>
          </button>
          <DirTree nodes={dirs} depth={0} filter={filter} onPick={setFilter} />
        </div>
        <div className="grid-wrap" ref={gridRef} onMouseDown={startMarquee} role="listbox" aria-multiselectable="true">
          {sections.map(([dir, list]) => (
            <section key={dir || '.'}>
              <h3 className="dir-h">
                <Icon name="folder" size={14} />
                {dir || rootLabel}
                <span>{list.length}</span>
              </h3>
              <div className="tiles">
                {list.map((i) => (
                  <Tile key={i.id} input={i} index={tileIndex++} selected={sel.has(i.id)} onPick={pick} onCycle={(x) => void setType([x.id], x.type === 'nine' ? 'normal' : 'nine')} />
                ))}
              </div>
            </section>
          ))}
          {box && <div className="marquee" style={{ left: box.x, top: box.y, width: box.w, height: box.h }} />}
        </div>
        <Preview selected={selected} focus={focusItem} onType={(ids, ty) => void setType(ids, ty)} onRemove={(ids) => void remove(ids)} />
      </div>
      <div className="footbar">
        <span>{t('input.footer', { count: inputs.length })}</span>
        <div className="grow" />
        <button type="button" className="btn primary" onClick={() => setStep(2)}>
          {t('input.next')}
          <Icon name="right" size={14} />
        </button>
      </div>
      {overlay}
    </div>
  )
}
