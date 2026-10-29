import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import type { EdgeSide, JobSpec, QaCheckSummary } from '@shared/queue'
import type { VersionInfo } from '@shared/review'
import type { PromptPolishResult } from '@shared/style'
import type { ProjectView } from '@shared/workspace'
import { Icon } from '@renderer/components/Icon'
import { ModelChip } from '@renderer/components/ModelChip'
import { Segmented } from '@renderer/components/Segmented'
import { EASE, fadeTransition, sheetTransition } from '@renderer/lib/motion'
import { errMsg, projAbs } from '@renderer/lib/files'
import { isLocked } from '@renderer/lib/project'
import { resetReview, selectVersion, setDecision, type RvItem } from '@renderer/lib/review'
import { useApp } from '@renderer/store/app'
import { useEnv } from '@renderer/store/env'
import { useRv, type CompareMode, type ZoomMode } from '@renderer/store/review'
import { useWs } from '@renderer/store/workspace'
import { toast } from '@renderer/store/toast'
import { PolishPanel } from './StyleStep'
import { RvChip } from './ReviewStep'

const SIDES: EdgeSide[] = ['left', 'right', 'top', 'bottom']
const MODES: CompareMode[] = ['side', 'slider', 'toggle']

type PolishState = { phase: 'loading' } | { phase: 'done'; result: PromptPolishResult; v: number } | { phase: 'error'; msg: string }

function useSize(ref: React.RefObject<HTMLElement | null>): { w: number; h: number } {
  const [size, setSize] = useState({ w: 0, h: 0 })
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    setSize({ w: el.clientWidth, h: el.clientHeight })
    return () => ro.disconnect()
  }, [ref])
  return size
}

function Canvas({ w, h, s, dark, children }: { w: number; h: number; s: number; dark: boolean; children: ReactNode }): ReactElement {
  const zoom = useRv((st) => st.zoom)
  return (
    <div className={`rv-cv ck${dark ? ' dk' : ''}${zoom !== 'fit' && s >= 2 ? ' px' : ''}`} style={{ width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) }}>
      {children}
    </div>
  )
}

function Layer({ url, clip }: { url: string | null; clip?: number }): ReactElement | null {
  if (!url) return null
  return <img className="rv-lay" src={url} alt="" draggable={false} style={clip !== undefined ? { clipPath: `inset(0 0 0 ${clip}%)` } : undefined} />
}

