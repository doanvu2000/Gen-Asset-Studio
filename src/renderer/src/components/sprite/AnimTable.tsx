import { useState, type ReactElement } from 'react'
import type { DirSet, Direction, LoopMode, SpriteAnim } from '@shared/sprite'
import { Icon } from '../Icon'
import { setDirs } from './draw'
import { useSpriteT } from './useSpriteT'
import '@renderer/styles/sprite.css'

export interface AnimTableProps {
  anims: SpriteAnim[]
  dirSet: DirSet
  selected: string | null
  onSelect: (id: string) => void
  onChange: (anims: SpriteAnim[]) => void
  onAuto: () => void
  busy?: boolean
}

const LOOPS: LoopMode[] = ['loop', 'pingpong', 'once']

function NameCell({ value, onCommit }: { value: string; onCommit: (v: string) => void }): ReactElement {
  const [v, setV] = useState(value)
  const [last, setLast] = useState(value)
  if (value !== last) {
    setLast(value)
    setV(value)
  }
  const commit = (): void => {
    const n = v.trim().slice(0, 64)
    if (n && n !== value) onCommit(n)
    else setV(value)
  }
  return (
    <input
      className="inp sm"
      value={v}
      maxLength={64}
      spellCheck={false}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setV(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
        if (e.key === 'Escape') setV(value)
      }}
    />
  )
}

export function AnimTable({ anims, dirSet, selected, onSelect, onChange, onAuto, busy = false }: AnimTableProps): ReactElement {
  const t = useSpriteT()
  const dirs = setDirs(dirSet)
  const patch = (id: string, p: Partial<SpriteAnim>): void => onChange(anims.map((a) => (a.id === id ? { ...a, ...p } : a)))

  return (
    <div className="spr-anims">
      <div className="spr-anims-head">
        <b>{t('anims.title')}</b>
        <span className="muted">{t('anims.count', { count: anims.length })}</span>
        <span className="grow" />
        <button type="button" className="btn sm" disabled={busy} onClick={onAuto} title={t('anims.autoHint')}>
          <Icon name="refresh" size={13} />
          {t('anims.auto')}
        </button>
      </div>
      {anims.length ? (
        <div className="spr-anims-scroll">
          <table className="spr-table">
            <thead>
              <tr>
                <th>{t('anims.name')}</th>
                <th>{t('anims.dir')}</th>
                <th className="num">{t('anims.frames')}</th>
                <th className="num">FPS</th>
                <th>{t('anims.loop')}</th>
              </tr>
            </thead>
            <tbody>
              {anims.map((a) => (
                <tr key={a.id} className={selected === a.id ? 'on' : undefined} onClick={() => onSelect(a.id)} aria-selected={selected === a.id}>
                  <td>
                    <NameCell value={a.name} onCommit={(name) => patch(a.id, { name })} />
                  </td>
                  <td>
                    <select
                      className="inp sm"
                      value={a.dir ?? ''}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => patch(a.id, { dir: (e.target.value || null) as Direction | null })}
                    >
                      <option value="">—</option>
                      {(a.dir && !dirs.includes(a.dir) ? [...dirs, a.dir] : dirs).map((d) => (
                        <option key={d} value={d}>
                          {d} · {t(`dir.${d}`)}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num mono">{a.frames.length}</td>
                  <td className="num">
                    <input
                      className="inp sm mono fps"
                      type="number"
                      min={1}
                      max={60}
                      value={a.fps}
                      onClick={(e) => e.stopPropagation()}
                      onChange={(e) => patch(a.id, { fps: Math.max(1, Math.min(60, Math.round(Number(e.target.value)) || 1)) })}
                    />
                  </td>
                  <td>
                    <select className="inp sm" value={a.loop} onClick={(e) => e.stopPropagation()} onChange={(e) => patch(a.id, { loop: e.target.value as LoopMode })}>
                      {LOOPS.map((l) => (
                        <option key={l} value={l}>
                          {t(`loop.${l}`)}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="spr-anims-empty muted">{t('anims.empty')}</div>
      )}
    </div>
  )
}
