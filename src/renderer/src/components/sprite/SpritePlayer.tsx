import { useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import type { FrameRect, LoopMode } from '@shared/sprite'
import { Icon } from '../Icon'
import { drawFrame, frameBox, frameOrigin, nextIndex, useImage } from './draw'
import { useSize } from './useSize'
import { useSpriteT } from './useSpriteT'
import '@renderer/styles/sprite.css'

export type StageBg = 'ck' | 'dark' | 'light'

export interface SpritePlayerProps {
  url: string
  frames: FrameRect[]
  sequence: number[]
  fps: number
  loop: LoopMode
  playing?: boolean
  onFrame?: (pos: number) => void
  height?: number
}

const ZOOMS = [0, 1, 2, 3, 4] as const
const LOOPS: LoopMode[] = ['loop', 'pingpong', 'once']

export function SpritePlayer({ url, frames, sequence, fps: fpsProp, loop: loopProp, playing: playingProp = true, onFrame, height = 260 }: SpritePlayerProps): ReactElement {
  const t = useSpriteT()
  const img = useImage(url)
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const size = useSize(stageRef)
  const [playing, setPlaying] = useState(playingProp)
  const [fps, setFps] = useState(fpsProp)
  const [loop, setLoop] = useState<LoopMode>(loopProp)
  const [pos, setPos] = useState(0)
  const [onion, setOnion] = useState(false)
  const [guides, setGuides] = useState(true)
  const [bg, setBg] = useState<StageBg>('ck')
  const [zoom, setZoom] = useState<(typeof ZOOMS)[number]>(0)
  const dirRef = useRef<1 | -1>(1)
  const posRef = useRef(0)
  posRef.current = pos
  const seqKey = sequence.join(',')

  useEffect(() => setPlaying(playingProp), [playingProp])
  useEffect(() => setFps(fpsProp), [fpsProp])
  useEffect(() => setLoop(loopProp), [loopProp])
  useEffect(() => {
    setPos(0)
    dirRef.current = 1
  }, [seqKey])

  const len = sequence.length
  const cur = len ? Math.min(pos, len - 1) : 0

  useEffect(() => {
    onFrame?.(cur)
  }, [cur, onFrame])

  useEffect(() => {
    if (!playing || len < 2 || fps <= 0) return
    let raf = 0
    let last = performance.now()
    let acc = 0
    const step = 1000 / Math.max(1, Math.min(60, fps))
    const tick = (now: number): void => {
      acc += now - last
      last = now
      if (acc >= step) {
        acc %= step
        const n = nextIndex(Math.min(posRef.current, len - 1), len, loop, dirRef.current)
        dirRef.current = n.dir
        posRef.current = n.pos
        setPos(n.pos)
        if (n.done) {
          setPlaying(false)
          return
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, len, fps, loop])

  const box = frameBox(frames, sequence)
  const fit = size.w && size.h ? Math.min((size.w - 24) / box.w, (size.h - 24) / box.h) : 1
  const scale = zoom === 0 ? (fit >= 1 ? Math.floor(fit) : Math.max(0.1, fit)) : zoom

  useEffect(() => {
    const cv = canvasRef.current
    if (!cv || !size.w || !size.h) return
    const dpr = window.devicePixelRatio || 1
    cv.width = Math.round(size.w * dpr)
    cv.height = Math.round(size.h * dpr)
    const ctx = cv.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, cv.width, cv.height)
    const ox = Math.round((size.w - box.w * scale) / 2)
    const oy = Math.round((size.h - box.h * scale) / 2)
    ctx.imageSmoothingEnabled = false
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * ox, dpr * oy)
    if (img && len) {
      if (onion && len > 1) {
        const prevPos = cur > 0 ? cur - 1 : loop === 'loop' ? len - 1 : -1
        const pf = prevPos >= 0 ? frames[sequence[prevPos]] : undefined
        if (pf) {
          ctx.globalAlpha = 0.28
          const o = frameOrigin(pf, box)
          drawFrame(ctx, img, pf, o.x, o.y)
          ctx.globalAlpha = 1
        }
      }
      const f = frames[sequence[cur]]
      if (f) {
        const o = frameOrigin(f, box)
        drawFrame(ctx, img, f, o.x, o.y)
      }
    }
    if (guides) {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      const ax = ox + Math.floor(box.w / 2) * scale + 0.5
      const gy = oy + box.h * scale + 0.5
      ctx.lineWidth = 1
      ctx.strokeStyle = 'rgba(255, 59, 48, .85)'
      ctx.setLineDash([4, 3])
      ctx.beginPath()
      ctx.moveTo(ax, oy)
      ctx.lineTo(ax, gy)
      ctx.stroke()
      ctx.setLineDash([])
      ctx.strokeStyle = 'rgba(52, 199, 89, .9)'
      ctx.beginPath()
      ctx.moveTo(0, gy)
      ctx.lineTo(size.w, gy)
      ctx.stroke()
      ctx.strokeStyle = 'rgba(0, 113, 227, .5)'
      ctx.strokeRect(ox + 0.5, oy + 0.5, box.w * scale - 1, box.h * scale - 1)
    }
  }, [img, frames, sequence, cur, size.w, size.h, scale, box.w, box.h, onion, guides, len, loop])

  const togglePlay = (): void => {
    if (!playing && loop === 'once' && cur >= len - 1) setPos(0)
    setPlaying(!playing)
  }

  const stepBy = (d: number): void => {
    if (!len) return
    setPlaying(false)
    setPos((p) => (Math.min(p, len - 1) + d + len) % len)
  }

  const onKey = (e: KeyboardEvent): void => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return
    if (e.code === 'Space') {
      e.preventDefault()
      togglePlay()
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault()
      stepBy(-1)
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      stepBy(1)
    }
  }

  return (
    <div className="spr-player" tabIndex={0} onKeyDown={onKey} aria-label={t('player.label')}>
      <div ref={stageRef} className={`spr-stage bg-${bg}`} style={{ height }}>
        <canvas ref={canvasRef} style={{ width: size.w, height: size.h }} />
        {!len && <div className="spr-stage-empty">{t('player.noFrames')}</div>}
        <span className="spr-stage-info mono">
          {len ? `${cur + 1}/${len}` : '0/0'} · {box.w}×{box.h} · {zoom === 0 ? t('player.fit') : `${zoom}×`}
        </span>
      </div>
      <div className="spr-bar">
        <button type="button" className="btn sm ghost icon" title={t('player.prev')} onClick={() => stepBy(-1)} disabled={len < 2}>
          <Icon name="left" size={14} />
        </button>
        <button type="button" className="btn sm" title={t('player.playHint')} onClick={() => togglePlay()} disabled={len < 2}>
          <Icon name={playing ? 'pause' : 'play'} size={13} />
          {playing ? t('player.pause') : t('player.play')}
        </button>
        <button type="button" className="btn sm ghost icon" title={t('player.next')} onClick={() => stepBy(1)} disabled={len < 2}>
          <Icon name="right" size={14} />
        </button>
        <label className="spr-num" title={t('player.fps')}>
          <span>FPS</span>
          <input type="number" className="inp" min={1} max={60} value={fps} onChange={(e) => setFps(Math.max(1, Math.min(60, Number(e.target.value) || 1)))} />
        </label>
        <select className="inp spr-sel" value={loop} onChange={(e) => setLoop(e.target.value as LoopMode)} aria-label={t('player.loop')}>
          {LOOPS.map((l) => (
            <option key={l} value={l}>
              {t(`loop.${l}`)}
            </option>
          ))}
        </select>
        <span className="grow" />
        <button type="button" className={onion ? 'btn sm tog on' : 'btn sm tog'} aria-pressed={onion} title={t('player.onionHint')} onClick={() => setOnion((v) => !v)}>
          {t('player.onion')}
        </button>
        <button type="button" className={guides ? 'btn sm tog on' : 'btn sm tog'} aria-pressed={guides} title={t('player.guidesHint')} onClick={() => setGuides((v) => !v)}>
          {t('player.guides')}
        </button>
        <select className="inp spr-sel" value={bg} onChange={(e) => setBg(e.target.value as StageBg)} aria-label={t('player.bg')}>
          <option value="ck">{t('bg.ck')}</option>
          <option value="dark">{t('bg.dark')}</option>
          <option value="light">{t('bg.light')}</option>
        </select>
        <select className="inp spr-sel" value={zoom} onChange={(e) => setZoom(Number(e.target.value) as (typeof ZOOMS)[number])} aria-label={t('player.zoom')}>
          {ZOOMS.map((z) => (
            <option key={z} value={z}>
              {z === 0 ? t('player.fit') : `${z}×`}
            </option>
          ))}
        </select>
      </div>
    </div>
  )
}