function Viewer({ item, newUrl, newLabel, hold, setHold }: { item: RvItem; newUrl: string | null; newLabel: string; hold: boolean; setHold: (v: boolean) => void }): ReactElement {
  const { t } = useTranslation()
  const { mode, zoom, dark, slider, setSlider } = useRv()
  const ref = useRef<HTMLDivElement>(null)
  const size = useSize(ref)
  const { w, h, url } = item.input
  const busy = item.status === 'regen'
  const aw = Math.max(80, size.w - 64)
  const ah = Math.max(80, size.h - 104)
  const fixed = zoom === 'one' ? 1 : zoom === 'two' ? 2 : 0
  const single = hold || mode !== 'side'
  const s = fixed || (single ? Math.min(aw / w, ah / h, 6) : Math.min((aw - 28) / 2 / w, ah / h, 5))
  const over = (single ? w * s : w * s * 2 + 28) > size.w - 32 || h * s > size.h - 80
  const spinner = busy ? (
    <div className="rv-cv-busy">
      <span className="spin" />
    </div>
  ) : null

  let body: ReactNode
  if (hold || mode === 'toggle') {
    const showOrig = hold || !newUrl
    body = (
      <figure className="rv-fig">
        <Canvas w={w} h={h} s={s} dark={dark}>
          <AnimatePresence initial={false}>
            <motion.img key={showOrig ? 'o' : 'n'} className="rv-lay" src={(showOrig ? url : newUrl) ?? ''} alt="" draggable={false} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.12 }} />
          </AnimatePresence>
          {!showOrig && spinner}
        </Canvas>
        <figcaption>
          <button
            type="button"
            className={hold ? 'btn sm on' : 'btn sm'}
            disabled={!newUrl}
            onPointerDown={() => setHold(true)}
            onPointerUp={() => setHold(false)}
            onPointerLeave={() => setHold(false)}
          >
            <Icon name="eye" size={13} />
            {t('review.detail.hold')}
          </button>
        </figcaption>
      </figure>
    )
  } else if (mode === 'slider') {
    body = (
      <figure className="rv-fig">
        <Canvas w={w} h={h} s={s} dark={dark}>
          <Layer url={url} />
          <Layer url={newUrl} clip={slider} />
          {spinner}
          <div className="rv-sl-line" style={{ left: `${slider}%` }}>
            <span>
              <Icon name="left" size={12} />
              <Icon name="right" size={12} />
            </span>
          </div>
          <input className="rv-sl-in" type="range" min={0} max={100} value={slider} aria-label={t('review.detail.drag')} onChange={(e) => setSlider(Number(e.target.value))} />
        </Canvas>
        <figcaption>
          <span>← {t('review.detail.original')}</span>
          <span className="rv-dim">|</span>
          <span>{newLabel} →</span>
        </figcaption>
      </figure>
    )
  } else {
    body = (
      <div className="rv-row">
        <figure className="rv-fig">
          <Canvas w={w} h={h} s={s} dark={dark}>
            <Layer url={url} />
          </Canvas>
          <figcaption>{t('review.detail.original')}</figcaption>
        </figure>
        <figure className="rv-fig">
          <Canvas w={w} h={h} s={s} dark={dark}>
            <AnimatePresence initial={false}>{newUrl && <motion.img key={newUrl} className="rv-lay" src={newUrl} alt="" draggable={false} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE }} />}</AnimatePresence>
            {spinner}
          </Canvas>
          <figcaption>{newLabel}</figcaption>
        </figure>
      </div>
    )
  }

  return (
    <div className={over ? 'rv-viewer scroll' : 'rv-viewer'} ref={ref}>
      {(hold || mode === 'toggle') && newUrl && (
        <span className="rv-pill">
          {t('review.detail.showing', { what: hold ? t('review.detail.original') : t('review.detail.new') })} · <kbd>Space</kbd>
        </span>
      )}
      <div className="rv-stage">{body}</div>
      <div className="rv-legend">
        <i />
        {t('review.detail.legend', { w, h })}
      </div>
    </div>
  )
}

function qaValue(c: QaCheckSummary, t: (k: string, o?: Record<string, unknown>) => string): string {
  if (c.id === 'size') return `${Math.floor(c.value / 10000)}×${c.value % 10000}`
  if (c.id === 'alpha') return c.value ? 'RGBA' : t('review.qa.noAlpha')
  if (c.id === 'edges') return `${c.value}`
  if (c.id === 'fill' || c.id === 'coverage') return `${Math.round(c.value * 100)}%`
  if (c.id === 'chroma') return `${c.value} px`
  return String(c.value)
}

function QaList({ checks }: { checks: QaCheckSummary[] }): ReactElement {
  const { t } = useTranslation()
  const tt = t as unknown as (k: string, o?: Record<string, unknown>) => string
  return (
    <div className="rv-qa">
      {checks.map((c) => (
        <div className="rv-qa-row" key={c.id} title={c.message}>
          <span className={`rv-qa-ic ${c.status}`}>
            <Icon name={c.status === 'pass' ? 'check' : 'alert'} size={13} />
          </span>
          <span className="rv-qa-t">{tt(`review.qa.${c.id}`, { t: c.threshold })}</span>
          <span className="rv-qa-v">{qaValue(c, tt)}</span>
        </div>
      ))}
    </div>
  )
}

