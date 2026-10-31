import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { SpineProjectView, SpineRegionView } from '@shared/spine'
import { Icon } from '@renderer/components/Icon'
import { Segmented } from '@renderer/components/Segmented'
import { SpineCompare } from '@renderer/components/spine/SpineCompare'
import { useViewer } from '@renderer/components/spine/SpinePreview'
import { regionJob, regionQaFail, regionState } from '@renderer/lib/spine'
import { useQueue } from '@renderer/store/queue'
import { useSpine } from '@renderer/store/spine'

type Filter = 'all' | 'pending' | 'approved' | 'rejected' | 'qa'

function matches(r: SpineRegionView, f: Filter): boolean {
  if (!r.versions.length) return false
  if (f === 'all') return true
  if (f === 'pending') return !r.decision
  if (f === 'approved') return r.decision === 'approved'
  if (f === 'rejected') return r.decision === 'rejected'
  return regionQaFail(r)
}

function Card({ r, on, onOpen }: { r: SpineRegionView; on: boolean; onOpen: () => void }): ReactElement {
  const { t } = useTranslation()
  return (
    <button type="button" className={on ? 'spr-card on' : 'spr-card'} onClick={onOpen}>
      <div className="spr-pair">
        <span className="spr-cell ck">{r.sourceUrl && <img src={r.sourceUrl} alt="" draggable={false} />}</span>
        <span className="spr-cell ck">{r.url ? <img src={r.url} alt="" draggable={false} /> : <Icon name="sparkles" size={16} />}</span>
      </div>
      <div className="spr-meta">
        <b title={r.name}>{r.name}</b>
        <small>
          {r.w}×{r.h} · v{r.selected}
        </small>
      </div>
      <div className="spr-chips">
        {!r.decision && <span className="chip c-blue">{t('spriteProject.review.pending')}</span>}
        {r.decision && <span className={r.decision === 'approved' ? 'chip c-green' : 'chip c-orange'}>{t(`spriteProject.review.decision.${r.decision}`)}</span>}
        {regionQaFail(r) && (
          <span className="chip c-orange">
            <Icon name="alert" size={10} />
            QA
          </span>
        )}
      </div>
    </button>
  )
}

function Detail({ v, r, onNext, onClose }: { v: SpineProjectView; r: SpineRegionView; onNext: () => void; onClose: () => void }): ReactElement {
  const { t } = useTranslation()
  const review = useSpine((s) => s.review)
  const enqueue = useSpine((s) => s.enqueue)
  const snap = useQueue((s) => s.snap)
  const [zoom, setZoom] = useState(2)
  const [note, setNote] = useState('')
  const [regen, setRegen] = useState(false)
  const state = regionState(r, regionJob(v, r, snap?.jobs ?? []))

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

  const w = Math.min(220, r.w * zoom)
  return (
    <aside className="spr-detail">
      <div className="spr-d-head">
        <div>
          <b>{r.name}</b>
          <small className="muted">
            {r.page} · {r.w}×{r.h} · {r.slots.join(', ')}
          </small>
        </div>
        <div className="grow" />
        <select className="inp sm" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
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
      <div className="grow" />
      <div className="spr-d-acts">
        {state === 'running' || state === 'queued' ? (
          <span className="chip c-blue">
            <span className="spin sm" />
            {t('spriteProject.review.regenRunning')}
          </span>
        ) : (
          <button type="button" className="btn" onClick={() => setRegen((x) => !x)} title="R">
            <Icon name="refresh" size={14} />
            {t('spriteProject.gen.regen')}
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
    </aside>
  )
}

export function SpineReviewStep({ v }: { v: SpineProjectView }): ReactElement {
  const { t } = useTranslation()
  const review = useSpine((s) => s.review)
  const setStep = useSpine((s) => s.setStep)
  const next = useSpine((s) => s.next)
  const viewer = useViewer()
  const [filter, setFilter] = useState<Filter>('all')
  const [open, setOpen] = useState<string | null>(null)
  const list = useMemo(() => v.regions.filter((r) => matches(r, filter)), [v.regions, filter])
  const cur = v.regions.find((r) => r.key === open) ?? null
  const generated = v.regions.filter((r) => r.versions.length > 0)
  const approved = generated.filter((r) => r.decision === 'approved').length
  const qaOk = generated.filter((r) => !r.decision && !regionQaFail(r))

  const nextOne = (): void => {
    if (!cur) return
    const idx = list.findIndex((r) => r.key === cur.key)
    const after = [...list.slice(idx + 1), ...list.slice(0, idx)].find((r) => r.decision !== 'approved')
    if (after) setOpen(after.key)
  }

  return (
    <div className="spr-wrap">
      <div className="toolbar">
        <Segmented<Filter>
          value={filter}
          ariaLabel={t('spriteProject.review.filter')}
          onChange={setFilter}
          options={(['all', 'pending', 'approved', 'rejected', 'qa'] as const).map((f) => ({ value: f, label: t(`spriteProject.review.f.${f}`) }))}
        />
        <div className="grow" />
        <span className="muted">{t('spriteProject.review.count', { approved, total: generated.length })}</span>
        {qaOk.length > 0 && (
          <button type="button" className="btn sm" onClick={() => void review(Object.fromEntries(qaOk.map((r) => [r.key, { decision: 'approved' as const }])))}>
            <Icon name="check" size={13} />
            {t('spineProject.review.approveQa', { count: qaOk.length })}
          </button>
        )}
        <button type="button" className="btn primary sm" disabled={!approved} onClick={() => setStep(7)}>
          {t('spriteProject.review.toExport')}
          <Icon name="right" size={13} />
        </button>
      </div>
      <div className="srv-body">
        <div className="srv-left">
          <SpineCompare viewer={viewer} orig={null} next={next} single="new" height={300} highlightSlots={cur?.slots} />
          <div className="spr-grid">
            {list.length ? list.map((r) => <Card key={r.key} r={r} on={r.key === open} onOpen={() => setOpen(r.key)} />) : <div className="proj-state muted">{t('spriteProject.review.empty')}</div>}
          </div>
        </div>
        {cur && <Detail key={cur.key} v={v} r={cur} onNext={nextOne} onClose={() => setOpen(null)} />}
      </div>
    </div>
  )
}
