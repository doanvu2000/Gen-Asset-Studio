import { useCallback, useEffect, useMemo, useState, type MouseEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { SpinePlayer } from '@esotericsoftware/spine-player'
import type { QueueJob } from '@shared/queue'
import type { SpineProjectView, SpineRegionView } from '@shared/spine'
import { Icon } from '@renderer/components/Icon'
import { Segmented } from '@renderer/components/Segmented'
import { SpineCompare } from '@renderer/components/spine/SpineCompare'
import { useViewer } from '@renderer/components/spine/SpinePreview'
import { applyRig, origRigFromData, parseOrigRig, RigEditor } from '@renderer/components/spine/RigEditor'
import { regionJob, regionQaFail, regionReviewState, regionState, rigEditCount, spineStepLock, type RegionReviewState } from '@renderer/lib/spine'
import { isActive, samePath, useQueue } from '@renderer/store/queue'
import { useSpine } from '@renderer/store/spine'
import { toast } from '@renderer/store/toast'

type Filter = 'all' | 'todo' | 'pending' | 'rejected' | 'approved'

const STATE_CHIP: Record<RegionReviewState, string> = {
  none: 'c-gray',
  queued: 'c-gray',
  running: 'c-blue',
  error: 'c-red',
  pending: 'c-blue',
  approved: 'c-green',
  rejected: 'c-orange'
}

function matches(r: SpineRegionView, f: Filter): boolean {
  if (f === 'all') return true
  if (f === 'todo') return !r.versions.length
  if (!r.versions.length) return false
  if (f === 'pending') return !r.decision
  return r.decision === f
}

function StateChip({ state, job }: { state: RegionReviewState; job: QueueJob | null }): ReactElement {
  const { t } = useTranslation()
  if (state === 'running') {
    return (
      <span className="chip c-blue" title={job?.progress}>
        <span className="spin sm" />
        {t(`spriteProject.gen.step.${job?.step ?? 'waiting'}`)}
      </span>
    )
  }
  return (
    <span className={`chip ${STATE_CHIP[state]}`}>
      {state === 'approved' && <Icon name="check" size={10} />}
      {t(`spineProject.gen.st.${state}`)}
    </span>
  )
}

function Row({ v, r, job, on, onPick }: { v: SpineProjectView; r: SpineRegionView; job: QueueJob | null; on: boolean; onPick: () => void }): ReactElement {
  const { t } = useTranslation()
  const enqueue = useSpine((s) => s.enqueue)
  const state = regionReviewState(r, job)
  const gen = regionState(r, job)
  const stop = (fn: () => void) => (e: MouseEvent) => {
    e.stopPropagation()
    fn()
  }
  return (
    <div
      role="button"
      tabIndex={0}
      aria-pressed={on}
      className={['spg-row', 'sgr-row', on && 'on', !r.used && 'unused'].filter(Boolean).join(' ')}
      onClick={onPick}
      onKeyDown={(e) => {
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onPick()
        }
      }}
    >
      <div className="spg-pv ck sm">{r.sourceUrl ? <img src={r.sourceUrl} alt="" draggable={false} /> : null}</div>
      <Icon name="right" size={12} />
      <div className="spg-pv ck sm">{r.url ? <img src={r.url} alt="" draggable={false} /> : <Icon name="sparkles" size={14} />}</div>
      <div className="spg-name">
        <b title={r.name}>{r.name}</b>
        <small>
          {r.w}×{r.h}
          {r.versions.length > 0 ? ` · v${r.selected}` : ''} · {r.slots.join(', ') || t('spineProject.regions.unused')}
        </small>
      </div>
      <div className="grow" />
      {regionQaFail(r) && (
        <span className="chip c-orange" title={t('spriteProject.gen.qaWarn')}>
          <Icon name="alert" size={10} />
          QA
        </span>
      )}
      <StateChip state={state} job={job} />
      {gen === 'error' && job && (
        <button type="button" className="btn sm" title={job.error?.message} onClick={stop(() => void window.gas.queue.retry(job.id))}>
          <Icon name="refresh" size={13} />
          {t('spriteProject.gen.retry')}
        </button>
      )}
      {gen === 'none' && (
        <button type="button" className="btn sm" disabled={!v.style.locked} onClick={stop(() => void enqueue([r.key]))}>
          <Icon name="sparkles" size={13} />
          {t('spriteProject.gen.gen')}
        </button>
      )}
      {(gen === 'queued' || gen === 'running') && job && (
        <button type="button" className="btn ghost sm" onClick={stop(() => void window.gas.queue.cancel(job.id))}>
          <Icon name="x" size={13} />
          {t('spriteProject.gen.cancelOne')}
        </button>
      )}
    </div>
  )
}

