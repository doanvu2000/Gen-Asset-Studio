import { useEffect, useState } from 'react'
import { DIRECTIONS, DIR_ANGLE, type DirSet, type Direction, type FrameRect, type SpriteAnim } from '@shared/sprite'

export function useImage(url: string | null): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!url) {
      setImg(null)
      return
    }
    let live = true
    const el = new Image()
    el.decoding = 'async'
    el.onload = () => {
      if (live) setImg(el)
    }
    el.onerror = () => {
      if (live) setImg(null)
    }
    el.src = url
    return () => {
      live = false
    }
  }, [url])
  return img
}

export function drawFrame(ctx: CanvasRenderingContext2D, img: HTMLImageElement, f: FrameRect, dx: number, dy: number): void {
  if (f.w <= 0 || f.h <= 0) return
  if (f.rotated) {
    ctx.save()
    ctx.translate(dx + f.srcX, dy + f.srcY + f.w)
    ctx.rotate(-Math.PI / 2)
    ctx.drawImage(img, f.x, f.y, f.w, f.h, 0, 0, f.w, f.h)
    ctx.restore()
    return
  }
  ctx.drawImage(img, f.x, f.y, f.w, f.h, dx + f.srcX, dy + f.srcY, f.w, f.h)
}

export function frameBox(frames: FrameRect[], sequence: number[]): { w: number; h: number } {
  let w = 1
  let h = 1
  for (const i of sequence) {
    const f = frames[i]
    if (!f) continue
    w = Math.max(w, f.srcW || f.w)
    h = Math.max(h, f.srcH || f.h)
  }
  return { w, h }
}

export function frameOrigin(f: FrameRect, box: { w: number; h: number }): { x: number; y: number } {
  const sw = f.srcW || f.w
  const sh = f.srcH || f.h
  return { x: Math.floor((box.w - sw) / 2), y: box.h - sh }
}

export function nextIndex(pos: number, len: number, loop: 'loop' | 'pingpong' | 'once', dir: 1 | -1): { pos: number; dir: 1 | -1; done: boolean } {
  if (len <= 1) return { pos: 0, dir, done: loop === 'once' }
  if (loop === 'loop') return { pos: (pos + 1) % len, dir, done: false }
  if (loop === 'once') return pos + 1 >= len ? { pos: len - 1, dir, done: true } : { pos: pos + 1, dir, done: false }
  let d = dir
  let p = pos + d
  if (p >= len || p < 0) {
    d = (d === 1 ? -1 : 1) as 1 | -1
    p = pos + d
  }
  return { pos: p, dir: d, done: false }
}

export function setDirs(dirSet: DirSet): Direction[] {
  return dirSet === 0 ? [] : DIRECTIONS[dirSet]
}

export function vectorToDir(dx: number, dy: number, dirSet: DirSet): Direction | null {
  if ((!dx && !dy) || dirSet === 0) return null
  const a = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360
  let best: Direction | null = null
  let bestD = Infinity
  for (const d of DIRECTIONS[dirSet]) {
    const diff = Math.abs(((DIR_ANGLE[d] - a + 540) % 360) - 180)
    if (diff < bestD - 0.001) {
      bestD = diff
      best = d
    }
  }
  return best
}

export const KEY_VEC: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  KeyW: [0, -1],
  KeyS: [0, 1],
  KeyA: [-1, 0],
  KeyD: [1, 0]
}

export function heldVector(keys: Set<string>): [number, number] {
  let x = 0
  let y = 0
  for (const k of keys) {
    const v = KEY_VEC[k]
    if (v) {
      x += v[0]
      y += v[1]
    }
  }
  return [Math.sign(x), Math.sign(y)]
}

export function findAnim(anims: SpriteAnim[], kind: 'walk' | 'idle', dir: Direction | null): SpriteAnim | null {
  const named = anims.filter((a) => a.name.toLowerCase().includes(kind) && a.frames.length)
  return named.find((a) => a.dir === dir) ?? named.find((a) => a.dir === null) ?? null
}
