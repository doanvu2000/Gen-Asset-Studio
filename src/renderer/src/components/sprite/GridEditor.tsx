import { useEffect, useRef, useState, type ReactElement } from 'react'
import type { GridSpec } from '@shared/sprite'
import { Icon } from '../Icon'
import { useSpriteT } from './useSpriteT'
import '@renderer/styles/sprite.css'

export interface GridEditorProps {
  grid: GridSpec
  imageW: number
  imageH: number
  onChange: (grid: GridSpec) => void
  onDetect: () => void
  busy?: boolean
}

const FIELDS: Array<{ k: keyof GridSpec; min: number }> = [
  { k: 'cols', min: 1 },
  { k: 'rows', min: 1 },
  { k: 'cellW', min: 1 },
  { k: 'cellH', min: 1 },
  { k: 'offsetX', min: 0 },
  { k: 'offsetY', min: 0 },
  { k: 'gapX', min: 0 },
  { k: 'gapY', min: 0 }
]

export function gridExtent(g: GridSpec): { w: number; h: number } {
  return { w: g.offsetX + g.cols * g.cellW + Math.max(0, g.cols - 1) * g.gapX, h: g.offsetY + g.rows * g.cellH + Math.max(0, g.rows - 1) * g.gapY }
}

export function GridEditor({ grid, imageW, imageH, onChange, onDetect, busy = false }: GridEditorProps): ReactElement {
  const t = useSpriteT()
  const [draft, setDraft] = useState<Record<keyof GridSpec, string>>(() => toDraft(grid))
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const gridKey = FIELDS.map((f) => grid[f.k]).join(',')

  useEffect(() => {
    setDraft(toDraft(grid))
  }, [gridKey])

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const parsed = parse(draft, grid)
  const ext = gridExtent(parsed)
  const over = ext.w > imageW || ext.h > imageH

  const commit = (next: Record<keyof GridSpec, string>, delay: number): void => {
    if (timer.current) clearTimeout(timer.current)
    const g = parse(next, grid)
    if (FIELDS.every((f) => g[f.k] === grid[f.k])) return
    if (delay <= 0) onChange(g)
    else timer.current = setTimeout(() => onChange(g), delay)
  }

  return (
    <div className="spr-grid-ed">
      <div className="spr-grid-head">
        <b>{t('grid.title')}</b>
        <span className="muted mono">
          {parsed.cols}×{parsed.rows} = {parsed.cols * parsed.rows} {t('grid.cells')}
        </span>
        <span className="grow" />
        <button type="button" className="btn sm" disabled={busy} onClick={onDetect} title={t('grid.detectHint')}>
          {busy ? <span className="spin" /> : <Icon name="wand" size={13} />}
          {t('grid.detect')}
        </button>
      </div>
      <div className="spr-grid-fields">
        {FIELDS.map((f) => (
          <label key={f.k} className="spr-fld">
            <span>{t(`grid.${f.k}`)}</span>
            <input
              className="inp mono"
              type="number"
              min={f.min}
              value={draft[f.k]}
              onChange={(e) => {
                const next = { ...draft, [f.k]: e.target.value }
                setDraft(next)
                commit(next, 450)
              }}
              onBlur={() => commit(draft, 0)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commit(draft, 0)
              }}
            />
          </label>
        ))}
      </div>
      <div className={over ? 'spr-grid-foot warn' : 'spr-grid-foot'}>
        {over && <Icon name="alert" size={13} />}
        <span className="mono">
          {t('grid.extent', { w: ext.w, h: ext.h, iw: imageW, ih: imageH })}
        </span>
        {over && <span>{t('grid.overflow')}</span>}
      </div>
    </div>
  )
}

function toDraft(g: GridSpec): Record<keyof GridSpec, string> {
  const out = {} as Record<keyof GridSpec, string>
  for (const f of FIELDS) out[f.k] = String(g[f.k])
  return out
}

function parse(d: Record<keyof GridSpec, string>, fallback: GridSpec): GridSpec {
  const out = { ...fallback }
  for (const f of FIELDS) {
    const n = Math.round(Number(d[f.k]))
    out[f.k] = Number.isFinite(n) && d[f.k] !== '' ? Math.max(f.min, Math.min(16384, n)) : fallback[f.k]
  }
  return out
}
