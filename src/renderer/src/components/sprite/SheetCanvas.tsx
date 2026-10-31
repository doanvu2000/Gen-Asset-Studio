import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactElement, type WheelEvent } from 'react'
import type { FrameRect, GridSpec } from '@shared/sprite'
import { Icon } from '../Icon'
import { useSize } from './useSize'
import { useSpriteT } from './useSpriteT'
import '@renderer/styles/sprite.css'

export interface SheetCanvasProps {
  url: string
  imageW: number
  imageH: number
  frames: FrameRect[]
  empty?: number[]
  highlight?: number[]
  selected?: number | null
  onPick?: (index: number) => void
  grid?: GridSpec | null
  onGrid?: (grid: GridSpec) => void
  height?: number | string
}

interface Box {
  i: number
  x: number
  y: number
  w: number
  h: number
  name: string
}

type Drag =
  | { kind: 'pan'; sx: number; sy: number; px: number; py: number; moved: boolean; click: boolean }
  | { kind: 'move' | 'w' | 'h' | 'wh'; sx: number; sy: number; g: GridSpec }

const MIN_Z = 0.05
const MAX_Z = 32

function gridBoxes(g: GridSpec): Box[] {
  const out: Box[] = []
  for (let r = 0; r < g.rows; r++) {
    for (let c = 0; c < g.cols; c++) {
      const i = r * g.cols + c
      out.push({ i, x: g.offsetX + c * (g.cellW + g.gapX), y: g.offsetY + r * (g.cellH + g.gapY), w: g.cellW, h: g.cellH, name: `#${i}` })
    }
  }
  return out
}

