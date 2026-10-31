import { useEffect, useState, type DragEvent, type ReactElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import type { ProjectView } from '@shared/workspace'
import { DIRECTIONS, ROW_PRESETS, type DirSet, type RowPreset, type SheetView, type SpriteProjectView, type SpriteSettings, type ViewAngle } from '@shared/sprite'
import { Icon, type IconName } from '@renderer/components/Icon'
import { Segmented } from '@renderer/components/Segmented'
import { SpriteDemo } from '@renderer/components/sprite/SpriteDemo'
import { EASE, viewTransition } from '@renderer/lib/motion'
import { fileSize } from '@renderer/lib/format'
import { useSprite } from '@renderer/store/sprite'
import { useWs } from '@renderer/store/workspace'

const STEPS = ['sheets', 'grid', 'style', 'gen', 'review', 'export'] as const
type StepKey = (typeof STEPS)[number]
const STEP_ICON: Record<StepKey, IconName> = { sheets: 'upload', grid: 'grid', style: 'palette', gen: 'sparkles', review: 'eye', export: 'download' }

function canStep(v: SpriteProjectView, n: number): boolean {
  if (n === 1) return true
  if (n === 2) return v.sheets.length > 0
  return false
}

function StepBar({ v }: { v: SpriteProjectView }): ReactElement {
  const { t } = useTranslation()
  const step = useSprite((s) => s.step)
  const setStep = useSprite((s) => s.setStep)
  const frames = v.sheets.reduce((n, s) => n + s.frames.length - s.empty.length, 0)
  const anims = v.sheets.reduce((n, s) => n + s.anims.length, 0)
  const subs = [
    t('spriteProject.sub.sheets', { count: v.sheets.length }),
    t('spriteProject.sub.grid', { frames, anims }),
    t('spriteProject.sub.soon'),
    t('spriteProject.sub.soon'),
    t('spriteProject.sub.soon'),
    t('spriteProject.sub.soon')
  ]
  return (
    <div className="steps" role="tablist">
      {STEPS.map((key, i) => {
        const n = i + 1
        const locked = !canStep(v, n)
        const cur = step === n
        const done = n < step && !locked
        const cls = ['stp', cur && 'cur', done && !cur && 'done', locked && 'locked'].filter(Boolean).join(' ')
        return (
          <div className="stp-wrap" key={key}>
            {i > 0 && (
              <div className={n <= step ? 'stp-line done' : 'stp-line'}>
                <i />
              </div>
            )}
            <button
              type="button"
              className={cls}
              role="tab"
              aria-selected={cur}
              aria-disabled={locked || undefined}
              title={locked ? t(n === 2 ? 'spriteProject.lock.grid' : 'spriteProject.lock.soon') : undefined}
              onClick={() => !locked && setStep(n)}
            >
              <span className="num">{done && !cur ? <Icon name="check" size={13} /> : locked ? <Icon name="lock" size={12} /> : n}</span>
              <span>
                <b>{t(`spriteProject.steps.${key}`)}</b>
                <small>{subs[i]}</small>
              </span>
            </button>
          </div>
        )
      })}
    </div>
  )
}

function Intro({ step, n }: { step: StepKey; n: number }): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="step-intro k-sprite">
      <span className="si-ic">
        <Icon name={STEP_ICON[step]} size={16} />
      </span>
      <div className="si-t">
        <b>
          {t('intro.stepOf', { n, total: STEPS.length })} · {t(`spriteProject.steps.${step}`)}
        </b>
        <span>{t(`spriteProject.intro.${step}`)}</span>
      </div>
    </div>
  )
}

function useDrop(onPaths: (paths: string[]) => void): { over: boolean; bind: Record<string, (e: DragEvent) => void> } {
  const [over, setOver] = useState(false)
  return {
    over,
    bind: {
      onDragOver: (e: DragEvent) => {
        if (!e.dataTransfer.types.includes('Files')) return
        e.preventDefault()
        setOver(true)
      },
      onDragLeave: (e: DragEvent) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
        setOver(false)
      },
      onDrop: (e: DragEvent) => {
        e.preventDefault()
        setOver(false)
        const paths = [...e.dataTransfer.files].map((f) => window.gas.files.pathFor(f)).filter(Boolean)
        if (paths.length) onPaths(paths)
      }
    }
  }
}

