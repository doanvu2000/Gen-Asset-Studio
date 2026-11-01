import { BrowserWindow, Notification, nativeImage, type NativeImage } from 'electron'
import type { Lang } from '@shared/types'
import type { QueueSnapshot } from '@shared/queue'
import { BatchTracker } from './queueBatch'

const TEXT = {
  vi: {
    title: 'Gen Asset Studio',
    done: (n: number, m: number) => `Đã gen xong ${n} · lỗi ${m}`,
    overlay: (m: number) => `${m} job gen lỗi`
  },
  en: {
    title: 'Gen Asset Studio',
    done: (n: number, m: number) => `Generated ${n} · failed ${m}`,
    overlay: (m: number) => `${m} generation job(s) failed`
  }
}

export interface QueueNotifierDeps {
  queue: { on(ev: 'snapshot', fn: (s: QueueSnapshot) => void): unknown; snapshot(): QueueSnapshot }
  getWindow: () => BrowserWindow | null
  enabled: () => boolean
  lang: () => Lang
}

let dotIcon: NativeImage | null = null
// Windows drops click handlers if the Notification is garbage collected first.
const live = new Set<Notification>()

// Generated at runtime to avoid shipping a binary asset; createFromBitmap expects BGRA.
function errorDot(): NativeImage {
  if (dotIcon) return dotIcon
  const size = 16
  const buf = Buffer.alloc(size * size * 4)
  const c = (size - 1) / 2
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if ((x - c) ** 2 + (y - c) ** 2 > 7.2 ** 2) continue
      const o = (y * size + x) * 4
      buf[o] = 0x26
      buf[o + 1] = 0x26
      buf[o + 2] = 0xdc
      buf[o + 3] = 0xff
    }
  }
  dotIcon = nativeImage.createFromBitmap(buf, { width: size, height: size })
  return dotIcon
}

export function attachQueueNotifier(d: QueueNotifierDeps): void {
  const tracker = new BatchTracker()
  const alive = (): BrowserWindow | null => {
    const w = d.getWindow()
    return w && !w.isDestroyed() ? w : null
  }

  const clearAttention = (w: BrowserWindow): void => {
    w.flashFrame(false)
    w.setOverlayIcon(null, '')
  }

  const wired = new WeakSet<BrowserWindow>()
  const wire = (w: BrowserWindow): void => {
    if (wired.has(w)) return
    wired.add(w)
    w.on('focus', () => clearAttention(w))
  }

  d.queue.on('snapshot', (snap) => {
    const w = alive()
    const { state, ended } = tracker.update(snap.jobs)
    if (!w) return
    wire(w)
    if (state) {
      w.setProgressBar((state.done + state.failed) / state.total, { mode: snap.paused ? 'paused' : 'normal' })
      return
    }
    w.setProgressBar(-1)
    if (!ended || !d.enabled() || w.isFocused()) return
    const tx = TEXT[d.lang() === 'en' ? 'en' : 'vi']
    w.flashFrame(true)
    if (ended.failed > 0) w.setOverlayIcon(errorDot(), tx.overlay(ended.failed))
    if (Notification.isSupported()) {
      const n = new Notification({ title: tx.title, body: tx.done(ended.done, ended.failed) })
      n.on('click', () => {
        live.delete(n)
        if (w.isDestroyed()) return
        if (w.isMinimized()) w.restore()
        w.show()
        w.focus()
      })
      live.add(n)
      n.on('close', () => live.delete(n))
      n.show()
    }
  })
}