function timeOf(iso: string | null, lang: string, short = false): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const loc = lang === 'en' ? 'en-GB' : 'vi-VN'
  const hm = d.toLocaleTimeString(loc, { hour: '2-digit', minute: '2-digit' })
  return short ? hm : `${hm} · ${d.toLocaleDateString(loc, { day: '2-digit', month: '2-digit', year: 'numeric' })}`
}

function Sheet({ project, item, idx, total, onNav }: { project: ProjectView; item: RvItem; idx: number; total: number; onNav: (d: number) => void }): ReactElement {
  const { t } = useTranslation()
  const lang = useApp((s) => s.settings.lang)
  const rel = useWs((s) => s.curProject)
  const reload = useWs((s) => s.reloadProject)
  const flushGroups = useWs((s) => s.flushGroups)
  const setStep = useWs((s) => s.setStep)
  const fixAvailable = useEnv((s) => s.fixAvailable)
  const openFix = useEnv((s) => s.openFix)
  const { mode, zoom, dark, open, setMode, setZoom, setDark } = useRv()
  const { input, status, job, group } = item
  const busy = status === 'regen'
  const [versions, setVersions] = useState<VersionInfo[]>([])
  const [hold, setHold] = useState(false)
  const [note, setNote] = useState('')
  const [prevNote, setPrevNote] = useState<string | null>(null)
  const [polish, setPolish] = useState<PolishState | null>(null)
  const [nine, setNine] = useState(input.type === 'nine')
  const [edges, setEdges] = useState<EdgeSide[]>([])
  const [dirty, setDirty] = useState(false)
  const [reproc, setReproc] = useState(false)
  const [queuing, setQueuing] = useState(false)
  const noteRef = useRef<HTMLTextAreaElement>(null)
  const inspRef = useRef<HTMLElement>(null)
  const ref = useRef<HTMLDivElement>(null)

  const vkey = input.versions.join(',')
  useEffect(() => {
    let alive = true
    if (!rel || !input.versions.length) {
      setVersions([])
      return
    }
    void window.gas.review.versions(rel, input.id).then((v) => {
      if (alive) setVersions(v)
    })
    return () => {
      alive = false
    }
  }, [rel, input.id, vkey, input.versions.length])

  const cur = versions.find((v) => v.v === input.selected) ?? null
  useEffect(() => {
    setNine(cur?.nineSlice ?? input.type === 'nine')
    setEdges(cur?.edgeAnchored ?? [])
    setDirty(false)
  }, [input.id, cur?.v, cur?.nineSlice, cur?.edgeAnchored, input.type])

  useEffect(() => {
    setNote('')
    setPolish(null)
    setPrevNote(null)
    setHold(false)
    if (inspRef.current) inspRef.current.scrollTop = 0
  }, [input.id])

  useEffect(() => {
    ref.current?.focus()
  }, [])

  const newUrl = cur?.url ?? input.selectedUrl
  const newLabel = input.selected ? `${t('review.detail.new')} · v${input.selected}` : t('review.detail.none')
  const errText = job?.error ? `${job.error.code}: ${job.error.message}` : ''
  const canDecide = input.selected > 0 && !busy
  const last = idx >= total - 1
  const toExport = last && input.decision === 'approved'

  const decide = useCallback(
    (d: 'approved' | 'rejected') => {
      if (!canDecide) return
      const next = input.decision === d ? null : d
      if (next === 'approved' && !last) onNav(1)
      void setDecision([input.id], next)
    },
    [canDecide, input.id, input.decision, last, onNav]
  )

  const goExport = (): void => {
    open(null)
    setStep(5)
  }

  const runPolish = async (): Promise<void> => {
    if (!note.trim()) {
      toast(t('style.polish.empty'), 'warn')
      return
    }
    const v = polish && polish.phase === 'done' ? polish.v + 1 : 1
    setPolish({ phase: 'loading' })
    try {
      const result = await window.gas.style.polish({ prompt: note, context: 'regenNote', lang })
      setPolish({ phase: 'done', result, v })
    } catch (e) {
      setPolish({ phase: 'error', msg: errMsg(e) })
    }
  }

  const reprocess = async (): Promise<void> => {
    if (!rel || !cur || reproc) return
    setReproc(true)
    try {
      const r = await window.gas.review.reprocess(rel, input.id, cur.v, { nineSlice: nine, edgeAnchored: edges })
      if (r.ok && r.version) {
        toast(t('review.proc.done', { v: r.version }), r.qa?.pass === false ? 'warn' : 'ok')
        await reload()
      } else toast(t('review.proc.failed', { msg: r.error ?? '' }), 'err')
    } catch (e) {
      toast(t('review.proc.failed', { msg: errMsg(e) }), 'err')
    } finally {
      setReproc(false)
    }
  }

  const regen = async (): Promise<void> => {
    if (busy || queuing) return
    if (!group || !isLocked(group)) {
      toast(t('review.regen.noGroup'), 'warn')
      return
    }
    setQueuing(true)
    try {
      await flushGroups()
      const spec: JobSpec = {
        projectPath: project.dir,
        assetRelPath: input.outRel,
        sourcePath: input.abs,
        groupId: group.id,
        stylePrompt: group.promptEn,
        styleImages: group.lockImage ? [projAbs(project.dir, group.lockImage)] : [],
        refImages: group.refImages.map((r) => projAbs(project.dir, r)),
        nineSlice: dirty ? nine : input.type === 'nine',
        edgeAnchored: dirty ? edges : 'auto'
      }
      if (note.trim()) spec.note = note.trim()
      await window.gas.queue.enqueue([spec])
      await resetReview(input.id)
      setNote('')
      setPolish(null)
      toast(t('review.regen.enqueued', { name: input.name }))
    } catch (e) {
      toast(errMsg(e), 'err')
    } finally {
      setQueuing(false)
    }
  }

  useEffect(() => {
    const typing = (el: HTMLElement | null): boolean =>
      !!el && ((el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range') || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)
    const onDown = (e: KeyboardEvent): void => {
      if (document.querySelector('.modal-root')) return
      const el = e.target as HTMLElement | null
      if (typing(el)) {
        if (e.key === 'Escape') {
          e.preventDefault()
          el?.blur()
          ref.current?.focus()
        } else if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && el === noteRef.current) {
          e.preventDefault()
          void regen()
        }
        return
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return
      const k = e.key.toLowerCase()
      if (e.key === 'Escape') {
        e.preventDefault()
        open(null)
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        onNav(e.key === 'ArrowRight' ? 1 : -1)
      } else if (e.key === ' ') {
        e.preventDefault()
        if (!e.repeat && newUrl) setHold(true)
      } else if (e.key === 'Enter' && toExport) {
        e.preventDefault()
        goExport()
      } else if (k === 'a') {
        e.preventDefault()
        decide('approved')
      } else if (k === 'x') {
        e.preventDefault()
        decide('rejected')
      } else if (k === 'r') {
        e.preventDefault()
        noteRef.current?.focus()
      } else if (e.key === '1' || e.key === '2' || e.key === '3') {
        e.preventDefault()
        setMode(MODES[Number(e.key) - 1])
      }
    }
    const onUp = (e: KeyboardEvent): void => {
      if (e.key === ' ') setHold(false)
    }
    const onBlur = (): void => setHold(false)
    window.addEventListener('keydown', onDown)
    window.addEventListener('keyup', onUp)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onDown)
      window.removeEventListener('keyup', onUp)
      window.removeEventListener('blur', onBlur)
    }
  })

  const modeOptions = MODES.map((m) => ({ value: m, label: t(`review.detail.modes.${m}`) }))
  const zoomOptions = (['fit', 'one', 'two'] as ZoomMode[]).map((z) => ({ value: z, label: t(`review.detail.zoom.${z}`) }))

  return (
    <motion.div
      ref={ref}
      tabIndex={-1}
      className="rv-sheet"
      role="dialog"
      aria-modal="true"
      aria-label={input.name}
      initial={{ opacity: 0, y: 18, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: 10, scale: 0.985, transition: fadeTransition }}
      transition={sheetTransition}
    >
      <header className="rv-head">
        <div className="rv-ttl">
          <b>{input.name}</b>
          <span className="mono muted" title={input.outRel}>
            {input.outRel} · {input.w}×{input.h} · {input.type === 'nine' ? t('review.detail.nine') : t('review.detail.normal')}
          </span>
        </div>
        <div className="grow" />
        <Segmented value={mode} options={modeOptions} onChange={setMode} ariaLabel={t('review.detail.modeLabel')} />
        <Segmented value={zoom} options={zoomOptions} onChange={setZoom} ariaLabel={t('review.detail.zoomLabel')} />
        <button type="button" className={dark ? 'icon-btn on' : 'icon-btn'} aria-pressed={dark} title={t(dark ? 'review.detail.bg.light' : 'review.detail.bg.dark')} aria-label={t(dark ? 'review.detail.bg.light' : 'review.detail.bg.dark')} onClick={() => setDark(!dark)}>
          <Icon name={dark ? 'sun' : 'moon'} size={15} />
        </button>
        <span className="sep-v" />
        <button type="button" className="icon-btn" disabled={idx <= 0} aria-label={t('review.detail.prev')} title={t('review.detail.prev')} onClick={() => onNav(-1)}>
          <Icon name="left" />
        </button>
        <span className="muted rv-count">
          {idx + 1}/{total}
        </span>
        <button type="button" className="icon-btn" disabled={idx >= total - 1} aria-label={t('review.detail.next')} title={t('review.detail.next')} onClick={() => onNav(1)}>
          <Icon name="right" />
        </button>
        <button type="button" className="icon-btn" aria-label={t('review.detail.close')} title={t('review.detail.close')} onClick={() => open(null)}>
          <Icon name="x" />
        </button>
      </header>
      <div className="rv-body">
        <Viewer item={item} newUrl={newUrl} newLabel={newLabel} hold={hold} setHold={setHold} />
        <aside className="rv-insp" ref={inspRef}>
          <section>
            <div className="rv-st">
              <RvChip status={status} />
              <span className="muted">
                {t('review.detail.genCount', { count: input.versions.length })}
                {group ? ` · ${group.name}` : ''}
              </span>
            </div>
            {status === 'err' && job && (
              <div className="note err rv-err">
                <Icon name="alert" size={14} />
                <div className="note-t">
                  <b>{t('review.error.title')}</b>
                  <span title={errText}>{job.error?.message}</span>
                </div>
                <div className="rv-err-acts">
                  <button type="button" className="btn sm" onClick={() => void window.gas.queue.retry(job.id)}>
                    <Icon name="refresh" size={12} />
                    {t('review.error.retry')}
                  </button>
                  {fixAvailable && (
                    <button type="button" className="btn sm primary" onClick={() => void openFix({ source: 'gen', target: job.id, error: `${errText}\nAsset: ${job.assetRelPath}\nSource: ${job.sourcePath}` })}>
                      <Icon name="sparkles" size={12} />
                      {t('review.error.sendFix')}
                    </button>
                  )}
                  <button
                    type="button"
                    className="btn sm ghost"
                    onClick={() => {
                      void navigator.clipboard.writeText(errText)
                      toast(t('gen.copied'), 'info')
                    }}
                  >
                    <Icon name="copy" size={12} />
                    {t('review.error.copy')}
                  </button>
                </div>
              </div>
            )}
          </section>
          {input.selected > 0 && (
            <section>
              <h3>
                <Icon name="shield" size={14} />
                {t('review.qa.title')}
                {cur?.qa && <span className={cur.qa.pass ? 'chip c-green rv-qa-chip' : 'chip c-orange rv-qa-chip'}>{t(cur.qa.pass ? 'review.qa.pass' : 'review.qa.fail')}</span>}
              </h3>
              {cur?.qa ? <QaList checks={cur.qa.checks} /> : <p className="muted rv-small">{t('review.qa.none')}</p>}
            </section>
          )}
          {input.versions.length > 0 && (
            <section>
              <h3>
                <Icon name="layers" size={14} />
                {t('review.versions.title')}
              </h3>
              <div className="rv-vers">
                {[...versions].reverse().map((v) => {
                  const on = v.v === input.selected
                  const tip = [t('review.versions.pick', { v: v.v }), v.reprocessOf ? t('review.versions.reprocess', { v: v.reprocessOf }) : t('review.versions.gen'), v.note ? `${t('review.versions.note')}: ${v.note}` : '', timeOf(v.createdAt, lang)].filter(Boolean).join('\n')
                  return (
                    <button key={v.v} type="button" className={on ? 'rv-ver on' : 'rv-ver'} title={tip} aria-pressed={on} onClick={() => !on && void selectVersion(input, v.v)}>
                      <div className={`rv-ver-th ck${dark ? ' dk' : ''}`}>
                        <img src={v.url} alt="" draggable={false} />
                        {v.qa && <i className={v.qa.pass ? 'rv-dot ok' : 'rv-dot bad'} />}
                      </div>
                      <span className="rv-ver-n">
                        v{v.v}
                        {v.reprocessOf ? <Icon name="wand" size={10} /> : null}
                      </span>
                      <span className="rv-ver-t">{on ? t('review.versions.used') : timeOf(v.createdAt, lang, true)}</span>
                    </button>
                  )
                })}
                {busy && (
                  <div className="rv-ver add">
                    <span className="spin" />
                  </div>
                )}
              </div>
              {cur && (cur.note || cur.reprocessOf) && (
                <div className="rv-ver-note" title={cur.note ?? undefined}>
                  <b>v{cur.v}</b> · {cur.reprocessOf ? t('review.versions.reprocess', { v: cur.reprocessOf }) : t('review.versions.gen')}
                  {cur.note ? `: “${cur.note}”` : ''}
                </div>
              )}
            </section>
          )}
          {cur && (
            <section>
              <h3>
                <Icon name="wand" size={14} />
                {t('review.proc.title')}
              </h3>
              <label className="rv-tg" title={t('review.proc.nineHint')}>
                <span>{t('review.proc.nine')}</span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={nine}
                  className={nine ? 'rv-sw on' : 'rv-sw'}
                  onClick={() => {
                    setNine(!nine)
                    setDirty(true)
                  }}
                >
                  <i />
                </button>
              </label>
              <div className="rv-tg" title={t('review.proc.edgesHint')}>
                <span>{t('review.proc.edges')}</span>
                <div className="rv-sides">
                  {SIDES.map((s) => {
                    const on = edges.includes(s)
                    return (
                      <button
                        key={s}
                        type="button"
                        aria-pressed={on}
                        className={on ? `rv-side ${s} on` : `rv-side ${s}`}
                        title={t(`review.proc.sides.${s}`)}
                        onClick={() => {
                          setEdges(on ? edges.filter((x) => x !== s) : [...edges, s])
                          setDirty(true)
                        }}
                      >
                        {t(`review.proc.sides.${s}`)}
                      </button>
                    )
                  })}
                </div>
              </div>
              <p className="muted rv-small">{cur.hasRaw ? t('review.proc.hint', { v: cur.v }) : t('review.proc.noRaw')}</p>
              <button type="button" className="btn sm rv-wide" disabled={!cur.hasRaw || reproc || busy} onClick={() => void reprocess()}>
                {reproc ? <span className="spin xs" /> : <Icon name="wand" size={13} />}
                {reproc ? t('review.proc.running') : t('review.proc.run')}
              </button>
            </section>
          )}
          <section>
            <h3>
              <Icon name="refresh" size={14} />
              {t('review.regen.title')}
            </h3>
            <textarea ref={noteRef} className="ta" rows={3} value={note} placeholder={t('review.regen.placeholder')} disabled={busy} onChange={(e) => setNote(e.target.value)} />
            <div className="ptools">
              <button type="button" className="btn sm" disabled={busy || polish?.phase === 'loading'} onClick={() => void runPolish()}>
                <Icon name="sparkles" size={13} />
                {t('style.polish.button')}
              </button>
              <ModelChip task="promptPolish" />
              {prevNote !== null && (
                <button
                  type="button"
                  className="btn sm ghost"
                  onClick={() => {
                    setNote(prevNote)
                    setPrevNote(null)
                  }}
                >
                  <Icon name="refresh" size={13} />
                  {t('style.polish.undo')}
                </button>
              )}
            </div>
            <AnimatePresence initial={false}>
              {polish && (
                <PolishPanel
                  key="pf"
                  state={polish}
                  onUse={() => {
                    if (polish.phase !== 'done') return
                    setPrevNote(note)
                    setNote(polish.result.promptEn)
                    setPolish(null)
                  }}
                  onAgain={() => void runPolish()}
                  onDrop={() => setPolish(null)}
                />
              )}
            </AnimatePresence>
            <p className="muted rv-small">{group && isLocked(group) ? t('review.regen.hint') : t('review.regen.noGroup')}</p>
            <button type="button" className="btn rv-wide" disabled={busy || queuing || !group || !isLocked(group)} onClick={() => void regen()}>
              {busy || queuing ? <span className="spin xs" /> : <Icon name="refresh" size={14} />}
              {busy ? t('review.regen.running') : t('review.regen.button')}
              <span className="kbd">R</span>
            </button>
          </section>
          <div className="rv-acts">
            <button type="button" className={input.decision === 'rejected' ? 'btn on-flag' : 'btn'} disabled={!canDecide} onClick={() => decide('rejected')}>
              <Icon name="flag" size={14} />
              {input.decision === 'rejected' ? t('review.unreject') : t('review.reject')}
              <span className="kbd">X</span>
            </button>
            <button type="button" className={input.decision === 'approved' ? 'btn' : 'btn primary'} disabled={!canDecide} onClick={() => decide('approved')}>
              <Icon name={input.decision === 'approved' ? 'x' : 'check'} size={14} />
              {input.decision === 'approved' ? t('review.unapprove') : t('review.approve')}
              <span className="kbd">A</span>
            </button>
            {toExport && (
              <button type="button" className="btn primary rv-next" onClick={goExport}>
                {t('review.next')}
                <Icon name="right" size={14} />
              </button>
            )}
          </div>
        </aside>
      </div>
    </motion.div>
  )
}

export function ReviewDetail({ project, items }: { project: ProjectView; items: RvItem[] }): ReactElement {
  const detail = useRv((s) => s.detail)
  const open = useRv((s) => s.open)
  const idx = useMemo(() => items.findIndex((x) => x.input.id === detail), [items, detail])
  const item = idx >= 0 ? items[idx] : null

  useEffect(() => {
    if (detail && !item) open(null)
  }, [detail, item, open])

  const nav = (d: number): void => {
    const next = items[idx + d]
    if (next) open(next.input.id)
  }

  return (
    <AnimatePresence>
      {item && (
        <div className="rv-root" key="rv">
          <motion.div className="scrim" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fadeTransition} onClick={() => open(null)} />
          <Sheet project={project} item={item} idx={idx} total={items.length} onNav={nav} />
        </div>
      )}
    </AnimatePresence>
  )
}
