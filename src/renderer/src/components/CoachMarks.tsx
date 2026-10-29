import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { i18n as I18n } from 'i18next'
import coachVi from '../i18n/coach.vi.json'
import coachEn from '../i18n/coach.en.json'
import '../styles/coach.css'

export type CoachPlacement = 'auto' | 'top' | 'bottom' | 'left' | 'right'

export interface CoachStep {
  id: string
  target: string | string[]
  title: string
  body: string
  placement?: CoachPlacement
  padding?: number
}

export interface CoachCloseInfo {
  tourId: string
  completed: boolean
  stepId: string | null
  shown: number
}

export interface CoachMarksProps {
  tourId: string
  steps: CoachStep[]
  open: boolean
  onClose: (info: CoachCloseInfo) => void
  onSeen?: (tourId: string) => void
}

interface Box {
  x: number
  y: number
  w: number
  h: number
}

interface Layout {
  hole: Box
  radius: number
  bx: number
  by: number
}

const BUNDLES: Record<string, object> = { vi: coachVi, en: coachEn }
const MARGIN = 12
const GAP = 14
const DEFAULT_PAD = 6

export function ensureCoachBundles(i18n: I18n): void {
  for (const [lng, bundle] of Object.entries(BUNDLES)) {
    if (!i18n.getResource(lng, 'translation', 'coach.ui.next')) i18n.addResourceBundle(lng, 'translation', bundle, true, false)
  }
}

function targetsOf(step: CoachStep): string[] {
  return Array.isArray(step.target) ? step.target : [step.target]
}

export function findCoachTarget(step: CoachStep): HTMLElement | null {
  for (const s of targetsOf(step)) {
    let list: NodeListOf<HTMLElement>
    try {
      list = document.querySelectorAll<HTMLElement>(s)
    } catch {
      continue
    }
    for (const el of Array.from(list)) {
      const r = el.getBoundingClientRect()
      if (r.width > 0 && r.height > 0) return el
    }
  }
  return null
}

function presentIndices(steps: CoachStep[]): number[] {
  const out: number[] = []
  steps.forEach((s, i) => {
    if (findCoachTarget(s)) out.push(i)
  })
  return out
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v))
}

function order(p: CoachPlacement): Exclude<CoachPlacement, 'auto'>[] {
  if (p === 'auto') return ['right', 'bottom', 'top', 'left']
  const opposite = { top: 'bottom', bottom: 'top', left: 'right', right: 'left' } as const
  const rest = (['right', 'bottom', 'top', 'left'] as const).filter((x) => x !== p && x !== opposite[p])
  return [p, opposite[p], ...rest]
}

function computeLayout(el: HTMLElement, step: CoachStep, bw: number, bh: number): Layout {
  const vw = window.innerWidth
  const vh = window.innerHeight
  const r = el.getBoundingClientRect()
  const pad = step.padding ?? DEFAULT_PAD
  const x = clamp(r.left - pad, 4, vw - 8)
  const y = clamp(r.top - pad, 4, vh - 8)
  const hole: Box = { x, y, w: Math.max(8, Math.min(r.right + pad, vw - 4) - x), h: Math.max(8, Math.min(r.bottom + pad, vh - 4) - y) }
  const radius = Math.min(12, Math.min(hole.w, hole.h) / 2)
  const fits = {
    right: hole.x + hole.w + GAP + bw <= vw - MARGIN,
    left: hole.x - GAP - bw >= MARGIN,
    bottom: hole.y + hole.h + GAP + bh <= vh - MARGIN,
    top: hole.y - GAP - bh >= MARGIN
  }
  const cx = hole.x + hole.w / 2
  const cy = hole.y + hole.h / 2
  let bx = clamp(cx - bw / 2, MARGIN, vw - bw - MARGIN)
  let by = clamp(hole.y + hole.h - bh - 16, MARGIN, vh - bh - MARGIN)
  const pick = order(step.placement ?? 'auto').find((p) => fits[p])
  if (pick === 'right' || pick === 'left') {
    bx = pick === 'right' ? hole.x + hole.w + GAP : hole.x - GAP - bw
    by = clamp(cy - bh / 2, MARGIN, vh - bh - MARGIN)
  } else if (pick === 'bottom' || pick === 'top') {
    bx = clamp(cx - bw / 2, MARGIN, vw - bw - MARGIN)
    by = pick === 'bottom' ? hole.y + hole.h + GAP : hole.y - GAP - bh
  }
  return { hole, radius, bx: Math.round(bx), by: Math.round(by) }
}

function same(a: Layout | null, b: Layout): boolean {
  if (!a) return false
  const d = (p: number, q: number): boolean => Math.abs(p - q) < 0.5
  return d(a.hole.x, b.hole.x) && d(a.hole.y, b.hole.y) && d(a.hole.w, b.hole.w) && d(a.hole.h, b.hole.h) && d(a.bx, b.bx) && d(a.by, b.by)
}