function SettingsCard({ v }: { v: SpriteProjectView }): ReactElement {
  const { t } = useTranslation()
  const setSettings = useSprite((s) => s.setSettings)
  const st = v.settings
  const dirKey = String(st.dirSet) as '0' | '4' | '6' | '8'
  const order = (dirSet: DirSet, preset: RowPreset): SpriteSettings['rowOrder'] => (dirSet === 0 ? [] : preset === 'custom' ? st.rowOrder : ROW_PRESETS[preset][dirSet])
  return (
    <aside className="sp-set">
      <h3>
        <Icon name="gear" size={14} />
        {t('spriteProject.settings.title')}
      </h3>
      <label className="fld">
        <span>{t('spriteProject.settings.dirs')}</span>
        <Segmented<'0' | '4' | '6' | '8'>
          value={dirKey}
          ariaLabel={t('spriteProject.settings.dirs')}
          options={(['4', '6', '8', '0'] as const).map((k) => ({ value: k, label: t(`spriteProject.settings.dir_${k}`) }))}
          onChange={(k) => {
            const dirSet = Number(k) as DirSet
            void setSettings({ dirSet, rowOrder: order(dirSet, st.rowPreset === 'custom' ? 'flame' : st.rowPreset), rowPreset: st.rowPreset === 'custom' ? 'flame' : st.rowPreset })
          }}
        />
      </label>
      {st.dirSet !== 0 && (
        <>
          <label className="fld">
            <span>{t('spriteProject.settings.rows')}</span>
            <Segmented<'flame' | 'rpgmaker'>
              value={st.rowPreset === 'rpgmaker' ? 'rpgmaker' : 'flame'}
              ariaLabel={t('spriteProject.settings.rows')}
              options={[
                { value: 'flame', label: 'Flame' },
                { value: 'rpgmaker', label: 'RPG Maker' }
              ]}
              onChange={(p) => void setSettings({ rowPreset: p, rowOrder: order(st.dirSet, p) })}
            />
          </label>
          <div className="sp-order">
            {(st.rowOrder.length ? st.rowOrder : DIRECTIONS[st.dirSet]).map((d, i) => (
              <span key={d} className="chip c-gray">
                <small>{i + 1}</small>
                {t(`spriteProject.dir.${d}`)}
              </span>
            ))}
          </div>
          <label className="sp-check">
            <input type="checkbox" checked={st.mirror} onChange={(e) => void setSettings({ mirror: e.target.checked })} />
            <span>
              <b>{t('spriteProject.settings.mirror')}</b>
              <small>{t('spriteProject.settings.mirrorHint')}</small>
            </span>
          </label>
        </>
      )}
      <label className="fld">
        <span>{t('spriteProject.settings.view')}</span>
        <Segmented<ViewAngle>
          value={st.view}
          ariaLabel={t('spriteProject.settings.view')}
          options={(['topdown', 'iso', 'side'] as const).map((k) => ({ value: k, label: t(`spriteProject.view.${k}`) }))}
          onChange={(view) => void setSettings({ view })}
        />
      </label>
      <label className="fld">
        <span>{t('spriteProject.settings.cell')}</span>
        <Segmented<'64' | '128' | '256'>
          value={String(st.cell) as '64' | '128' | '256'}
          ariaLabel={t('spriteProject.settings.cell')}
          options={(['64', '128', '256'] as const).map((k) => ({ value: k, label: `${k} px` }))}
          onChange={(k) => void setSettings({ cell: Number(k) as 64 | 128 | 256 })}
        />
      </label>
    </aside>
  )
}

