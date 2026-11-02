import { useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from './Icon'
import { Segmented } from './Segmented'

export type CompareMode = 'side' | 'slider'

interface Props {
  versions: number[]
  selected: number
  render: (v: number, mode: CompareMode) => ReactNode
  onClose: () => void
  fill?: boolean
}

const STEP = 5

function before(versions: number[], v: number): number {
  const i = versions.indexOf(v)
  return versions[i > 0 ? i - 1 : i + 1] ?? v
}

function typing(el: HTMLElement | null): boolean {
  return !!el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable || (el.tagName === 'INPUT' && (el as HTMLInputElement).type !== 'range'))
}

export function VersionCompare({ versions, selected, render, onClose, fill }: Props): ReactElement {
  const { t } = useTranslation()
  const [a, setA] = useState(() => before(versions, selected))
  const [b, setB] = useState(selected)
  const [mode, setMode] = useState<CompareMode>('slider')
  const [pct, setPct] = useState(50)
  const lastSel = useRef(selected)

  useEffect(() => {
    if (lastSel.current === selected) return
    lastSel.current = selected
    setA(before(versions, selected))
    setB(selected)
  }, [selected, versions])

  const okA = versions.includes(a) ? a : (versions[0] ?? 0)
  const okB = versions.includes(b) ? b : (versions[versions.length - 1] ?? 0)

  useEffect(() => {
    if (mode !== 'slider') return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== '[' && e.key !== ']') return
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target as HTMLElement | null) || document.querySelector('.modal-root')) return
      e.preventDefault()
      setPct((p) => Math.min(100, Math.max(0, p + (e.key === ']' ? STEP : -STEP))))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mode])

  if (versions.length < 2) {
    return (
      <div className="vc">
        <div className="vc-bar">
          <span className="muted">{t('compare.only')}</span>
          <div className="grow" />
          <button type="button" className="icon-btn" aria-label={t('compare.close')} onClick={onClose}>
            <Icon name="x" size={14} />
          </button>
        </div>
      </div>
    )
  }

  const pick = (label: string, value: number, set: (v: number) => void): ReactElement => (
    <label className="vc-pick">
      <b>{label}</b>
      <select className="inp sm" value={value} onChange={(e) => set(Number(e.target.value))}>
        {versions.map((v) => (
          <option key={v} value={v}>
            v{v}
          </option>
        ))}
      </select>
    </label>
  )

  return (
    <div className={fill ? 'vc fill' : 'vc'}>
      <div className="vc-bar">
        {pick(t('compare.a'), okA, setA)}
        <button type="button" className="icon-btn" title={t('compare.swap')} aria-label={t('compare.swap')} onClick={() => { setA(okB); setB(okA) }}>
          <Icon name="refresh" size={13} />
        </button>
        {pick(t('compare.b'), okB, setB)}
        <Segmented<CompareMode>
          value={mode}
          ariaLabel={t('compare.mode')}
          onChange={setMode}
          options={[
            { value: 'slider', label: t('compare.slider') },
            { value: 'side', label: t('compare.side') }
          ]}
        />
        <div className="grow" />
        {mode === 'slider' && <span className="muted vc-hint">{t('compare.sliderKeys')}</span>}
        <button type="button" className="icon-btn" aria-label={t('compare.close')} onClick={onClose}>
          <Icon name="x" size={14} />
        </button>
      </div>
      {mode === 'side' ? (
        <div className="vc-stage vc-side">
          {[okA, okB].map((v, i) => (
            <figure className="vc-pane" key={i}>
              <div className="vc-box ck">{render(v, 'side')}</div>
              <figcaption>
                {i === 0 ? t('compare.a') : t('compare.b')} · v{v}
              </figcaption>
            </figure>
          ))}
        </div>
      ) : (
        <div className="vc-stage">
          <div className="vc-box vc-sl ck">
            <div className="vc-layer">{render(okA, 'slider')}</div>
            <div className="vc-layer" style={{ clipPath: `inset(0 0 0 ${pct}%)` }}>
              {render(okB, 'slider')}
            </div>
            <div className="vc-line" style={{ left: `${pct}%` }}>
              <span>
                <Icon name="left" size={12} />
                <Icon name="right" size={12} />
              </span>
            </div>
            <span className="vc-tag a">
              {t('compare.a')} · v{okA}
            </span>
            <span className="vc-tag b">
              {t('compare.b')} · v{okB}
            </span>
            <input
              className="vc-in"
              type="range"
              min={0}
              max={100}
              value={pct}
              aria-label={t('compare.drag')}
              onChange={(e) => setPct(Number(e.target.value))}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') e.stopPropagation()
              }}
            />
          </div>
        </div>
      )}
    </div>
  )
}
