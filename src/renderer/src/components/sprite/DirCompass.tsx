import { useRef, type KeyboardEvent, type ReactElement } from 'react'
import { DIR_ANGLE, type DirSet, type Direction } from '@shared/sprite'
import { KEY_VEC, heldVector, setDirs, vectorToDir } from './draw'
import { useSpriteT } from './useSpriteT'
import '@renderer/styles/sprite.css'

export interface DirCompassProps {
  dirSet: DirSet
  available: Direction[]
  value: Direction | null
  onChange: (dir: Direction) => void
  size?: number
}

export function DirCompass({ dirSet, available, value, onChange, size = 132 }: DirCompassProps): ReactElement {
  const t = useSpriteT()
  const held = useRef(new Set<string>())
  const dirs = setDirs(dirSet)
  const r = size / 2 - 17

  const onKeyDown = (e: KeyboardEvent): void => {
    if (!KEY_VEC[e.code]) return
    e.preventDefault()
    held.current.add(e.code)
    const [x, y] = heldVector(held.current)
    const d = vectorToDir(x, y, dirSet)
    if (d && d !== value) onChange(d)
  }

  const onKeyUp = (e: KeyboardEvent): void => {
    held.current.delete(e.code)
  }

  if (!dirs.length) {
    return (
      <div className="spr-compass none" style={{ width: size, height: size }}>
        <span>{t('compass.none')}</span>
      </div>
    )
  }

  return (
    <div
      className="spr-compass"
      role="radiogroup"
      aria-label={t('compass.label')}
      tabIndex={0}
      title={t('compass.hint')}
      style={{ width: size, height: size }}
      onKeyDown={onKeyDown}
      onKeyUp={onKeyUp}
      onBlur={() => held.current.clear()}
    >
      <span className="spr-compass-ring" />
      {value && (
        <span className="spr-compass-needle" style={{ width: r - 10, transform: `rotate(${DIR_ANGLE[value]}deg)` }} />
      )}
      <span className="spr-compass-hub mono">{value ?? '·'}</span>
      {dirs.map((d) => {
        const a = (DIR_ANGLE[d] * Math.PI) / 180
        const has = available.includes(d)
        const on = value === d
        return (
          <button
            key={d}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={-1}
            className={['spr-dir', on && 'on', !has && 'off'].filter(Boolean).join(' ')}
            title={has ? t(`dir.${d}`) : t('compass.missing', { dir: t(`dir.${d}`) })}
            style={{ left: size / 2 + Math.cos(a) * r, top: size / 2 + Math.sin(a) * r }}
            onClick={() => onChange(d)}
          >
            {d}
          </button>
        )
      })}
    </div>
  )
}