function Detail({ r, job, onNext, onClose }: { r: SpineRegionView; job: QueueJob | null; onNext: () => void; onClose: () => void }): ReactElement {
  const { t } = useTranslation()
  const review = useSpine((s) => s.review)
  const enqueue = useSpine((s) => s.enqueue)
  const [zoom, setZoom] = useState(2)
  const [note, setNote] = useState('')
  const [regen, setRegen] = useState(false)
  const state = regionState(r, job)
  const busy = state === 'running' || state === 'queued'

  const approve = useCallback(() => {
    if (!r.url) return
    void review({ [r.key]: { decision: 'approved' } })
    onNext()
  }, [review, r.key, r.url, onNext])
  const reject = useCallback(() => {
    if (!r.url) return
    void review({ [r.key]: { decision: 'rejected' } })
  }, [review, r.key, r.url])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.ctrlKey || e.metaKey || e.altKey) return
      if (e.key === 'a' || e.key === 'A') approve()
      else if (e.key === 'x' || e.key === 'X') reject()
      else if (e.key === 'r' || e.key === 'R') setRegen(true)
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [approve, reject, onClose])

  const w = Math.min(200, r.w * zoom)
  return (
    <div className="sgr-detail">
      <div className="spr-d-head">
        <div>
          <b>{r.name}</b>
          <small className="muted">
            {r.page} · {r.w}×{r.h} · {r.slots.join(', ') || '—'}
          </small>
        </div>
        <div className="grow" />
        <select className="inp sm" value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom">
          {[1, 2, 3, 4].map((z) => (
            <option key={z} value={z}>
              {z}×
            </option>
          ))}
        </select>
        <button type="button" className="icon-btn" aria-label={t('dialogs.cancel')} onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="spr-d-stage">
        <figure className="ck">
          {r.sourceUrl && <img src={r.sourceUrl} alt="" draggable={false} style={{ width: w, imageRendering: zoom > 1 ? 'pixelated' : undefined }} />}
          <figcaption>{t('spriteProject.gen.orig')}</figcaption>
        </figure>
        <figure className="ck">
          {r.url ? <img src={r.url} alt="" draggable={false} style={{ width: w, imageRendering: zoom > 1 ? 'pixelated' : undefined }} /> : <Icon name="sparkles" size={18} />}
          <figcaption>{t('spriteProject.gen.new')}</figcaption>
        </figure>
      </div>
      {state === 'error' && job?.error && (
        <div className="note err">
          <Icon name="alert" size={14} />
          <span>{job.error.message}</span>
        </div>
      )}
      {r.qa && (
        <section className="spr-d-sec">
          <h4>QA</h4>
          <ul className="spr-qa">
            {r.qa.checks.map((c) => (
              <li key={c.id} className={c.status}>
                <button type="button" disabled>
                  <Icon name={c.status === 'pass' ? 'check' : 'alert'} size={12} />
                  <span>{c.id}</span>
                  <small>{c.message}</small>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {r.versions.length > 1 && (
        <section className="spr-d-sec">
          <h4>{t('spriteProject.review.versions')}</h4>
          <div className="spr-vers">
            {[...r.versions].reverse().map((ver) => (
              <button key={ver} type="button" className={ver === r.selected ? 'spr-ver on' : 'spr-ver'} onClick={() => void review({ [r.key]: { selected: ver, decision: null } })}>
                <b>v{ver}</b>
              </button>
            ))}
          </div>
        </section>
      )}
      {regen && (
        <section className="spr-d-sec">
          <label className="fld">
            <span>{t('spriteProject.review.regenNote')}</span>
            <textarea className="inp" rows={3} autoFocus value={note} placeholder={t('spineProject.review.regenPh')} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="sps-row">
            <button type="button" className="btn ghost sm" onClick={() => setRegen(false)}>
              {t('dialogs.cancel')}
            </button>
            <button
              type="button"
              className="btn primary sm"
              disabled={busy}
              onClick={async () => {
                const n = await enqueue([r.key], note.trim() || undefined)
                if (n > 0) {
                  setRegen(false)
                  setNote('')
                }
              }}
            >
              <Icon name="sparkles" size={13} />
              {t('spriteProject.review.regenGo')}
            </button>
          </div>
        </section>
      )}
      <div className="spr-d-acts">
        {busy ? (
          <span className="chip c-blue">
            <span className="spin sm" />
            {t('spriteProject.review.regenRunning')}
          </span>
        ) : (
          <button type="button" className="btn" onClick={() => setRegen((x) => !x)} title="R">
            <Icon name={r.versions.length ? 'refresh' : 'sparkles'} size={14} />
            {r.versions.length ? t('spriteProject.gen.regen') : t('spriteProject.gen.gen')}
          </button>
        )}
        <div className="grow" />
        <button type="button" className={r.decision === 'rejected' ? 'btn danger solid' : 'btn'} disabled={!r.url} onClick={reject} title="X">
          <Icon name="x" size={14} />
          {t('spriteProject.review.reject')}
        </button>
        <button type="button" className={r.decision === 'approved' ? 'btn green solid' : 'btn primary'} disabled={!r.url} onClick={approve} title="A">
          <Icon name="check" size={14} />
          {t('spriteProject.review.approve')}
        </button>
      </div>
    </div>
  )
}

export function SpineGenReviewStep({ v }: { v: SpineProjectView }): ReactElement {
  const { t } = useTranslation()
  const enqueue = useSpine((s) => s.enqueue)
  const review = useSpine((s) => s.review)
  const setStep = useSpine((s) => s.setStep)
  const setRig = useSpine((s) => s.setRig)
  const flushRig = useSpine((s) => s.flushRig)
  const orig = useSpine((s) => s.orig)
  const next = useSpine((s) => s.next)
  const snap = useQueue((s) => s.snap)
  const jobs = useMemo(() => snap?.jobs ?? [], [snap])
  const viewer = useViewer()
  const [filter, setFilter] = useState<Filter>('all')
  const [pick, setPick] = useState<string | null>(null)
  const [rigOpen, setRigOpen] = useState(false)
  const [player, setPlayer] = useState<SpinePlayer | null>(null)
  const [origPlayer, setOrigPlayer] = useState<SpinePlayer | null>(null)
  const [rigSlots, setRigSlots] = useState<string[]>([])

  useEffect(() => () => void flushRig(), [flushRig])

  const jobOf = useMemo(() => new Map(v.regions.map((r) => [r.key, regionJob(v, r, jobs)])), [v, jobs])
  const list = useMemo(() => v.regions.filter((r) => matches(r, filter)), [v.regions, filter])
  const pages = useMemo(() => [...new Set(list.map((r) => r.page))], [list])
  const cur = v.regions.find((r) => r.key === pick) ?? null
  const used = v.regions.filter((r) => r.used)
  const busyKeys = new Set(v.regions.filter((r) => ['queued', 'running'].includes(regionState(r, jobOf.get(r.key) ?? null))).map((r) => r.key))
  const todo = used.filter((r) => !r.versions.length && !busyKeys.has(r.key))
  const generated = v.regions.filter((r) => r.versions.length > 0)
  const approved = generated.filter((r) => r.decision === 'approved').length
  const qaOk = generated.filter((r) => !r.decision && !regionQaFail(r))
  const active = jobs.filter((j) => samePath(j.projectPath, v.dir) && isActive(j))
  const paused = !!snap?.paused
  const rigN = rigEditCount(v)
  const rigReady = !!v.skeleton && generated.length > 0
  const exportLock = spineStepLock(v, 4)

  const origRig = useMemo(() => (orig && orig.format !== 'binary' ? parseOrigRig(orig.json) : origRigFromData(origPlayer?.skeleton?.data)), [orig, origPlayer])
  useEffect(() => {
    if (!rigOpen) applyRig(player, origRig, v.rig)
  }, [rigOpen, player, origRig, v.rig])

  useEffect(() => {
    if (rigOpen && !rigReady) setRigOpen(false)
  }, [rigOpen, rigReady])

  const focusBone = useMemo(() => {
    const slot = cur?.slots[0]
    return slot ? (v.skeleton?.slots.find((s) => s.name === slot)?.bone ?? null) : null
  }, [cur, v.skeleton])

  const toggleRig = (): void => {
    if (!rigReady) {
      toast(t('spineProject.rig.locked'), 'info')
      return
    }
    if (rigOpen) void flushRig()
    setRigOpen(!rigOpen)
  }

  const nextOne = useCallback(() => {
    if (!pick) return
    const idx = list.findIndex((r) => r.key === pick)
    const after = [...list.slice(idx + 1), ...list.slice(0, idx)].find((r) => r.versions.length > 0 && r.decision !== 'approved')
    if (after) setPick(after.key)
  }, [list, pick])
  const closeDetail = useCallback(() => setPick(null), [])

  const counts: Record<Filter, number> = {
    all: v.regions.length,
    todo: v.regions.filter((r) => matches(r, 'todo')).length,
    pending: v.regions.filter((r) => matches(r, 'pending')).length,
    rejected: v.regions.filter((r) => matches(r, 'rejected')).length,
    approved
  }

  return (
    <div className="sgr-wrap">
      <div className="toolbar">
        <Segmented<Filter>
          value={filter}
          ariaLabel={t('spineProject.gen.filter')}
          onChange={setFilter}
          options={(['all', 'todo', 'pending', 'rejected', 'approved'] as const).map((f) => ({ value: f, label: t(`spineProject.gen.f.${f}`, { count: counts[f] }) }))}
        />
        <button type="button" className="btn primary sm" disabled={!todo.length} title={t('spineProject.gen.allTitle')} onClick={() => void enqueue(todo.map((r) => r.key))}>
          <Icon name="sparkles" size={13} />
          {t('spineProject.gen.all', { count: todo.length })}
        </button>
        {qaOk.length > 0 && (
          <button type="button" className="btn sm" onClick={() => void review(Object.fromEntries(qaOk.map((r) => [r.key, { decision: 'approved' as const }])))}>
            <Icon name="check" size={13} />
            {t('spineProject.review.approveQa', { count: qaOk.length })}
          </button>
        )}
        <div className="grow" />
        {active.length > 0 && (
          <>
            <span className="chip c-blue">
              <span className="spin sm" />
              {t('spriteProject.gen.active', { count: active.length })}
            </span>
            <button type="button" className="btn sm" onClick={() => void (paused ? window.gas.queue.resume() : window.gas.queue.pause())}>
              <Icon name={paused ? 'play' : 'pause'} size={13} />
              {paused ? t('spriteProject.gen.resume') : t('spriteProject.gen.pause')}
            </button>
            <button type="button" className="btn ghost sm danger" onClick={() => void window.gas.queue.cancelAll(v.dir)}>
              <Icon name="x" size={13} />
              {t('spriteProject.gen.cancel')}
            </button>
          </>
        )}
        <span className="muted">{t('spineProject.gen.progress', { done: approved, total: used.length || v.regions.length })}</span>
        <button
          type="button"
          className="btn primary sm"
          aria-disabled={exportLock ? true : undefined}
          title={exportLock ? t(`spineProject.lock.${exportLock}`) : undefined}
          onClick={() => {
            if (exportLock) toast(t(`spineProject.lock.${exportLock}`), 'info')
            else void flushRig().then(() => setStep(4))
          }}
        >
          {t('spineProject.gen.toExport')}
          <Icon name="right" size={13} />
        </button>
      </div>
      <div className="sgr-body">
        <div className="sgr-list">
          {pages.length ? (
            pages.map((p) => (
              <section key={p} className="spg-sheet">
                <h4>
                  <Icon name="image" size={13} />
                  {p}
                </h4>
                {list
                  .filter((r) => r.page === p)
                  .map((r) => (
                    <Row key={r.key} v={v} r={r} job={jobOf.get(r.key) ?? null} on={r.key === pick} onPick={() => setPick(r.key)} />
                  ))}
              </section>
            ))
          ) : (
            <div className="proj-state muted">{t('spineProject.gen.empty')}</div>
          )}
        </div>
        <aside className={rigOpen ? 'sgr-side rig-on' : 'sgr-side'}>
          <div className="sgr-side-head">
            <b>{rigOpen ? t('spineProject.rig.title') : cur ? cur.name : t('spineProject.gen.preview')}</b>
            <div className="grow" />
            <button
              type="button"
              className={rigOpen ? 'btn sm on' : 'btn sm'}
              aria-pressed={rigOpen}
              aria-disabled={rigReady ? undefined : true}
              title={rigReady ? t('spineProject.rig.tip') : t('spineProject.rig.locked')}
              onClick={toggleRig}
            >
              <Icon name={rigOpen ? 'check' : 'link'} size={13} />
              {rigOpen ? t('spineProject.rig.done') : t('spineProject.rig.open')}
              {rigN > 0 && <span className="sgr-badge">{rigN}</span>}
            </button>
          </div>
          <SpineCompare viewer={viewer} orig={orig} next={next} highlightSlots={rigOpen ? rigSlots : cur?.slots} height={260} onNewPlayer={setPlayer} onOrigPlayer={setOrigPlayer} />
          {rigOpen && v.skeleton ? (
            <>
              <div className="tip">
                <Icon name="help" size={14} />
                <span>{t('spineProject.rig.tip')}</span>
              </div>
              <RigEditor
                skeleton={v.skeleton}
                origJson={orig?.format === 'binary' ? null : (orig?.json ?? null)}
                origPlayer={origPlayer}
                rig={v.rig}
                player={player}
                onChange={setRig}
                onSelectSlots={setRigSlots}
                focusBone={focusBone}
              />
            </>
          ) : cur ? (
            <Detail key={cur.key} r={cur} job={jobOf.get(cur.key) ?? null} onNext={nextOne} onClose={closeDetail} />
          ) : (
            <p className="muted sgr-hint">{rigReady ? t('spineProject.gen.pickHint') : t('spineProject.gen.pickHintNoGen')}</p>
          )}
        </aside>
      </div>
    </div>
  )
}
