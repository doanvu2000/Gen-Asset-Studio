import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { DIRECTIONS, type Direction, type SpriteProjectView, type StripQaCheck, type StripVersion, type StripView } from '@shared/sprite'
import { Icon } from '@renderer/components/Icon'
import { Segmented } from '@renderer/components/Segmented'
import { DirCompass } from '@renderer/components/sprite/DirCompass'
import { StripPreview, useClock } from '@renderer/components/sprite/StripPreview'
import { OrigPreview } from '@renderer/components/sprite/OrigPreview'
import { SpritePlayground } from '@renderer/components/sprite/SpritePlayground'
import { relTime } from '@renderer/lib/format'
import { useReviewKeys, type ReviewKeyMap } from '@renderer/lib/useReviewKeys'
import { jobOf, sourceOf, stripLabel, stripState } from '@renderer/lib/sprite'
import { useApp } from '@renderer/store/app'
import { useQueue } from '@renderer/store/queue'
import { useSprite } from '@renderer/store/sprite'

type Mode = 'side' | 'onion'
type TrySrc = 'orig' | 'new'

type HintId = Extract<StripQaCheck['id'], 'overflow' | 'static' | 'shadow'>

function isHinted(id: StripQaCheck['id']): id is HintId {
  return id === 'overflow' || id === 'static' || id === 'shadow'
}

function QaHint({ id, onFill }: { id: HintId; onFill?: (note: string) => void }): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="spr-qa-hint">
      <span>{t(`spriteProject.review.qaHint.${id}`)}</span>
      {onFill && (
        <button type="button" className="btn ghost sm" onClick={() => onFill(t(`spriteProject.review.qaNote.${id}`))}>
          {t('spriteProject.review.qaFill')}
        </button>
      )}
    </div>
  )
}

function fpsOf(v: SpriteProjectView, s: StripView): number {
  const anim = v.sheets.find((x) => x.id === s.sheetId)?.anims.find((a) => a.id === s.animId)
  return anim?.fps ?? 10
}

