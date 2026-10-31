import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Physics, SpinePlayer, type SpinePlayerConfig } from '@esotericsoftware/spine-player'
import '@esotericsoftware/spine-player/dist/spine-player.css'
import type { SpineAssets } from '@shared/spine'
import { Icon } from '@renderer/components/Icon'

export type SpineBg = 'ck' | 'dark' | 'light'

export interface SpineInfo {
  animations: string[]
  skins: string[]
  durations: Record<string, number>
}

function b64(text: string): string {
  const bytes = new TextEncoder().encode(text)
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

export function rawUris(a: SpineAssets): Record<string, string> {
  const out: Record<string, string> = {
    [a.skeletonName]: `data:application/json;base64,${b64(a.json)}`,
    [a.atlasName]: `data:text/plain;base64,${b64(a.atlas)}`
  }
  const dir = a.atlasName.includes('/') ? a.atlasName.slice(0, a.atlasName.lastIndexOf('/') + 1) : ''
  for (const [name, uri] of Object.entries(a.pages)) {
    out[name] = uri
    if (dir) out[dir + name] = uri
  }
  return out
}

interface Props {
  assets: SpineAssets | null
  animation: string
  skin: string
  time: number
  showBones?: boolean
  highlightSlots?: string[]
  background?: SpineBg
  height?: number
  label?: string
  onReady?: (info: SpineInfo) => void
  onError?: (msg: string) => void
  onPlayer?: (player: SpinePlayer | null) => void
}

type Loose = { config?: { debug?: { bones: boolean } } }

export function SpinePreview({ assets, animation, skin, time, showBones = false, highlightSlots, background = 'ck', height = 320, label, onReady, onError, onPlayer }: Props): ReactElement {
  const { t } = useTranslation()
  const host = useRef<HTMLDivElement>(null)
  const live = useRef({ animation, skin, time, showBones, hl: new Set(highlightSlots ?? []), curAnim: '', curSkin: '' })
  const cbs = useRef({ onReady, onError, onPlayer })
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [err, setErr] = useState('')

  live.current.animation = animation
  live.current.skin = skin
  live.current.time = time
  live.current.showBones = showBones
  live.current.hl = new Set(highlightSlots ?? [])
  cbs.current = { onReady, onError, onPlayer }

  useEffect(() => {
    const el = host.current
    if (!el || !assets) return
    setState('loading')
    setErr('')
    const box = document.createElement('div')
    box.className = 'spv-player'
    el.appendChild(box)
    live.current.curAnim = ''
    live.current.curSkin = ''
    let player: SpinePlayer | null = null
    let disposed = false
    try {
      const config: SpinePlayerConfig = {
        skeleton: assets.skeletonName,
        atlas: assets.atlasName,
        rawDataURIs: rawUris(assets),
        showControls: false,
        showLoading: false,
        premultipliedAlpha: false,
        alpha: true,
        backgroundColor: '#00000000',
        preserveDrawingBuffer: false,
        interactive: false,
        viewport: { padLeft: '8%', padRight: '8%', padTop: '8%', padBottom: '8%', transitionTime: 0 },
        success: (p) => {
          if (disposed) return
          p.pause()
          const data = p.skeleton?.data
          const info: SpineInfo = {
            animations: data?.animations.map((a) => a.name) ?? [],
            skins: data?.skins.map((s) => s.name) ?? [],
            durations: Object.fromEntries((data?.animations ?? []).map((a) => [a.name, a.duration]))
          }
          setState('ready')
          cbs.current.onPlayer?.(p)
          cbs.current.onReady?.(info)
        },
        error: (_p, msg) => {
          if (disposed) return
          setState('error')
          setErr(msg)
          cbs.current.onError?.(msg)
        },
        update: (p) => {
          const sk = p.skeleton
          const st = p.animationState
          if (!sk || !st) return
          const L = live.current
          const data = sk.data
          if (L.skin !== L.curSkin) {
            L.curSkin = L.skin
            if (L.skin && data.findSkin(L.skin)) {
              sk.setSkinByName(L.skin)
              sk.setSlotsToSetupPose()
            }
          }
          if (L.animation !== L.curAnim) {
            L.curAnim = L.animation
            if (L.animation && data.findAnimation(L.animation)) p.setAnimation(L.animation, true)
            else st.clearTracks()
          }
          sk.setToSetupPose()
          const e = st.getCurrent(0)
          if (e) {
            const d = e.animation?.duration ?? 0
            e.trackTime = d > 0 ? L.time % d : 0
            st.apply(sk)
          }
          sk.updateWorldTransform(Physics.update)
          for (const slot of sk.slots) {
            if (L.hl.has(slot.data.name)) slot.color.set(1, 0.35, 0.9, 1)
            else slot.color.setFromColor(slot.data.color)
          }
          const cfg = (p as unknown as Loose).config
          if (cfg?.debug) cfg.debug.bones = L.showBones
        }
      }
      player = new SpinePlayer(box, config)
    } catch (e) {
      setState('error')
      setErr((e as Error).message)
    }
    return () => {
      disposed = true
      cbs.current.onPlayer?.(null)
      try {
        player?.dispose()
      } catch {
        return
      } finally {
        box.remove()
      }
    }
  }, [assets])

  return (
    <div className={`spv spv-${background}`} style={{ height }}>
      <div className="spv-host" ref={host} />
      {label && <span className="spv-label">{label}</span>}
      {!assets || state === 'loading' ? (
        <div className="spv-state">
          <span className="spin" />
        </div>
      ) : state === 'error' ? (
        <div className="spv-state err" title={err}>
          <Icon name="alert" size={18} />
          <span>{t('spineProject.preview.error')}</span>
          <small>{err}</small>
        </div>
      ) : null}
    </div>
  )
}

export function useSpineClock(playing: boolean, speed: number): [number, (t: number) => void] {
  const [time, setTime] = useState(0)
  const ref = useRef(0)
  useEffect(() => {
    if (!playing) return
    let raf = 0
    let last = performance.now()
    const tick = (now: number): void => {
      ref.current += ((now - last) / 1000) * speed
      last = now
      setTime(ref.current)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, speed])
  return [
    time,
    (v: number) => {
      ref.current = v
      setTime(v)
    }
  ]
}

interface ControlsProps {
  info: SpineInfo | null
  animation: string
  skin: string
  playing: boolean
  speed: number
  time: number
  showBones: boolean
  background: SpineBg
  onAnimation: (a: string) => void
  onSkin: (s: string) => void
  onPlaying: (p: boolean) => void
  onSpeed: (s: number) => void
  onTime: (t: number) => void
  onBones: (b: boolean) => void
  onBackground: (b: SpineBg) => void
}

export function SpineControls(p: ControlsProps): ReactElement {
  const { t } = useTranslation()
  const dur = p.info?.durations[p.animation] ?? 0
  const pos = dur > 0 ? p.time % dur : 0
  return (
    <div className="spv-ctl">
      <select className="inp sm" value={p.animation} onChange={(e) => p.onAnimation(e.target.value)} aria-label={t('spineProject.preview.animation')}>
        <option value="">{t('spineProject.preview.setupPose')}</option>
        {p.info?.animations.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      {p.info && p.info.skins.length > 1 && (
        <select className="inp sm" value={p.skin} onChange={(e) => p.onSkin(e.target.value)} aria-label={t('spineProject.preview.skin')}>
          {p.info.skins.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
      )}
      <button type="button" className="btn sm" disabled={!p.animation} onClick={() => p.onPlaying(!p.playing)}>
        <Icon name={p.playing ? 'pause' : 'play'} size={13} />
      </button>
      <input
        className="spv-scrub"
        type="range"
        min={0}
        max={Math.max(0.001, dur)}
        step={0.001}
        value={pos}
        disabled={!p.animation || dur <= 0}
        onChange={(e) => {
          p.onPlaying(false)
          p.onTime(Number(e.target.value))
        }}
        aria-label={t('spineProject.preview.scrub')}
      />
      <span className="mono spv-t">
        {pos.toFixed(2)}/{dur.toFixed(2)}s
      </span>
      <select className="inp sm" value={p.speed} onChange={(e) => p.onSpeed(Number(e.target.value))} aria-label={t('spineProject.preview.speed')}>
        {[0.25, 0.5, 1, 1.5, 2].map((s) => (
          <option key={s} value={s}>
            {s}×
          </option>
        ))}
      </select>
      <button type="button" className={p.showBones ? 'btn sm on' : 'btn sm'} aria-pressed={p.showBones} onClick={() => p.onBones(!p.showBones)}>
        <Icon name="link" size={13} />
        {t('spineProject.preview.bones')}
      </button>
      <select className="inp sm" value={p.background} onChange={(e) => p.onBackground(e.target.value as SpineBg)} aria-label={t('spineProject.preview.bg')}>
        <option value="ck">{t('spineProject.preview.bgCk')}</option>
        <option value="light">{t('spineProject.preview.bgLight')}</option>
        <option value="dark">{t('spineProject.preview.bgDark')}</option>
      </select>
    </div>
  )
}

export interface ViewerState {
  info: SpineInfo | null
  setInfo: (i: SpineInfo) => void
  animation: string
  setAnimation: (a: string) => void
  skin: string
  setSkin: (s: string) => void
  playing: boolean
  setPlaying: (p: boolean) => void
  speed: number
  setSpeed: (s: number) => void
  time: number
  setTime: (t: number) => void
  bones: boolean
  setBones: (b: boolean) => void
  bg: SpineBg
  setBg: (b: SpineBg) => void
}

export function useViewer(): ViewerState {
  const [info, setInfoRaw] = useState<SpineInfo | null>(null)
  const [animation, setAnimation] = useState('')
  const [skin, setSkin] = useState('')
  const [playing, setPlaying] = useState(true)
  const [speed, setSpeed] = useState(1)
  const [bones, setBones] = useState(false)
  const [bg, setBg] = useState<SpineBg>('ck')
  const [time, setTime] = useSpineClock(playing && !!animation, speed)
  const setInfo = (i: SpineInfo): void => {
    setInfoRaw(i)
    setAnimation((cur) => (cur && i.animations.includes(cur) ? cur : (i.animations.find((a) => /idle/i.test(a)) ?? i.animations[0] ?? '')))
    setSkin((cur) => (cur && i.skins.includes(cur) ? cur : (i.skins.find((s) => s !== 'default') ?? i.skins[0] ?? '')))
  }
  return { info, setInfo, animation, setAnimation, skin, setSkin, playing, setPlaying, speed, setSpeed, time, setTime, bones, setBones, bg, setBg }
}

export function ViewerControls({ v }: { v: ViewerState }): ReactElement {
  return (
    <SpineControls
      info={v.info}
      animation={v.animation}
      skin={v.skin}
      playing={v.playing}
      speed={v.speed}
      time={v.time}
      showBones={v.bones}
      background={v.bg}
      onAnimation={v.setAnimation}
      onSkin={v.setSkin}
      onPlaying={v.setPlaying}
      onSpeed={v.setSpeed}
      onTime={v.setTime}
      onBones={v.setBones}
      onBackground={v.setBg}
    />
  )
}