function SheetCard({ s, index, onOpen }: { s: SheetView; index: number; onOpen: () => void }): ReactElement {
  const { t } = useTranslation()
  const remove = useSprite((st) => st.remove)
  const real = s.frames.length - s.empty.length
  return (
    <motion.div
      className="sp-card"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE, delay: Math.min(index, 10) * 0.03 }}
    >
      <button type="button" className="sp-thumb ck" onClick={onOpen} title={t('spriteProject.sheets.open')}>
        {s.status === 'missing' ? <Icon name="alert" size={28} /> : <img src={s.thumb ?? s.url} alt="" draggable={false} />}
      </button>
      <div className="sp-body">
        <div className="sp-name" title={s.path}>
          {s.name}
        </div>
        <div className="sp-meta mono">
          {s.w} × {s.h} · {fileSize(s.size)}
        </div>
        <div className="sp-chips">
          <span className={s.format === 'grid' ? 'chip c-gray' : 'chip c-blue'} title={s.atlasPath ?? undefined}>
            <Icon name={s.format === 'grid' ? 'grid' : 'file'} size={10} />
            {s.format === 'grid' ? t('spriteProject.format.grid') : `${t(`spriteProject.format.${s.format}`)} · ${s.atlasName ?? ''}`}
          </span>
          <span className="chip c-gray">{t('spriteProject.sheets.frames', { count: real })}</span>
          <span className="chip c-gray">{t('spriteProject.sheets.anims', { count: s.anims.length })}</span>
          {s.status !== 'ok' && <span className={s.status === 'missing' ? 'chip c-red' : 'chip c-orange'}>{t(`spriteProject.status.${s.status}`)}</span>}
        </div>
        {s.warnings.length > 0 && (
          <div className="sp-warn" title={s.warnings.join('\n')}>
            <Icon name="alert" size={12} />
            {s.warnings[0]}
          </div>
        )}
        <div className="sp-acts">
          <button type="button" className="btn sm" onClick={onOpen} disabled={s.status === 'missing'}>
            <Icon name="grid" size={13} />
            {t('spriteProject.sheets.open')}
          </button>
          <button type="button" className="btn ghost sm danger" onClick={() => void remove(s.id)}>
            <Icon name="trash" size={13} />
            {t('spriteProject.sheets.remove')}
          </button>
        </div>
      </div>
    </motion.div>
  )
}

function SheetsStep({ v }: { v: SpriteProjectView }): ReactElement {
  const { t } = useTranslation()
  const busy = useSprite((s) => s.busy)
  const add = useSprite((s) => s.add)
  const pickSheet = useSprite((s) => s.pickSheet)
  const setStep = useSprite((s) => s.setStep)
  const { over, bind } = useDrop((paths) => void add(paths))
  const addBtn = (
    <button type="button" className="btn primary" disabled={busy} onClick={() => void add(null)}>
      {busy ? <span className="spin" /> : <Icon name="plus" size={14} />}
      {t('spriteProject.sheets.add')}
    </button>
  )
  return (
    <div className={over ? 'sp-wrap over' : 'sp-wrap'} {...bind}>
      <div className="sp-main">
        {v.sheets.length === 0 ? (
          <div className="empty-drop big">
            {busy ? <span className="spin lg" /> : <Icon name="grid" size={40} />}
            <h2>{busy ? t('spriteProject.sheets.reading') : t('spriteProject.sheets.emptyTitle')}</h2>
            <p>{t('spriteProject.sheets.emptyDesc')}</p>
            <ul className="sp-formats">
              {(['tp', 'aseprite', 'plist', 'unity', 'grid'] as const).map((k) => (
                <li key={k}>
                  <Icon name="check" size={12} />
                  {t(`spriteProject.sheets.fmt_${k}`)}
                </li>
              ))}
            </ul>
            <div className="actions">{addBtn}</div>
          </div>
        ) : (
          <>
            <div className="toolbar">
              {addBtn}
              <span className="muted">{t('spriteProject.sheets.dropHint')}</span>
              <div className="grow" />
              <button type="button" className="btn" onClick={() => setStep(2)}>
                {t('spriteProject.sheets.next')}
                <Icon name="right" size={14} />
              </button>
            </div>
            <div className="sp-grid">
              {v.sheets.map((s, i) => (
                <SheetCard
                  key={s.id}
                  s={s}
                  index={i}
                  onOpen={() => {
                    pickSheet(s.id)
                    setStep(2)
                  }}
                />
              ))}
            </div>
          </>
        )}
      </div>
      <SettingsCard v={v} />
      {over && (
        <div className="sp-drop">
          <Icon name="upload" size={34} />
          <b>{t('spriteProject.sheets.dropTitle')}</b>
        </div>
      )}
    </div>
  )
}