export function StripDetail({ v, s, chip, onNext, onStep }: { v: SpriteProjectView; s: StripView; chip: ReactNode; onNext: () => void; onStep: (dir: 1 | -1) => void }): ReactElement {
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
  const busy = state === 'running' || state === 'queued'
  const canRegen = !mirror && !busy && target.versions.length > 0

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

  const pickVersion = useCallback(
    (n: number) => {
      if (mirror || !versions.some((x) => x.version === n)) return
      void review({ [target.key]: { selected: n, decision: null } })
    },
    [mirror, versions, review, target.key]
  )

  const keys: ReviewKeyMap = {
    a: approve,
    x: reject,
    r: () => canRegen && setRegen(true),
    ' ': () => setPlaying((p) => !p),
    ',': () => setPos((pos - 1 + s.frameCount) % s.frameCount),
    '.': () => setPos((pos + 1) % s.frameCount),
    ArrowLeft: () => onStep(-1),
    ArrowRight: () => onStep(1)
  }
  for (let n = 1; n <= 9; n++) keys[String(n)] = () => pickVersion(n)
  useReviewKeys(keys)

  const jump = (frames: number[]): void => {
    if (!frames.length) return
    setPlaying(false)
    setPos(frames[0])
  }

  const fillNote = (text: string): void => {
    setNote((cur) => (cur.includes(text) ? cur : cur.trim() ? `${cur.trim()}; ${text}` : text))
    setRegen(true)
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
        {chip}
      </div>
      {state === 'error' && job?.error && (
        <div className="note err">
          <Icon name="alert" size={14} />
          <span>{job.error.message}</span>
        </div>
      )}
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
        {(src.url || s.origUrl) && (
          <button type="button" className="btn ghost sm" onClick={() => void window.gas.spriteGen.saveAnim(v.rel, s.key, 'gif')}>
            {t('spriteProject.review.saveGif')}
          </button>
        )}
      </div>
      {mode === 'side' ? (
        <div className="spr-d-stage">
          <figure className="ck">
            <OrigPreview strip={s} pos={pos} zoom={zoom} guides />
            <figcaption>{s.created ? t('spriteProject.create.character') : t('spriteProject.gen.orig')}</figcaption>
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
                {c.status !== 'pass' && isHinted(c.id) && <QaHint id={c.id} onFill={mirror ? undefined : fillNote} />}
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
      {regen && canRegen && (
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
      <div className="spr-d-acts">
        {busy ? (
          <span className="chip c-blue">
            <span className="spin sm" />
            {target.versions.length ? t('spriteProject.review.regenRunning') : t('spriteProject.work.genRunning')}
          </span>
        ) : canRegen ? (
          <button type="button" className="btn" onClick={() => setRegen((r) => !r)} title="R">
            <Icon name="refresh" size={14} />
            {t('spriteProject.gen.regen')}
          </button>
        ) : (
          !mirror && (
            <button type="button" className="btn primary" onClick={() => void enqueue([target.key])}>
              <Icon name="sparkles" size={14} />
              {target.key === v.lockKey ? t('spriteProject.gen.genLock') : t('spriteProject.gen.gen')}
            </button>
          )
        )}
        <div className="grow" />
        <button type="button" className={target.decision === 'rejected' ? 'btn danger solid' : 'btn'} disabled={!target.url} onClick={reject} title={`${t('spriteProject.review.reject')} (X)`}>
          <Icon name="x" size={14} />
          {t('spriteProject.review.reject')}
        </button>
        <button type="button" className={target.decision === 'approved' ? 'btn green solid' : 'btn primary'} disabled={!target.url} onClick={approve} title={`${t('spriteProject.review.approve')} (A)`}>
          <Icon name="check" size={14} />
          {t('spriteProject.review.approve')}
        </button>
      </div>
    </aside>
  )
}

function usePreviewSheet(rel: string, sheetId: string, sig: string, on: boolean): { url: string | null; loading: boolean; failed: boolean } {
  const [res, setRes] = useState<{ key: string; sheetId: string; url: string | null } | null>(null)
  const done = useRef('')
  const key = `${sheetId}|${sig}`
  useEffect(() => {
    if (!on || !sheetId || !sig || done.current === key) return
    let live = true
    setRes((r) => (r && !r.url ? null : r))
    void window.gas.spriteGen.previewSheet(rel, sheetId).then((url) => {
      if (!live) return
      done.current = url ? key : ''
      setRes({ key, sheetId, url })
    })
    return () => {
      live = false
    }
  }, [rel, sheetId, sig, key, on])
  return {
    url: res && res.sheetId === sheetId ? res.url : null,
    loading: on && !!sig && res?.key !== key,
    failed: res?.key === key && !res.url
  }
}

export function StripOverview({ v, pos }: { v: SpriteProjectView; pos: number }): ReactElement {
  const { t } = useTranslation()
  const sheets = useMemo(() => v.sheets.filter((sh) => v.strips.some((s) => s.sheetId === sh.id && s.dir)), [v.sheets, v.strips])
  const [sheetSel, setSheetSel] = useState(sheets[0]?.id ?? '')
  const sheet = sheets.find((sh) => sh.id === sheetSel) ?? sheets[0] ?? null
  const strips = useMemo(() => (sheet ? v.strips.filter((s) => s.sheetId === sheet.id) : []), [v.strips, sheet])
  const names = useMemo(() => [...new Set(strips.filter((s) => s.dir).map((s) => s.anim))], [strips])
  const [animSel, setAnim] = useState(names[0] ?? '')
  const anim = names.includes(animSel) ? animSel : (names[0] ?? '')
  const [dir, setDir] = useState<Direction | null>(null)
  const [trySrc, setTrySrc] = useState<TrySrc>('new')
  const sig = strips
    .filter((s) => !s.mirrorOf && s.versions.length)
    .map((s) => `${s.key}:${s.versions.length}:${s.selected}:${s.decision ?? ''}`)
    .join('|')
  const preview = usePreviewSheet(v.rel, sheet?.id ?? '', sig, trySrc === 'new')

  useEffect(() => {
    if (preview.failed) setTrySrc('orig')
  }, [preview.failed])

  const set = strips.filter((s) => s.anim === anim && s.dir)
  const byDir = new Map(set.map((s) => [s.dir as Direction, s]))
  const dirSet = v.settings.dirSet || 8
  const order = [...new Set([...DIRECTIONS[dirSet === 4 || dirSet === 6 ? dirSet : 8], ...DIRECTIONS[8]])].filter((d) => byDir.has(d))
  const cur = (dir && byDir.get(dir)) || set[0]
  if (!sheet || !names.length) return <div className="proj-state muted">{t('spriteProject.review.noDirs')}</div>
  const playUrl = trySrc === 'new' && sig && preview.url ? preview.url : sheet.url
  return (
    <div className="spr-ov">
      <div className="spr-ov-l">
        <div className="sps-row">
          {sheets.length > 1 && (
            <>
              <span className="muted">{t('spriteProject.review.sheet')}</span>
              <select className="inp sm" value={sheet.id} onChange={(e) => setSheetSel(e.target.value)}>
                {sheets.map((sh) => (
                  <option key={sh.id} value={sh.id}>
                    {sh.name}
                  </option>
                ))}
              </select>
            </>
          )}
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
            const s = byDir.get(d) as StripView
            const src = sourceOf(v, s)
            return (
              <button key={d} type="button" className={cur && cur.key === s.key ? 'spr-ov-c on' : 'spr-ov-c'} onClick={() => setDir(d)}>
                <span className="ck">
                  {src.url ? (
                    <StripPreview url={src.url} sizes={src.frameSizes} pos={pos % Math.max(1, src.frameCount)} size={110} flipX={!!s.mirrorOf} />
                  ) : (
                    <OrigPreview strip={s} pos={pos % Math.max(1, s.frameCount)} size={110} className="dim" />
                  )}
                </span>
                <small>
                  {d}
                  {!src.url ? ` · ${t('spriteProject.review.origOnly')}` : ''}
                </small>
              </button>
            )
          })}
        </div>
        <section className="spr-ov-try">
          <div className="sps-row">
            <b>{t('spriteProject.review.try')}</b>
            {sig ? (
              <Segmented<TrySrc>
                value={trySrc}
                ariaLabel={t('spriteProject.review.try')}
                onChange={setTrySrc}
                options={[
                  { value: 'orig', label: t('spriteProject.gen.orig') },
                  { value: 'new', label: t('spriteProject.gen.new') }
                ]}
              />
            ) : (
              <span className="muted">{t('spriteProject.review.tryNoNew')}</span>
            )}
            {trySrc === 'new' && preview.loading && <span className="spin sm" />}
          </div>
          {preview.failed && (
            <div className="note warn">
              <Icon name="alert" size={14} />
              <span>{t('spriteProject.review.tryFail')}</span>
            </div>
          )}
          <SpritePlayground url={playUrl} frames={sheet.frames} anims={sheet.anims} dirSet={v.settings.dirSet} view={v.settings.view} height={280} />
        </section>
      </div>
      <div className="spr-ov-r">
        <div className="spr-ov-big ck">
          {cur ? (
            (() => {
              const src = sourceOf(v, cur)
              return src.url ? (
                <StripPreview url={src.url} sizes={src.frameSizes} pos={pos % Math.max(1, src.frameCount)} size={260} flipX={!!cur.mirrorOf} guides />
              ) : (
                <OrigPreview strip={cur} pos={pos % Math.max(1, cur.frameCount)} size={260} guides />
              )
            })()
          ) : null}
        </div>
        <DirCompass dirSet={v.settings.dirSet} available={order} value={(cur?.dir as Direction | undefined) ?? null} onChange={setDir} size={140} />
        <small className="muted">{t('spriteProject.review.compassHint')}</small>
      </div>
    </div>
  )
}
