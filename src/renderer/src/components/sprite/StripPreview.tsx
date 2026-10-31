import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { stripFrames, type FrameSize } from '@shared/sprite'
import { drawFrame, frameBox, frameOrigin, useImage } from './draw'
import '@renderer/styles/sprite.css'

export function useClock(count: number, fps: number, playing: boolean): [number, (n: number) => void] {
  const [pos, setPos] = useState(0)
  useEffect(() => {
    if (!playing || count <= 1) return
    const id = setInterval(() => setPos((p) => (p + 1) % count), 1000 / Math.max(1, Math.min(60, fps)))
    return () => clearInterval(id)
  }, [count, fps, playing])
  useEffect(() => {
    if (pos >= count) setPos(0)
  }, [count, pos])
  return [count ? pos % count : 0, setPos]
}

export interface StripPreviewProps {
  url: string | null
  sizes: FrameSize[]
  pos: number
  flipX?: boolean
  size?: number
  zoom?: number
  ghost?: { url: string | null; flipX?: boolean } | null
  guides?: boolean
  className?: string
}

export function StripPreview({ url, sizes, pos, flipX = false, size = 96, zoom, ghost, guides = false, className }: StripPreviewProps): ReactElement {
  const img = useImage(url)
  const ghostImg = useImage(ghost?.url ?? null)
  const ref = useRef<HTMLCanvasElement>(null)
  const frames = useMemo(() => stripFrames(sizes), [sizes])
  const seq = useMemo(() => frames.map((_, i) => i), [frames])
  const box = useMemo(() => frameBox(frames, seq), [frames, seq])
  const scale = zoom ?? Math.max(0.1, Math.min(size / box.w, size / box.h))
  const w = Math.max(1, Math.round(box.w * scale))
  const h = Math.max(1, Math.round(box.h * scale))

  useEffect(() => {
    const c = ref.current
    if (!c) return
    const dpr = window.devicePixelRatio || 1
    c.width = Math.round(w * dpr)
    c.height = Math.round(h * dpr)
    const ctx = c.getContext('2d')
    if (!ctx) return
    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, c.width, c.height)
    ctx.imageSmoothingEnabled = scale < 1
    ctx.scale(dpr * scale, dpr * scale)
    const f = frames[pos]
    if (!f) return
    const o = frameOrigin(f, box)
    const paint = (im: HTMLImageElement, flip: boolean, alpha: number): void => {
      ctx.save()
      ctx.globalAlpha = alpha
      if (flip) {
        ctx.translate(box.w, 0)
        ctx.scale(-1, 1)
      }
      drawFrame(ctx, im, f, o.x, o.y)
      ctx.restore()
    }
    if (ghostImg) paint(ghostImg, !!ghost?.flipX, 0.35)
    if (img) paint(img, flipX, 1)
    if (guides) {
      ctx.save()
      ctx.strokeStyle = 'rgba(255,59,48,.7)'
      ctx.lineWidth = 1 / scale
      ctx.beginPath()
      ctx.moveTo(box.w / 2, 0)
      ctx.lineTo(box.w / 2, box.h)
      ctx.moveTo(0, box.h - 0.5 / scale)
      ctx.lineTo(box.w, box.h - 0.5 / scale)
      ctx.stroke()
      ctx.restore()
    }
  }, [img, ghostImg, ghost?.flipX, frames, pos, box, w, h, scale, flipX, guides])

  return <canvas ref={ref} className={className ? `strip-pv ${className}` : 'strip-pv'} style={{ width: w, height: h }} />
}