function useReducedMotionPref(): boolean {
  const [rm, setRm] = useState(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = (): void => setRm(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return rm
}

function focusables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>('button:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'))
}

export function CoachMarks({ tourId, steps, open, onClose, onSeen }: CoachMarksProps): ReactElement | null {
  const { t: rawT, i18n } = useTranslation()
  ensureCoachBundles(i18n)
  const t = rawT as unknown as (key: string, vars?: Record<string, string | number>) => string
  const rm = useReducedMotionPref()
  const [index, setIndex] = useState<number | null>(null)
  const [present, setPresent] = useState<number[]>([])
  const [layout, setLayout] = useState<Layout | null>(null)
  const [instant, setInstant] = useState(true)
  const bubRef = useRef<HTMLDivElement | null>(null)
  const nextRef = useRef<HTMLButtonElement | null>(null)
  const targetRef = useRef<HTMLElement | null>(null)
  const layoutRef = useRef<Layout | null>(null)
  const indexRef = useRef<number | null>(null)
  const shownRef = useRef(0)
  const prevFocus = useRef<Element | null>(null)
  const closingRef = useRef(false)
  const stepsRef = useRef(steps)
  const cbRef = useRef({ onClose, onSeen, tourId })

  indexRef.current = index
  stepsRef.current = steps
  cbRef.current = { onClose, onSeen, tourId }

  const finish = useCallback(
    (completed: boolean) => {
      if (closingRef.current) return
      closingRef.current = true
      const i = indexRef.current
      const shown = shownRef.current
      const cb = cbRef.current
      if (shown > 0) cb.onSeen?.(cb.tourId)
      setIndex(null)
      setLayout(null)
      layoutRef.current = null
      targetRef.current = null
      const pf = prevFocus.current
      if (pf instanceof HTMLElement && pf.isConnected) pf.focus({ preventScroll: true })
      cb.onClose({ tourId: cb.tourId, completed, stepId: i !== null ? (stepsRef.current[i]?.id ?? null) : null, shown })
    },
    []
  )

  const go = useCallback(
    (dir: 1 | -1) => {
      const list = stepsRef.current
      const cur = indexRef.current ?? -1
      for (let i = cur + dir; i >= 0 && i < list.length; i += dir) {
        if (findCoachTarget(list[i])) {
          setPresent(presentIndices(list))
          setIndex(i)
          return
        }
      }
      if (dir > 0) finish(true)
    },
    [finish]
  )

  useEffect(() => {
    if (!open) {
      if (indexRef.current !== null && !closingRef.current) {
        setIndex(null)
        setLayout(null)
        layoutRef.current = null
      }
      return
    }
    closingRef.current = false
    shownRef.current = 0
    prevFocus.current = document.activeElement
    const list = presentIndices(stepsRef.current)
    setPresent(list)
    setInstant(true)
    if (!list.length) {
      finish(false)
      return
    }
    setIndex(list[0])
  }, [open, finish])

  useEffect(() => {
    if (index === null) return
    shownRef.current++
    const el = findCoachTarget(stepsRef.current[index])
    targetRef.current = el
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: rm ? 'auto' : 'smooth' })
    nextRef.current?.focus({ preventScroll: true })
  }, [index, rm])

  useLayoutEffect(() => {
    if (index === null) return
    let raf = 0
    let misses = 0
    const tick = (): void => {
      const step = stepsRef.current[index]
      if (!step) return
      let el = targetRef.current
      if (!el || !el.isConnected || el.getBoundingClientRect().width === 0) {
        el = findCoachTarget(step)
        targetRef.current = el
      }
      if (!el) {
        if (++misses > 6) {
          go(1)
          return
        }
      } else {
        misses = 0
        const bub = bubRef.current
        const next = computeLayout(el, step, bub?.offsetWidth || 304, bub?.offsetHeight || 170)
        if (!same(layoutRef.current, next)) {
          layoutRef.current = next
          setLayout(next)
        }
      }
      raf = requestAnimationFrame(tick)
    }
    tick()
    return () => cancelAnimationFrame(raf)
  }, [index, go])

  useEffect(() => {
    if (!layout || !instant) return
    const raf = requestAnimationFrame(() => requestAnimationFrame(() => setInstant(false)))
    return () => cancelAnimationFrame(raf)
  }, [layout, instant])

  useEffect(() => {
    if (index === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopImmediatePropagation()
        finish(false)
      } else if (e.key === 'ArrowRight' || (e.key === 'Enter' && document.activeElement === document.body)) {
        e.preventDefault()
        e.stopImmediatePropagation()
        go(1)
      } else if (e.key === 'ArrowLeft') {
        e.preventDefault()
        e.stopImmediatePropagation()
        go(-1)
      } else if (e.key === 'Tab') {
        const bub = bubRef.current
        if (!bub) return
        const items = focusables(bub)
        if (!items.length) return
        const first = items[0]
        const last = items[items.length - 1]
        const active = document.activeElement
        if (!bub.contains(active)) {
          e.preventDefault()
          first.focus()
        } else if (e.shiftKey && active === first) {
          e.preventDefault()
          last.focus()
        } else if (!e.shiftKey && active === last) {
          e.preventDefault()
          first.focus()
        }
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [index, finish, go])

  const step = index === null ? undefined : steps[index]
  if (index === null || !step) return null
  const pos = present.indexOf(index)
  const total = present.length || 1
  const n = pos >= 0 ? pos + 1 : 1
  const isLast = !present.some((i) => i > index)
  const isFirst = !present.some((i) => i < index)
  const tx = (key: string): string => (i18n.exists(key) ? t(key) : key)
  const titleId = `coach-${tourId}-title`
  const bodyId = `coach-${tourId}-body`
  const noAnim = instant ? { transition: 'none' } : undefined

  return createPortal(
    <div className={rm ? 'coach-root rm' : 'coach-root'} data-tour={tourId}>
      <div className="coach-block" aria-hidden="true" />
      <div
        className={layout ? 'coach-hole' : 'coach-hole pending'}
        aria-hidden="true"
        style={layout ? { transform: `translate(${layout.hole.x}px, ${layout.hole.y}px)`, width: layout.hole.w, height: layout.hole.h, borderRadius: layout.radius, ...noAnim } : undefined}
      />
      <div
        ref={bubRef}
        className={layout ? 'coach-bub' : 'coach-bub pending'}
        role="dialog"
        aria-modal="true"
        aria-label={t('coach.ui.dialog')}
        aria-labelledby={titleId}
        aria-describedby={bodyId}
        tabIndex={-1}
        style={layout ? { transform: `translate(${layout.bx}px, ${layout.by}px)`, ...noAnim } : undefined}
      >
        <div className="cb-body" key={step.id} aria-live="polite">
          <div className="cb-k">{t('coach.ui.kicker', { n, total })}</div>
          <h3 id={titleId}>{tx(step.title)}</h3>
          <p id={bodyId}>{tx(step.body)}</p>
        </div>
        <div className="cb-a">
          <div className="cb-dots" role="img" aria-label={t('coach.ui.progress', { n, total })}>
            {present.map((i, k) => (
              <i key={steps[i]?.id ?? i} className={i === index ? 'on' : k < pos ? 'done' : undefined} />
            ))}
          </div>
          <button type="button" className="btn sm ghost" onClick={() => finish(false)}>
            {t('coach.ui.skip')}
          </button>
          {!isFirst && (
            <button type="button" className="btn sm" onClick={() => go(-1)}>
              {t('coach.ui.back')}
            </button>
          )}
          <button ref={nextRef} type="button" className="btn sm primary" onClick={() => go(1)}>
            {isLast ? t('coach.ui.done') : t('coach.ui.next')}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}

export interface CoachTourProps {
  tourId: string
  steps: CoachStep[]
  seen: boolean
  onSeen: (tourId: string) => void
  enabled?: boolean
  replay?: number
  delay?: number
  onClose?: (info: CoachCloseInfo) => void
}

export function CoachTour({ tourId, steps, seen, onSeen, enabled = true, replay = 0, delay = 450, onClose }: CoachTourProps): ReactElement | null {
  const [open, setOpen] = useState(false)
  const lastReplay = useRef(replay)
  const doneRef = useRef(false)
  const stepsRef = useRef(steps)
  stepsRef.current = steps

  useEffect(() => {
    if (!enabled || seen || open || doneRef.current) return
    let tries = 0
    let timer = window.setTimeout(function poll() {
      if (stepsRef.current.some((s) => findCoachTarget(s))) {
        setOpen(true)
        return
      }
      if (++tries < 20) timer = window.setTimeout(poll, 500)
    }, delay)
    return () => window.clearTimeout(timer)
  }, [enabled, seen, open, delay, tourId])

  useEffect(() => {
    if (replay === lastReplay.current) return
    lastReplay.current = replay
    if (!enabled) return
    doneRef.current = false
    const timer = window.setTimeout(() => setOpen(true), Math.min(delay, 250))
    return () => window.clearTimeout(timer)
  }, [replay, enabled, delay])

  const close = useCallback(
    (info: CoachCloseInfo) => {
      doneRef.current = true
      setOpen(false)
      onClose?.(info)
    },
    [onClose]
  )

  return <CoachMarks tourId={tourId} steps={steps} open={open} onClose={close} onSeen={onSeen} />
}
