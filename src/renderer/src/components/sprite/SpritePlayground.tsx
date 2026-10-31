import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import type { DirSet, Direction, FrameRect, SpriteAnim, ViewAngle } from '@shared/sprite'
import { KEY_VEC, drawFrame, findAnim, frameBox, frameOrigin, heldVector, setDirs, useImage, vectorToDir } from './draw'
import { useSize } from './useSize'
import { useSpriteT } from './useSpriteT'
import '@renderer/styles/sprite.css'

export interface SpritePlaygroundProps {
  url: string
  frames: FrameRect[]
  anims: SpriteAnim[]
  dirSet: DirSet
  view: ViewAngle
  height?: number
  speed?: number
}

const TILE = 32

function cssVar(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim()
  return v || fallback
}

export function SpritePlayground({ url, frames, anims, dirSet, view, height = 240, speed = 110 }: SpritePlaygroundProps): ReactElement {
  const t = useSpriteT()
  const img = useImage(url)
  const wrapRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = useSize(wrapRef)
  const keys = useRef(new Set<string>())
  const pos = useRef({ x: 0, y: 0 })
  const dirRef = useRef<Direction | null>(setDirs(dirSet)[0] ?? null)
  const anim = useRef({ id: '', t: 0, i: 0 })
  const [focused, setFocused] = useState(false)
  const [hud, setHud] = useState<{ dir: Direction | null; name: string }>({ dir: dirRef.current, name: '' })

  const box = useMemo(() => {
    const all: number[] = []
    for (const a of anims) all.push(...a.frames)
    return frameBox(frames, all)
  }, [frames, anims])

  useEffect(() => {
    const dirs = setDirs(dirSet)
    if (!dirRef.current || !dirs.includes(dirRef.current)) dirRef.current = dirs[0] ?? null
  }, [dirSet])

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !size.w || !size.h) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(size.w * dpr)
    cv.height = Math.round(size.h * dpr)
    const ctx = cv.getContext('2d')
    if (!ctx) return
    const lineCol = cssVar('--sep', 'rgba(0,0,0,.11)')
    const groundCol = cssVar('--surface2', '#F2F2F5')
    const fit = (size.h * 0.42) / box.h
    const s = fit >= 1 ? Math.floor(fit) : Math.max(0.2, fit)
    let raf = 0
    let last = performance.now()
    let hudKey = ''

    const frame = (now: number): void => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const [vx, vyRaw] = heldVector(keys.current)
      const vy = view === 'side' ? 0 : vyRaw
      const moving = vx !== 0 || vy !== 0
      if (moving) {
        const d = vectorToDir(vx, vyRaw || vy, dirSet)
        if (d) dirRef.current = d
        const len = Math.hypot(vx, vy) || 1
        pos.current.x += (vx / len) * speed * dt
        pos.current.y += (vy / len) * speed * dt * (view === 'iso' ? 0.5 : 1)
      }
      const walk = findAnim(anims, 'walk', dirRef.current)
      const idle = findAnim(anims, 'idle', dirRef.current)
      const cur = moving ? walk : (idle ?? walk)
      const frozen = !moving && !idle
      const a = anim.current
      if (!cur) {
        a.id = ''
        a.i = 0
      } else {
        if (a.id !== cur.id) {
          a.id = cur.id
          a.t = 0
          a.i = 0
        }
        if (frozen) a.i = 0
        else {
          a.t += dt
          const step = 1 / Math.max(1, cur.fps)
          while (a.t >= step) {
            a.t -= step
            a.i = cur.frames.length ? (a.i + 1) % cur.frames.length : 0
          }
        }
      }
      const nextHud = `${dirRef.current ?? ''}|${cur?.name ?? ''}`
      if (nextHud !== hudKey) {
        hudKey = nextHud
        setHud({ dir: dirRef.current, name: cur?.name ?? '' })
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size.w, size.h)
      const cx = Math.round(size.w / 2)
      const cy = Math.round(view === 'side' ? size.h * 0.72 : size.h * 0.62)
      const ox = cx - pos.current.x * s
      const oy = cy - pos.current.y * s
      const tp = TILE * s
      ctx.lineWidth = 1
      ctx.strokeStyle = lineCol
      ctx.beginPath()
      if (view === 'topdown') {
        for (let x = (((ox % tp) + tp) % tp) + 0.5; x < size.w; x += tp) {
          ctx.moveTo(x, 0)
          ctx.lineTo(x, size.h)
        }
        for (let y = (((oy % tp) + tp) % tp) + 0.5; y < size.h; y += tp) {
          ctx.moveTo(0, y)
          ctx.lineTo(size.w, y)
        }
      } else if (view === 'iso') {
        const step = tp
        const span = size.w * 0.5 + size.h
        for (const slope of [0.5, -0.5]) {
          const b0 = oy - slope * ox
          const k0 = Math.floor((-span - b0) / step)
          const k1 = Math.ceil((span + size.h - b0) / step)
          for (let k = k0; k <= k1; k++) {
            const b = b0 + k * step
            ctx.moveTo(0, b + 0.5)
            ctx.lineTo(size.w, b + slope * size.w + 0.5)
          }
        }
      } else {
        ctx.fillStyle = groundCol
        ctx.fillRect(0, cy, size.w, size.h - cy)
        ctx.moveTo(0, cy + 0.5)
        ctx.lineTo(size.w, cy + 0.5)
        for (let x = (((ox % tp) + tp) % tp) + 0.5; x < size.w; x += tp) {
          ctx.moveTo(x, cy)
          ctx.lineTo(x, size.h)
        }
      }
      ctx.stroke()

      ctx.fillStyle = 'rgba(0,0,0,.16)'
      ctx.beginPath()
      ctx.ellipse(cx, cy, Math.max(6, box.w * s * 0.28), Math.max(3, box.w * s * 0.09), 0, 0, Math.PI * 2)
      ctx.fill()

      if (img && cur && cur.frames.length) {
        const f = frames[cur.frames[Math.min(a.i, cur.frames.length - 1)]]
        if (f) {
          const o = frameOrigin(f, box)
          ctx.imageSmoothingEnabled = false
          ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (cx - Math.floor(box.w / 2) * s), dpr * (cy - box.h * s))
          drawFrame(ctx, img, f, o.x, o.y)
        }
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => cancelAnimationFrame(raf)
  }, [img, frames, anims, dirSet, view, size.w, size.h, box, speed])

  const hasWalk = anims.some((a) => a.name.toLowerCase().includes('walk'))

  return (
    <div
      ref={wrapRef}
      className={focused ? 'spr-play focus' : 'spr-play'}
      style={{ height }}
      tabIndex={0}
      aria-label={t('playground.label')}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false)
        keys.current.clear()
      }}
      onKeyDown={(e) => {
        if (!KEY_VEC[e.code]) return
        e.preventDefault()
        keys.current.add(e.code)
      }}
      onKeyUp={(e) => keys.current.delete(e.code)}
      onMouseDown={(e) => (e.currentTarget as HTMLElement).focus()}
    >
      <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} />
      <span className="spr-play-hud mono">
        {hud.dir ?? '—'} · {hud.name || t('playground.noAnim')}
      </span>
      {!focused && <span className="spr-play-hint">{hasWalk ? t('playground.hint') : t('playground.noWalk')}</span>}
    </div>
  )
}