function GridStep({ v }: { v: SpriteProjectView }): ReactElement {
  const { t } = useTranslation()
  const sheetId = useSprite((s) => s.sheetId)
  const pickSheet = useSprite((s) => s.pickSheet)
  const update = useSprite((s) => s.update)
  const detect = useSprite((s) => s.detect)
  const sheet = v.sheets.find((s) => s.id === sheetId) ?? v.sheets[0]
  if (!sheet) return <div className="proj-state muted">{t('spriteProject.lock.grid')}</div>
  return (
    <div className="sp-grid-step">
      {v.sheets.length > 1 && (
        <div className="sp-tabs" role="tablist">
          {v.sheets.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={s.id === sheet.id} className={s.id === sheet.id ? 'on' : undefined} onClick={() => pickSheet(s.id)}>
              {s.thumb && <img src={s.thumb} alt="" draggable={false} />}
              {s.name}
            </button>
          ))}
        </div>
      )}
      {sheet.status === 'missing' ? (
        <div className="note err">
          <Icon name="alert" size={14} />
          <span>{t('spriteProject.status.missing')}</span>
        </div>
      ) : (
        <SpriteDemo key={sheet.id} sheet={sheet} settings={v.settings} onUpdate={(patch) => void update(sheet.id, patch)} onDetect={() => void detect(sheet.id)} />
      )}
    </div>
  )
}

function Soon({ step }: { step: StepKey }): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="soon">
      <div className="soon-card">
        <div className="soon-ic">
          <Icon name="sparkles" size={26} />
        </div>
        <span className="chip c-blue">{t('project.soon.title')}</span>
        <h2>{t(`spriteProject.steps.${step}`)}</h2>
        <p>{t('spriteProject.soonDesc')}</p>
      </div>
    </div>
  )
}

export function SpriteProjectScreen({ project }: { project: ProjectView }): ReactElement {
  const { t } = useTranslation()
  const load = useSprite((s) => s.load)
  const reset = useSprite((s) => s.reset)
  const view = useSprite((s) => s.view)
  const loading = useSprite((s) => s.loading)
  const step = useSprite((s) => s.step)
  const dir = useSprite((s) => s.stepDir)
  const closeProject = useWs((s) => s.closeProject)

  useEffect(() => {
    void load(project.rel)
  }, [project.rel, project.updatedAt, load])
  useEffect(() => () => reset(), [reset])

  if (!view) {
    return (
      <div className="proj-state">
        {loading ? (
          <>
            <span className="spin" />
            <span className="muted">{t('project.loading')}</span>
          </>
        ) : (
          <div className="empty">
            <Icon name="alert" size={34} />
            <h3>{t('project.notFound')}</h3>
            <button type="button" className="btn" onClick={closeProject}>
              <Icon name="left" size={14} />
              {t('project.backToAll')}
            </button>
          </div>
        )}
      </div>
    )
  }

  const key = STEPS[step - 1]
  return (
    <>
      <StepBar v={view} />
      <div className="pbody">
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={key}
            className="pstep"
            custom={dir}
            variants={{
              enter: (d: number) => ({ opacity: 0, x: 16 * d }),
              center: { opacity: 1, x: 0 },
              exit: (d: number) => ({ opacity: 0, x: -12 * d })
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={viewTransition}
          >
            <Intro step={key} n={step} />
            {key === 'sheets' ? <SheetsStep v={view} /> : key === 'grid' ? <GridStep v={view} /> : <Soon step={key} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  )
}
