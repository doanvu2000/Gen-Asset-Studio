import { useCallback, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { RECOLOR_DEFAULT, isRecolorIdentity, recolorPixels, rgbHue, type RecolorParams } from '@shared/recolor'
import { Icon } from './Icon'

const MAX_W = 300
const MAX_H = 180

interface Props {
  url: string | null
  disabled?: boolean
  onSave: (params: RecolorParams) => Promise<boolean>
}

export function RecolorPanel({ url, disabled, onSave }: Props): ReactElement {
  const { t } = useTranslation()
  const [p, setP] = useState<RecolorParams>(RECOLOR_DEFAULT)
  const [picking, setPicking] = useState(false)
  const [swatch, setSwatch] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [ready, setReady] = useState(false)
  const canvas = useRef<HTMLCanvasElement>(null)
  const orig = useRef<ImageData | null>(null)

  useEffect(() => {
    let alive = true
    setP(RECOLOR_DEFAULT)
    setSwatch(null)
    setPicking(false)
    setReady(false)
    orig.current = null
    if (!url) return
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      if (!alive || !canvas.current) return
      const k = Math.min(1, MAX_W / img.naturalWidth, MAX_H / img.naturalHeight)
      const w = Math.max(1, Math.round(img.naturalWidth * k))
      const h = Math.max(1, Math.round(img.naturalHeight * k))
      const c = canvas.current
      c.width = w
      c.height = h
      const ctx = c.getContext('2d', { willReadFrequently: true })
      if (!ctx) return
      ctx.drawImage(img, 0, 0, w, h)
      try {
        orig.current = ctx.getImageData(0, 0, w, h)
        setReady(true)
      } catch {
        orig.current = null
      }
    }
    img.src = url
    return () => {
      alive = false
    }
  }, [url])

  useEffect(() => {
    const o = orig.current
    const c = canvas.current
    if (!o || !c) return
    const next = new ImageData(new Uint8ClampedArray(o.data), o.width, o.height)
    recolorPixels(next.data, p)
    c.getContext('2d')?.putImageData(next, 0, 0)
  }, [p, ready])

  const pick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const o = orig.current
      if (!picking || !o) return
      const r = e.currentTarget.getBoundingClientRect()
      const x = Math.min(o.width - 1, Math.max(0, Math.floor(((e.clientX - r.left) / r.width) * o.width)))
      const y = Math.min(o.height - 1, Math.max(0, Math.floor(((e.clientY - r.top) / r.height) * o.height)))
      const i = (y * o.width + x) * 4
      if (o.data[i + 3] === 0) return
      const { h } = rgbHue(o.data[i], o.data[i + 1], o.data[i + 2])
      setSwatch(`rgb(${o.data[i]}, ${o.data[i + 1]}, ${o.data[i + 2]})`)
      setP((cur) => ({ ...cur, region: { hue: Math.round(h), range: cur.region?.range ?? 30 } }))
      setPicking(false)
    },
    [picking]
  )

  const save = async (): Promise<void> => {
    if (saving || isRecolorIdentity(p)) return
    setSaving(true)
    try {
      if (await onSave(p)) setP(RECOLOR_DEFAULT)
    } finally {
      setSaving(false)
    }
  }

  const slider = (key: 'hue' | 'sat' | 'bright', min: number, max: number, unit: string): ReactElement => (
    <label className="rc-row">
      <span>{t(`recolor.${key}`)}</span>
      <input type="range" min={min} max={max} value={p[key]} onChange={(e) => setP({ ...p, [key]: Number(e.target.value) })} />
      <output>
        {p[key]}
        {unit}
      </output>
    </label>
  )

  const changed = !isRecolorIdentity(p)
  return (
    <div className="rc">
      <canvas ref={canvas} className={picking ? 'rc-cv pick ck' : 'rc-cv ck'} onClick={pick} />
      {url && !ready && <p className="muted rv-small">{t('recolor.noPreview')}</p>}
      {slider('hue', -180, 180, '°')}
      {slider('sat', 0, 200, '%')}
      {slider('bright', 50, 150, '%')}
      <div className="rc-row">
        <button type="button" className={picking ? 'btn sm primary' : 'btn sm'} disabled={!ready} aria-pressed={picking} onClick={() => setPicking(!picking)}>
          <Icon name="wand" size={13} />
          {picking ? t('recolor.picking') : t('recolor.pick')}
        </button>
        {p.region && (
          <>
            {swatch && <i className="rc-sw" style={{ background: swatch }} />}
            <button type="button" className="btn ghost sm" onClick={() => { setP({ ...p, region: null }); setSwatch(null) }}>
              {t('recolor.allColors')}
            </button>
          </>
        )}
      </div>
      {p.region && (
        <label className="rc-row">
          <span>{t('recolor.range')}</span>
          <input type="range" min={5} max={90} value={p.region.range} onChange={(e) => setP({ ...p, region: { hue: p.region?.hue ?? 0, range: Number(e.target.value) } })} />
          <output>±{p.region.range}°</output>
        </label>
      )}
      <p className="muted rv-small">{t('recolor.hint')}</p>
      <div className="rc-row">
        <button type="button" className="btn ghost sm" disabled={!changed && !p.region} onClick={() => { setP(RECOLOR_DEFAULT); setSwatch(null) }}>
          {t('recolor.reset')}
        </button>
        <button type="button" className="btn primary sm grow" disabled={!changed || saving || disabled || !url} onClick={() => void save()}>
          {saving ? <span className="spin xs" /> : <Icon name="layers" size={13} />}
          {t('recolor.save')}
        </button>
      </div>
    </div>
  )
}
