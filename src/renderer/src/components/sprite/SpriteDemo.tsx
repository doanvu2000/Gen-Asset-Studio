import { useEffect, useMemo, useState, type ReactElement } from 'react'
import type { Direction, SheetPatch, SheetView, SpriteSettings } from '@shared/sprite'
import { Segmented } from '../Segmented'
import { Icon } from '../Icon'
import { SheetCanvas } from './SheetCanvas'
import { GridEditor } from './GridEditor'
import { AnimTable } from './AnimTable'
import { SpritePlayer } from './SpritePlayer'
import { DirCompass } from './DirCompass'
import { SpritePlayground } from './SpritePlayground'
import { useSpriteT } from './useSpriteT'
import '@renderer/styles/sprite.css'

export interface SpriteDemoProps {
  sheet: SheetView
  settings: SpriteSettings
  onUpdate: (patch: SheetPatch) => void
  onDetect: () => void
  busy?: boolean
}

type Pane = 'player' | 'walk'

function baseName(name: string): string {
  return name.replace(/[\s_.-]*(s|sw|w|nw|n|ne|e|se|south|north|east|west|down|up|left|right)$/i, '').toLowerCase()
}

export function SpriteDemo({ sheet, settings, onUpdate, onDetect, busy = false }: SpriteDemoProps): ReactElement {
  const t = useSpriteT()
  const [sel, setSel] = useState<string | null>(sheet.anims[0]?.id ?? null)
  const [pane, setPane] = useState<Pane>('player')
  const [pick, setPick] = useState<number | null>(null)

  useEffect(() => {
    if (!sel || !sheet.anims.some((a) => a.id === sel)) setSel(sheet.anims[0]?.id ?? null)
  }, [sheet.anims, sel])

  const anim = sheet.anims.find((a) => a.id === sel) ?? null
  const available = useMemo(() => [...new Set(sheet.anims.filter((a) => a.dir && a.frames.length).map((a) => a.dir as Direction))], [sheet.anims])
  const sequence = anim ? anim.frames : pick !== null ? [pick] : []

  const onDir = (d: Direction): void => {
    const base = anim ? baseName(anim.name) : ''
    const same = sheet.anims.filter((a) => a.dir === d)
    const next = same.find((a) => baseName(a.name) === base) ?? same[0]
    if (next) setSel(next.id)
  }

  const onPickFrame = (i: number): void => {
    setPick(i)
    const owner = sheet.anims.find((a) => a.frames.includes(i))
    if (owner) setSel(owner.id)
  }

  return (
    <div className="spr-demo">
      <section className="spr-demo-sheet">
        <div className="spr-demo-sheet-head">
          <b className="ellipsis" title={sheet.path}>
            {sheet.name}
          </b>
          <span className="chip c-gray">{t(`format.${sheet.format}`)}</span>
          <span className="muted mono">
            {sheet.w}×{sheet.h} · {t('sheet.frames', { count: sheet.frames.length })}
            {sheet.empty.length ? ` · ${t('sheet.empty', { count: sheet.empty.length })}` : ''}
          </span>
        </div>
        <SheetCanvas
          url={sheet.url}
          imageW={sheet.w}
          imageH={sheet.h}
          frames={sheet.frames}
          empty={sheet.empty}
          highlight={anim?.frames ?? []}
          selected={pick}
          onPick={onPickFrame}
          grid={sheet.grid}
          onGrid={sheet.grid ? (grid) => onUpdate({ grid }) : undefined}
          height={420}
        />
        {sheet.grid && <GridEditor grid={sheet.grid} imageW={sheet.w} imageH={sheet.h} onChange={(grid) => onUpdate({ grid })} onDetect={onDetect} busy={busy} />}
        {sheet.warnings.length > 0 && (
          <div className="note warn">
            <Icon name="alert" size={14} />
            <span>{sheet.warnings.join(' · ')}</span>
          </div>
        )}
      </section>
      <section className="spr-demo-side">
        <div className="spr-demo-side-head">
          <Segmented<Pane>
            value={pane}
            ariaLabel={t('demo.pane')}
            options={[
              { value: 'player', label: t('demo.player') },
              { value: 'walk', label: t('demo.walk') }
            ]}
            onChange={setPane}
          />
          <span className="grow" />
          {anim && (
            <span className="chip c-blue">
              {anim.name}
              {anim.dir ? ` · ${anim.dir}` : ''}
            </span>
          )}
        </div>
        {pane === 'player' ? (
          <SpritePlayer url={sheet.url} frames={sheet.frames} sequence={sequence} fps={anim?.fps ?? 8} loop={anim?.loop ?? 'loop'} />
        ) : (
          <SpritePlayground url={sheet.url} frames={sheet.frames} anims={sheet.anims} dirSet={settings.dirSet} view={settings.view} height={300} />
        )}
        <div className="spr-demo-compass">
          <DirCompass dirSet={settings.dirSet} available={available} value={anim?.dir ?? null} onChange={onDir} />
          <div className="spr-demo-compass-t">
            <b>{t('compass.title')}</b>
            <span className="muted">{settings.dirSet ? t('compass.desc', { n: settings.dirSet }) : t('compass.none')}</span>
            {settings.dirSet > 0 && available.length < settings.dirSet && (
              <span className="muted">{t('compass.coverage', { have: available.length, n: settings.dirSet })}</span>
            )}
          </div>
        </div>
      </section>
      <section className="spr-demo-anims">
        <AnimTable anims={sheet.anims} dirSet={settings.dirSet} selected={sel} onSelect={setSel} onChange={(anims) => onUpdate({ anims })} onAuto={() => onUpdate({ autoAnims: true })} busy={busy} />
      </section>
    </div>
  )
}
