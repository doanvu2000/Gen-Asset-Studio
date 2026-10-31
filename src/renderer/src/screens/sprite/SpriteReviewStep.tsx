import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { DIRECTIONS, type Direction, type SpriteProjectView, type StripVersion, type StripView } from '@shared/sprite'
import { Icon } from '@renderer/components/Icon'
import { Segmented } from '@renderer/components/Segmented'
import { DirCompass } from '@renderer/components/sprite/DirCompass'
import { StripPreview, useClock } from '@renderer/components/sprite/StripPreview'
import { relTime } from '@renderer/lib/format'
import { jobOf, qaFail, sourceOf, stripLabel, stripState } from '@renderer/lib/sprite'
import { useApp } from '@renderer/store/app'
import { useQueue } from '@renderer/store/queue'
import { useSprite } from '@renderer/store/sprite'

type Filter = 'all' | 'pending' | 'approved' | 'rejected' | 'qa'
type Mode = 'side' | 'onion'

function fpsOf(v: SpriteProjectView, s: StripView): number {
  const anim = v.sheets.find((x) => x.id === s.sheetId)?.anims.find((a) => a.id === s.animId)
  return anim?.fps ?? 10
}

function matches(v: SpriteProjectView, s: StripView, f: Filter): boolean {
  if (f === 'all') return true
  if (s.mirrorOf) return f === 'approved' ? sourceOf(v, s).decision === 'approved' : false
  if (f === 'pending') return !!s.url && !s.decision
  if (f === 'approved') return s.decision === 'approved'
  if (f === 'rejected') return s.decision === 'rejected'
  return qaFail(s)
}

function Card({ v, s, pos, on, onOpen }: { v: SpriteProjectView; s: StripView; pos: number; on: boolean; onOpen: () => void }): ReactElement {
  const { t } = useTranslation()
  const src = sourceOf(v, s)
  const p = pos % Math.max(1, s.frameCount)
  const decision = s.mirrorOf ? src.decision : s.decision
  return (
    <button type="button" className={on ? 'spr-card on' : 'spr-card'} onClick={onOpen}>
      <div className="spr-pair">
        <span className="spr-cell ck">
          <StripPreview url={s.origUrl} sizes={s.frameSizes} pos={p} size={72} />
        </span>
        <span className="spr-cell ck">
          {src.url ? <StripPreview url={src.url} sizes={src.frameSizes} pos={p % Math.max(1, src.frameCount)} size={72} flipX={!!s.mirrorOf} /> : <Icon name="sparkles" size={16} />}
        </span>
      </div>
      <div className="spr-meta">
        <b>{stripLabel(s)}</b>
        <small>{s.sheetName}</small>
      </div>
      <div className="spr-chips">
        {s.mirrorOf && (
          <span className="chip c-purple">
            <Icon name="refresh" size={10} />
            {t('spriteProject.review.mirror')}
          </span>
        )}
        {!s.mirrorOf && !s.url && <span className="chip c-gray">{t('spriteProject.gen.state.none')}</span>}
        {!s.mirrorOf && s.url && !decision && <span className="chip c-blue">{t('spriteProject.review.pending')}</span>}
        {decision && <span className={decision === 'approved' ? 'chip c-green' : 'chip c-orange'}>{t(`spriteProject.review.decision.${decision}`)}</span>}
        {!s.mirrorOf && qaFail(s) && (
          <span className="chip c-orange">
            <Icon name="alert" size={10} />
            QA
          </span>
        )}
      </div>
    </button>
  )
}

