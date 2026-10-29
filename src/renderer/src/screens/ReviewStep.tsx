import { useEffect, useMemo, useRef, type MouseEvent, type ReactElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import type { ProjectView } from '@shared/workspace'
import { Icon } from '@renderer/components/Icon'
import { EASE } from '@renderer/lib/motion'
import { RV_CHIP, RV_FILTERS, reviewItems, setDecision, type RvItem, type RvStatus } from '@renderer/lib/review'
import { useQueue } from '@renderer/store/queue'
import { useRv } from '@renderer/store/review'
import { useWs } from '@renderer/store/workspace'
import { toast } from '@renderer/store/toast'
import { ReviewDetail } from './ReviewDetail'

export function RvChip({ status }: { status: RvStatus }): ReactElement {
  const { t } = useTranslation()
  return (
    <span className={`chip ${RV_CHIP[status]}`}>
      {status === 'regen' && <span className="spin xs" />}
      {status === 'approved' && <Icon name="check" size={10} />}
      {(status === 'qa' || status === 'err') && <Icon name="alert" size={10} />}
      {status === 'rejected' && <Icon name="flag" size={10} />}
      {t(`review.status.${status}`)}
    </span>
  )
}

function Tile({ item, index, sel, onOpen, onSel }: { item: RvItem; index: number; sel: boolean; onOpen: (e: MouseEvent) => void; onSel: () => void }): ReactElement {
  const { t } = useTranslation()
  const { input, status } = item
  const busy = status === 'regen'
  return (
    <motion.div
      className={sel ? 'rv-tile sel' : 'rv-tile'}
      role="button"
      tabIndex={0}
      aria-label={`${input.name} · ${t(`review.status.${status}`)}`}
      layout="position"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: EASE, delay: Math.min(index, 24) * 0.018 }}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(e as unknown as MouseEvent)
      }}
    >
      <span
        className="rv-check"
        role="checkbox"
        aria-checked={sel}
        aria-label={t('review.select')}
        onClick={(e) => {
          e.stopPropagation()
          onSel()
        }}
      >
        <Icon name="check" size={12} />
      </span>
      <div className="rv-img">
        <div className="half ck">
          {input.thumb || input.url ? <img src={input.thumb ?? input.url} alt="" draggable={false} /> : null}
          <span className="lab">{t('review.src')}</span>
        </div>
        <div className="half ck">
          <AnimatePresence initial={false} mode="popLayout">
            {input.selectedUrl && (
              <motion.img key={input.selectedUrl} src={input.selectedUrl} alt="" draggable={false} initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: busy ? 0.45 : 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.4, ease: EASE }} />
            )}
          </AnimatePresence>
          {busy && <span className="spin rv-busy" />}
          {!busy && !input.selectedUrl && status === 'err' && <Icon name="alert" size={22} className="rv-erric" />}
          {input.selected > 0 && <span className="lab">v{input.selected}</span>}
        </div>
      </div>
      <div className="rv-foot">
        <span className="tile-name" title={input.outRel}>
          {input.name}
        </span>
        <RvChip status={status} />
      </div>
    </motion.div>
  )
}