export function SheetCanvas({ url, imageW, imageH, frames, empty = [], highlight = [], selected = null, onPick, grid = null, onGrid, height = '100%' }: SheetCanvasProps): ReactElement {
  const t = useSpriteT()
  const vpRef = useRef<HTMLDivElement>(null)
  const size = useSize(vpRef)
  const [cam, setCam] = useState({ z: 1, x: 0, y: 0 })
  const zoom = cam.z
  const pan = cam
  const setPan = (p: { x: number; y: number }): void => setCam((c) => ({ ...c, x: p.x, y: p.y }))
  const [draft, setDraft] = useState<GridSpec | null>(null)
  const [hover, setHover] = useState<{ x: number; y: number; text: string } | null>(null)
  const drag = useRef<Drag | null>(null)
  const space = useRef(false)
  const fitted = useRef('')

  const g = draft ?? grid
  const editable = !!grid && !!onGrid
  const boxes = useMemo<Box[]>(() => (g ? gridBoxes(g).map((b) => ({ ...b, name: frames[b.i]?.name ?? b.name })) : frames.map((f, i) => ({ i, x: f.x, y: f.y, w: f.w, h: f.h, name: f.name }))), [g, frames])
  const emptySet = useMemo(() => new Set(empty), [empty])
  const hiSet = useMemo(() => new Set(highlight), [highlight])

  const fit = useCallback(() => {
    if (!size.w || !size.h || !imageW || !imageH) return
    const z = Math.max(MIN_Z, Math.min(MAX_Z, Math.min((size.w - 32) / imageW, (size.h - 32) / imageH)))
    setCam({ z, x: Math.round((size.w - imageW * z) / 2), y: Math.round((size.h - imageH * z) / 2) })
  }, [size.w, size.h, imageW, imageH])

  useEffect(() => {
    const key = `${url}|${imageW}|${imageH}|${size.w > 0 && size.h > 0}`
    if (fitted.current === key || !size.w) return
    fitted.current = key
    fit()
  }, [url, imageW, imageH, size.w, size.h, fit])

  const zoomAt = (factor: number, mx: number, my: number): void => {
    setCam((c) => {
      const nz = Math.max(MIN_Z, Math.min(MAX_Z, c.z * factor))
      return { z: nz, x: mx - (mx - c.x) * (nz / c.z), y: my - (my - c.y) * (nz / c.z) }
    })
  }

  const local = (e: { clientX: number; clientY: number }): { mx: number; my: number; ix: number; iy: number } => {
    const r = vpRef.current?.getBoundingClientRect()
    const mx = e.clientX - (r?.left ?? 0)
    const my = e.clientY - (r?.top ?? 0)
    return { mx, my, ix: (mx - pan.x) / zoom, iy: (my - pan.y) / zoom }
  }

  const hit = (ix: number, iy: number): Box | null => {
    for (let k = boxes.length - 1; k >= 0; k--) {
      const b = boxes[k]
      if (ix >= b.x && iy >= b.y && ix < b.x + b.w && iy < b.y + b.h) return b
    }
    return null
  }

  const onWheel = (e: WheelEvent): void => {
    const { mx, my } = local(e)
    zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, mx, my)
  }

  const onDown = (e: PointerEvent): void => {
    const target = e.target as Element
    const handle = target.getAttribute?.('data-h') as 'move' | 'w' | 'h' | 'wh' | null
    vpRef.current?.focus()
    if (e.button === 1 || (e.button === 0 && space.current)) {
      e.preventDefault()
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, moved: false, click: false }
    } else if (e.button === 0 && handle && editable && grid) {
      e.preventDefault()
      drag.current = { kind: handle, sx: e.clientX, sy: e.clientY, g: { ...grid } }
    } else if (e.button === 0) {
      drag.current = { kind: 'pan', sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, moved: false, click: true }
    } else return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
  }

  const onMove = (e: PointerEvent): void => {
    const d = drag.current
    if (!d) {
      const { mx, my, ix, iy } = local(e)
      const b = hit(ix, iy)
      setHover(b ? { x: mx, y: my, text: `${b.name}${emptySet.has(b.i) ? ` · ${t('sheet.emptyCell')}` : ''} · ${b.w}×${b.h}` } : null)
      return
    }
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    if (d.kind === 'pan') {
      if (!d.moved && Math.hypot(dx, dy) < 4) return
      d.moved = true
      setHover(null)
      setPan({ x: d.px + dx, y: d.py + dy })
      return
    }
    const ix = Math.round(dx / zoom)
    const iy = Math.round(dy / zoom)
    const n = { ...d.g }
    if (d.kind === 'move') {
      n.offsetX = Math.max(0, d.g.offsetX + ix)
      n.offsetY = Math.max(0, d.g.offsetY + iy)
    }
    if (d.kind === 'w' || d.kind === 'wh') n.cellW = Math.max(1, d.g.cellW + ix)
    if (d.kind === 'h' || d.kind === 'wh') n.cellH = Math.max(1, d.g.cellH + iy)
    setDraft(n)
  }

  const onUp = (e: PointerEvent): void => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.kind === 'pan') {
      if (d.click && !d.moved && onPick) {
        const { ix, iy } = local(e)
        const b = hit(ix, iy)
        if (b) onPick(b.i)
      }
      return
    }
    if (draft && onGrid) onGrid(draft)
    setDraft(null)
  }

  const stroke = 1
  const showNum = boxes.length > 0 && Math.min(...boxes.slice(0, 64).map((b) => Math.min(b.w, b.h))) * zoom >= 26
  const hs = 7 / zoom
  const first = g ? gridBoxes({ ...g, cols: 1, rows: 1 })[0] : null
  const over = g ? g.offsetX + g.cols * g.cellW + (g.cols - 1) * g.gapX > imageW || g.offsetY + g.rows * g.cellH + (g.rows - 1) * g.gapY > imageH : false

  return (
    <div
      ref={vpRef}
      className="spr-sheet"
      style={{ height }}
      tabIndex={0}
      onWheel={onWheel}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={() => {
        drag.current = null
        setDraft(null)
      }}
      onPointerLeave={() => setHover(null)}
      onKeyDown={(e) => {
        if (e.code === 'Space') {
          e.preventDefault()
          space.current = true
        }
      }}
      onKeyUp={(e) => {
        if (e.code === 'Space') space.current = false
      }}
      onBlur={() => (space.current = false)}
    >
      <div className="spr-sheet-in" style={{ width: imageW, height: imageH, transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})` }}>
        <img src={url} alt="" draggable={false} width={imageW} height={imageH} />
        <svg width={imageW} height={imageH} viewBox={`0 0 ${imageW} ${imageH}`}>
          <defs>
            <pattern id="spr-hatch" width={8} height={8} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <line x1={0} y1={0} x2={0} y2={8} className="spr-hatch-l" strokeWidth={2 / Math.max(zoom, 0.5)} />
            </pattern>
          </defs>
          {boxes.map((b) => {
            const cls = ['spr-r', emptySet.has(b.i) && 'empty', hiSet.has(b.i) && 'hi', selected === b.i && 'sel'].filter(Boolean).join(' ')
            return <rect key={b.i} className={cls} x={b.x} y={b.y} width={b.w} height={b.h} strokeWidth={stroke} vectorEffect="non-scaling-stroke" />
          })}
          {showNum &&
            boxes.map((b) => (
              <text key={`n${b.i}`} className="spr-num-l" x={b.x + 3 / zoom} y={b.y + 11 / zoom} fontSize={10 / zoom}>
                {b.i}
              </text>
            ))}
          {editable && first && (
            <g className="spr-handles">
              <rect data-h="move" className="spr-h-move" x={first.x} y={first.y} width={first.w} height={first.h} vectorEffect="non-scaling-stroke" />
              <rect data-h="w" className="spr-h-edge ew" x={first.x + first.w - hs / 2} y={first.y + hs} width={hs} height={Math.max(0, first.h - hs * 2)} />
              <rect data-h="h" className="spr-h-edge ns" x={first.x + hs} y={first.y + first.h - hs / 2} width={Math.max(0, first.w - hs * 2)} height={hs} />
              <rect data-h="wh" className="spr-h-corner" x={first.x + first.w - hs} y={first.y + first.h - hs} width={hs * 2} height={hs * 2} rx={hs / 3} />
            </g>
          )}
        </svg>
      </div>
      {hover && (
        <span className="spr-tip mono" style={{ left: hover.x + 14, top: hover.y + 14 }}>
          {hover.text}
        </span>
      )}
      {draft && (
        <span className="spr-sheet-drag mono">
          {draft.cellW}×{draft.cellH} · {draft.offsetX},{draft.offsetY}
        </span>
      )}
      {over && <span className="spr-sheet-warn">{t('grid.overflow')}</span>}
      <div className="spr-sheet-ctl" onPointerDown={(e) => e.stopPropagation()}>
        <button type="button" className="btn sm ghost icon" title={t('sheet.zoomOut')} onClick={() => zoomAt(1 / 1.25, size.w / 2, size.h / 2)}>
          −
        </button>
        <span className="mono">{Math.round(zoom * 100)}%</span>
        <button type="button" className="btn sm ghost icon" title={t('sheet.zoomIn')} onClick={() => zoomAt(1.25, size.w / 2, size.h / 2)}>
          <Icon name="plus" size={12} />
        </button>
        <button type="button" className="btn sm ghost" onClick={fit}>
          {t('sheet.fit')}
        </button>
        <button
          type="button"
          className="btn sm ghost"
          onClick={() => {
            setCam({ z: 1, x: Math.round((size.w - imageW) / 2), y: Math.round((size.h - imageH) / 2) })
          }}
        >
          1:1
        </button>
      </div>
    </div>
  )
}