function Detail({ v, s, onNext, onClose }: { v: SpriteProjectView; s: StripView; onNext: () => void; onClose: () => void }): ReactElement {
  const { t } = useTranslation()
  const lang = useApp((st) => st.settings.lang)
  const review = useSprite((st) => st.review)
  const enqueue = useSprite((st) => st.enqueue)
  const snap = useQueue((st) => st.snap)
  const src = sourceOf(v, s)
  const mirror = !!s.mirrorOf
  const target = mirror ? src : s
  const [playing, setPlaying] = useState(true)
  const [mode, setMode] = useState<Mode>('side')
  const [zoom, setZoom] = useState(2)
  const [pos, setPos] = useClock(s.frameCount, fpsOf(v, s), playing)
  const [versions, setVersions] = useState<StripVersion[]>([])
  const [note, setNote] = useState('')
  const [regen, setRegen] = useState(false)
  const job = jobOf(v, target, snap?.jobs ?? [])
  const state = stripState(target, job)

  useEffect(() => {
    let live = true
    setVersions([])
    if (target.versions.length) void window.gas.spriteGen.versions(v.rel, target.key).then((list) => live && setVersions(list))
    return () => {
      live = false
    }
  }, [v.rel, target.key, target.versions.length])

  const approve = useCallback(() => {
    if (!target.url) return
    void review({ [target.key]: { decision: 'approved' } })
    onNext()
  }, [review, target.key, target.url, onNext])
  const reject = useCallback(() => {
    if (!target.url) return
    void review({ [target.key]: { decision: 'rejected' } })
  }, [review, target.key, target.url])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === 'a' || e.key === 'A') approve()
      else if (e.key === 'x' || e.key === 'X') reject()
      else if (e.key === 'r' || e.key === 'R') setRegen(true)
      else if (e.key === ' ') {
        e.preventDefault()
        setPlaying((p) => !p)
      } else if (e.key === ',' ) setPos((pos - 1 + s.frameCount) % s.frameCount)
      else if (e.key === '.') setPos((pos + 1) % s.frameCount)
      else if (e.key === 'Escape') onClose()
      else return
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [approve, reject, onClose, pos, s.frameCount, setPos])

  const jump = (frames: number[]): void => {
    if (!frames.length) return
    setPlaying(false)
    setPos(frames[0])
  }

  const newPv = src.url ? (
    <StripPreview url={src.url} sizes={src.frameSizes} pos={pos % Math.max(1, src.frameCount)} zoom={zoom} flipX={mirror} guides />
  ) : (
    <span className="muted">{t('spriteProject.gen.state.none')}</span>
  )

  return (
    <aside className="spr-detail">
      <div className="spr-d-head">
        <div>
          <b>{stripLabel(s)}</b>
          <small className="muted">
            {s.sheetName} · {t('spriteProject.sheets.frames', { count: s.frameCount })}
          </small>
        </div>
        <div className="grow" />
        <button type="button" className="icon-btn" aria-label={t('dialogs.cancel')} onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>
      {mirror && (
        <div className="note">
          <Icon name="refresh" size={14} />
          <span>{t('spriteProject.review.mirrorNote', { name: stripLabel(src) })}</span>
        </div>
      )}
      <div className="spr-d-ctl">
        <Segmented<Mode>
          value={mode}
          ariaLabel={t('spriteProject.review.mode')}
          onChange={setMode}
          options={[
            { value: 'side', label: t('spriteProject.review.side') },
            { value: 'onion', label: t('spriteProject.review.onion') }
          ]}
        />
        <div className="grow" />
        <button type="button" className="icon-btn" onClick={() => setPos((pos - 1 + s.frameCount) % s.frameCount)} aria-label="prev">
          <Icon name="left" size={14} />
        </button>
        <button type="button" className="btn sm" onClick={() => setPlaying((p) => !p)}>
          <Icon name={playing ? 'pause' : 'play'} size={13} />
          {pos + 1}/{s.frameCount}
        </button>
        <button type="button" className="icon-btn" onClick={() => setPos((pos + 1) % s.frameCount)} aria-label="next">
          <Icon name="right" size={14} />
        </button>
        <select className="inp sm" value={zoom} onChange={(e) => setZoom(Number(e.target.value))}>
          {[1, 2, 3, 4].map((z) => (
            <option key={z} value={z}>
              {z}×
            </option>
          ))}
        </select>
      </div>
      {mode === 'side' ? (
        <div className="spr-d-stage">
          <figure className="ck">
            <StripPreview url={s.origUrl} sizes={s.frameSizes} pos={pos} zoom={zoom} guides />
            <figcaption>{t('spriteProject.gen.orig')}</figcaption>
          </figure>
          <figure className="ck">
            {newPv}
            <figcaption>{t('spriteProject.gen.new')}</figcaption>
          </figure>
        </div>
      ) : (
        <div className="spr-d-stage one">
          <figure className="ck">
            {src.url ? (
              <StripPreview url={src.url} sizes={src.frameSizes} pos={pos % Math.max(1, src.frameCount)} zoom={zoom} flipX={mirror} ghost={{ url: s.origUrl }} guides />
            ) : (
              newPv
            )}
            <figcaption>{t('spriteProject.review.onionCap')}</figcaption>
          </figure>
        </div>
      )}
      {target.qa && (
        <section className="spr-d-sec">
          <h4>QA</h4>
          <ul className="spr-qa">
            {target.qa.checks.map((c) => (
              <li key={c.id} className={c.status}>
                <button type="button" disabled={!c.frames.length} onClick={() => jump(c.frames)}>
                  <Icon name={c.status === 'pass' ? 'check' : 'alert'} size={12} />
                  <span>{t(`spriteProject.review.qa.${c.id}`)}</span>
                  <small>{c.message}</small>
                  {c.frames.length > 0 && <em>{c.frames.map((f) => f + 1).join(', ')}</em>}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      {!mirror && versions.length > 0 && (
        <section className="spr-d-sec">
          <h4>{t('spriteProject.review.versions')}</h4>
          <div className="spr-vers">
            {[...versions].reverse().map((ver) => (
              <button
                key={ver.version}
                type="button"
                className={ver.version === target.selected ? 'spr-ver on' : 'spr-ver'}
                onClick={() => void review({ [target.key]: { selected: ver.version, decision: null } })}
              >
                <b>v{ver.version}</b>
                <small>{relTime(ver.createdAt, lang)}</small>
                {ver.qa && !ver.qa.checks.every((c) => c.status === 'pass') && <Icon name="alert" size={11} />}
                {ver.note && <i title={ver.note}>“{ver.note}”</i>}
              </button>
            ))}
          </div>
        </section>
      )}
      {regen && !mirror && (
        <section className="spr-d-sec">
          <label className="fld">
            <span>{t('spriteProject.review.regenNote')}</span>
            <textarea className="inp" rows={3} autoFocus value={note} placeholder={t('spriteProject.review.regenPh')} onChange={(e) => setNote(e.target.value)} />
          </label>
          <div className="sps-row">
            <button type="button" className="btn ghost sm" onClick={() => setRegen(false)}>
              {t('dialogs.cancel')}
            </button>
            <button
              type="button"
              className="btn primary sm"
              onClick={async () => {
                const n = await enqueue([target.key], note.trim() || undefined)
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
          !mirror && (
            <button type="button" className="btn" onClick={() => setRegen((r) => !r)} title="R">
              <Icon name="refresh" size={14} />
              {t('spriteProject.gen.regen')}
            </button>
          )
        )}
        <div className="grow" />
        <button type="button" className={target.decision === 'rejected' ? 'btn danger solid' : 'btn'} disabled={!target.url} onClick={reject} title="X">
          <Icon name="x" size={14} />
          {t('spriteProject.review.reject')}
        </button>
        <button type="button" className={target.decision === 'approved' ? 'btn green solid' : 'btn primary'} disabled={!target.url} onClick={approve} title="A">
          <Icon name="check" size={14} />
          {t('spriteProject.review.approve')}
        </button>
      </div>
    </aside>
  )
}

function Overview({ v, pos }: { v: SpriteProjectView; pos: number }): ReactElement {
  const { t } = useTranslation()
  const names = useMemo(() => [...new Set(v.strips.filter((s) => s.dir).map((s) => s.anim))], [v.strips])
  const [anim, setAnim] = useState(names[0] ?? '')
  const [dir, setDir] = useState<Direction | null>(null)
  const set = v.strips.filter((s) => s.anim === anim && s.dir)
  const dirSet = v.settings.dirSet || 8
  const order = DIRECTIONS[dirSet === 4 || dirSet === 6 ? dirSet : 8]
  const byDir = new Map(set.map((s) => [s.dir as Direction, s]))
  const cur = dir ? byDir.get(dir) : set[0]
  const available = set.map((s) => s.dir as Direction)
  if (!names.length) return <div className="proj-state muted">{t('spriteProject.review.noDirs')}</div>
  return (
    <div className="spr-ov">
      <div className="spr-ov-l">
        <div className="sps-row">
          <span className="muted">{t('spriteProject.review.anim')}</span>
          <select className="inp sm" value={anim} onChange={(e) => setAnim(e.target.value)}>
            {names.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
          <span className="muted">{t('spriteProject.review.ovHint')}</span>
        </div>
        <div className="spr-ov-grid">
          {order.map((d) => {
            const s = byDir.get(d)
            const src = s ? sourceOf(v, s) : null
            return (
              <button key={d} type="button" className={cur && s && cur.key === s.key ? 'spr-ov-c on' : 'spr-ov-c'} disabled={!s} onClick={() => setDir(d)}>
                <span className="ck">
                  {s && src?.url ? (
                    <StripPreview url={src.url} sizes={src.frameSizes} pos={pos % Math.max(1, src.frameCount)} size={110} flipX={!!s.mirrorOf} />
                  ) : s ? (
                    <StripPreview url={s.origUrl} sizes={s.frameSizes} pos={pos % Math.max(1, s.frameCount)} size={110} className="dim" />
                  ) : null}
                </span>
                <small>
                  {d}
                  {s && !src?.url ? ` · ${t('spriteProject.review.origOnly')}` : ''}
                </small>
              </button>
            )
          })}
        </div>
      </div>
      <div className="spr-ov-r">
        <div className="spr-ov-big ck">
          {cur ? (
            (() => {
              const src = sourceOf(v, cur)
              return src.url ? (
                <StripPreview url={src.url} sizes={src.frameSizes} pos={pos % Math.max(1, src.frameCount)} size={260} flipX={!!cur.mirrorOf} guides />
              ) : (
                <StripPreview url={cur.origUrl} sizes={cur.frameSizes} pos={pos % Math.max(1, cur.frameCount)} size={260} guides />
              )
            })()
          ) : null}
        </div>
        <DirCompass dirSet={v.settings.dirSet} available={available} value={(cur?.dir as Direction | undefined) ?? null} onChange={setDir} size={140} />
        <small className="muted">{t('spriteProject.review.compassHint')}</small>
      </div>
    </div>
  )
}

export function SpriteReviewStep({ v }: { v: SpriteProjectView }): ReactElement {
  const { t } = useTranslation()
  const review = useSprite((s) => s.review)
  const setStep = useSprite((s) => s.setStep)
  const [filter, setFilter] = useState<Filter>('all')
  const [tab, setTab] = useState<'strips' | 'overview'>('strips')
  const [open, setOpen] = useState<string | null>(null)
  const [pos] = useClock(1000, 8, true)
  const list = v.strips.filter((s) => matches(v, s, filter))
  const cur = v.strips.find((s) => s.key === open) ?? null
  const approved = v.strips.filter((s) => !s.mirrorOf && s.decision === 'approved').length
  const generated = v.strips.filter((s) => !s.mirrorOf && s.url).length
  const qaOk = v.strips.filter((s) => !s.mirrorOf && s.url && !s.decision && !qaFail(s))

  const next = (): void => {
    if (!cur) return
    const idx = list.findIndex((s) => s.key === cur.key)
    const after = [...list.slice(idx + 1), ...list.slice(0, idx)].find((s) => !s.mirrorOf && s.url && s.decision !== 'approved')
    if (after) setOpen(after.key)
  }

  return (
    <div className="spr-wrap">
      <div className="toolbar">
        <Segmented<'strips' | 'overview'>
          value={tab}
          ariaLabel={t('spriteProject.review.tab')}
          onChange={setTab}
          options={[
            { value: 'strips', label: t('spriteProject.review.tabStrips') },
            { value: 'overview', label: t('spriteProject.review.tabOverview') }
          ]}
        />
        {tab === 'strips' && (
          <Segmented<Filter>
            value={filter}
            ariaLabel={t('spriteProject.review.filter')}
            onChange={setFilter}
            options={(['all', 'pending', 'approved', 'rejected', 'qa'] as const).map((f) => ({ value: f, label: t(`spriteProject.review.f.${f}`) }))}
          />
        )}
        <div className="grow" />
        <span className="muted">{t('spriteProject.review.count', { approved, total: generated })}</span>
        {qaOk.length > 0 && (
          <button type="button" className="btn sm" onClick={() => void review(Object.fromEntries(qaOk.map((s) => [s.key, { decision: 'approved' as const }])))}>
            <Icon name="check" size={13} />
            {t('spriteProject.review.approveQa', { count: qaOk.length })}
          </button>
        )}
        <button type="button" className="btn primary sm" disabled={!approved} onClick={() => setStep(6)}>
          {t('spriteProject.review.toExport')}
          <Icon name="right" size={13} />
        </button>
      </div>
      {tab === 'overview' ? (
        <Overview v={v} pos={pos} />
      ) : (
        <div className="spr-body">
          <div className="spr-grid">
            {list.length ? (
              list.map((s) => <Card key={s.key} v={v} s={s} pos={pos} on={s.key === open} onOpen={() => setOpen(s.key)} />)
            ) : (
              <div className="proj-state muted">{t('spriteProject.review.empty')}</div>
            )}
          </div>
          {cur && <Detail key={cur.key} v={v} s={cur} onNext={next} onClose={() => setOpen(null)} />}
        </div>
      )}
    </div>
  )
}