export function ReviewStep({ project }: { project: ProjectView }): ReactElement {
  const { t } = useTranslation()
  const setStep = useWs((s) => s.setStep)
  const jobs = useQueue((s) => s.snap?.jobs)
  const { filter, group, sel, detail, bind, setFilter, setGroup, setSel, toggleSel, open } = useRv()
  const anchor = useRef<string | null>(null)

  useEffect(() => bind(project.dir), [bind, project.dir])

  const all = useMemo(() => reviewItems(project, jobs ?? []), [project, jobs])
  const byGroup = useMemo(() => all.filter((x) => group === 'all' || (group === '_none' ? !x.group : x.group?.id === group)), [all, group])
  const list = useMemo(() => byGroup.filter((x) => filter === 'all' || x.status === filter), [byGroup, filter])
  const counts = useMemo(() => {
    const c: Record<string, number> = { all: byGroup.length }
    for (const x of byGroup) c[x.status] = (c[x.status] ?? 0) + 1
    return c
  }, [byGroup])
  const selIds = sel.filter((id) => all.some((x) => x.input.id === id))
  const pendingOk = all.filter((x) => x.status === 'pending')
  const approved = all.filter((x) => x.status === 'approved').length
  const groups = project.groups.filter((g) => all.some((x) => x.group?.id === g.id))
  const hasNoGroup = all.some((x) => !x.group)

  useEffect(() => {
    if (detail) return
    const onKey = (e: KeyboardEvent): void => {
      const el = e.target as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) return
      if (document.querySelector('.modal-root')) return
      if (e.key === 'Escape' && sel.length) {
        e.preventDefault()
        setSel([])
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        setSel(list.map((x) => x.input.id))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [detail, sel.length, list, setSel])

  const onTile = (e: MouseEvent, id: string): void => {
    if (e.shiftKey && anchor.current) {
      const ids = list.map((x) => x.input.id)
      const a = ids.indexOf(anchor.current)
      const b = ids.indexOf(id)
      if (a >= 0 && b >= 0) {
        const range = ids.slice(Math.min(a, b), Math.max(a, b) + 1)
        setSel([...new Set([...sel, ...range])])
        return
      }
    }
    if (e.ctrlKey || e.metaKey || selIds.length) {
      anchor.current = id
      toggleSel(id)
      return
    }
    anchor.current = id
    open(id)
  }

  const approve = async (ids: string[], on: boolean): Promise<void> => {
    const target = ids.filter((id) => {
      const it = all.find((x) => x.input.id === id)
      return it && it.input.selected > 0 && it.status !== 'regen'
    })
    if (!target.length) return
    await setDecision(target, on ? 'approved' : null)
    toast(t(on ? 'review.approvedToast' : 'review.unapprovedToast', { count: target.length }))
    setSel([])
  }

  if (!all.length) {
    return (
      <div className="rv-wrap">
        <div className="proj-state">
          <div className="empty">
            <Icon name="image" size={34} />
            <h3>{t('review.emptyAll')}</h3>
            <p>{t('review.emptyAllDesc')}</p>
            <div className="actions">
              <button type="button" className="btn" onClick={() => setStep(3)}>
                <Icon name="left" size={14} />
                {t('review.toGen')}
              </button>
            </div>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className={selIds.length ? 'rv-wrap selmode' : 'rv-wrap'}>
      <div className="toolbar rv-bar">
        <div className="fchips" role="tablist">
          {RV_FILTERS.map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} className={filter === f ? 'fchip on' : 'fchip'} onClick={() => setFilter(f)}>
              {t(`review.filters.${f}`)}
              <b>{counts[f] ?? 0}</b>
            </button>
          ))}
        </div>
        {(groups.length > 1 || (groups.length > 0 && hasNoGroup)) && (
          <select className="dd sm" aria-label={t('review.groupFilter')} value={group} onChange={(e) => setGroup(e.target.value)}>
            <option value="all">{t('review.allGroups')}</option>
            {groups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.name}
              </option>
            ))}
            {hasNoGroup && <option value="_none">{t('review.noGroup')}</option>}
          </select>
        )}
        <div className="grow" />
        <AnimatePresence mode="popLayout" initial={false}>
          {selIds.length ? (
            <motion.div key="sel" className="rv-batch" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18, ease: EASE }}>
              <span className="muted">{t('review.selected', { count: selIds.length })}</span>
              <button type="button" className="btn sm ghost" onClick={() => setSel([])}>
                {t('review.clear')}
              </button>
              <button type="button" className="btn sm" onClick={() => void approve(selIds, false)}>
                <Icon name="x" size={13} />
                {t('review.unapproveSel')}
              </button>
              <button type="button" className="btn sm primary" onClick={() => void approve(selIds, true)}>
                <Icon name="check" size={13} />
                {t('review.approveSel')}
              </button>
            </motion.div>
          ) : (
            <motion.div key="qa" className="rv-batch" initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.18, ease: EASE }}>
              <button type="button" className="btn sm ghost" onClick={() => setSel(list.map((x) => x.input.id))}>
                {t('review.selectAll')}
              </button>
              <button type="button" className="btn sm" disabled={!pendingOk.length} onClick={() => void approve(pendingOk.map((x) => x.input.id), true)}>
                <Icon name="check" size={13} />
                {t('review.approveQa', { count: pendingOk.length })}
              </button>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <div className="rv-grid">
        {list.map((x, i) => (
          <Tile key={x.input.id} item={x} index={i} sel={selIds.includes(x.input.id)} onOpen={(e) => onTile(e, x.input.id)} onSel={() => toggleSel(x.input.id)} />
        ))}
        {!list.length && (
          <div className="empty rv-empty">
            <Icon name="check" size={30} />
            <h3>{t('review.empty')}</h3>
          </div>
        )}
      </div>
      <div className="footbar">
        <div className="keys">
          <span>
            <kbd>Enter</kbd> {t('review.keys.open')}
          </span>
          <span>
            <kbd>A</kbd> {t('review.keys.approve')}
          </span>
          <span>
            <kbd>R</kbd> {t('review.keys.regen')}
          </span>
          <span>
            <kbd>X</kbd> {t('review.keys.reject')}
          </span>
          <span>
            <kbd>←</kbd>
            <kbd>→</kbd> {t('review.keys.nav')}
          </span>
          <span>
            <kbd>Space</kbd> {t('review.keys.hold')}
          </span>
          <span>
            <kbd>1</kbd>
            <kbd>2</kbd>
            <kbd>3</kbd> {t('review.keys.modes')}
          </span>
        </div>
        <div className="grow" />
        <button type="button" className="btn primary" disabled={!approved} onClick={() => setStep(5)}>
          {t('review.next')}
          <Icon name="right" size={14} />
        </button>
      </div>
      <ReviewDetail project={project} items={list.length && detail && list.some((x) => x.input.id === detail) ? list : all} />
    </div>
  )
}
