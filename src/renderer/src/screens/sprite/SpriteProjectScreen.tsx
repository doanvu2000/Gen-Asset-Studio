import { useEffect, useRef, useState, type DragEvent, type ReactElement } from 'react'
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
import { samePath, useQueue } from '@renderer/store/queue'
import { SpriteStyleStep } from './SpriteStyleStep'
import { SpriteGenStep } from './SpriteGenStep'
import { SpriteReviewStep } from './SpriteReviewStep'
import { SpriteExportStep } from './SpriteExportStep'
import { NewSheetDialog } from './NewSheetDialog'

const STEPS = ['sheets', 'grid', 'style', 'gen', 'review', 'export'] as const
type StepKey = (typeof STEPS)[number]
const STEP_ICON: Record<StepKey, IconName> = { sheets: 'upload', grid: 'grid', style: 'palette', gen: 'sparkles', review: 'eye', export: 'download' }

function canStep(v: SpriteProjectView, n: number): boolean {
  if (n === 1) return true
  if (n === 2 || n === 3) return v.sheets.length > 0
  if (n === 4) return v.sheets.length > 0 && v.style.locked
  if (n === 5) return v.strips.some((s) => s.versions.length > 0)
  return v.strips.some((s) => s.decision === 'approved')
}

const LOCK_KEY = ['', 'grid', 'grid', 'gen', 'review', 'export'] as const

function StepBar({ v }: { v: SpriteProjectView }): ReactElement {
  const { t } = useTranslation()
  const step = useSprite((s) => s.step)
  const setStep = useSprite((s) => s.setStep)
  const frames = v.sheets.reduce((n, s) => n + s.frames.length - s.empty.length, 0)
  const anims = v.sheets.reduce((n, s) => n + s.anims.length, 0)
  const gens = v.strips.filter((s) => !s.mirrorOf)
  const subs = [
    t('spriteProject.sub.sheets', { count: v.sheets.length }),
    t('spriteProject.sub.grid', { frames, anims }),
    v.style.locked ? t('spriteProject.sub.styleLocked') : t('spriteProject.sub.styleOpen'),
    t('spriteProject.sub.gen', { done: gens.filter((s) => s.versions.length > 0).length, total: gens.length }),
    t('spriteProject.sub.review', { count: gens.filter((s) => s.decision === 'approved').length }),
    v.export.lastAt > 0 ? t('spriteProject.sub.exported', { count: v.export.lastSheets }) : t('spriteProject.sub.notExported')
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
              title={locked ? t(`spriteProject.lock.${LOCK_KEY[n - 1] || 'grid'}`) : undefined}
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
        {s.origin === 'new' ? (
          s.characterUrl ? <img src={s.characterUrl} alt="" draggable={false} /> : <Icon name="image" size={28} />
        ) : s.status === 'missing' ? (
          <Icon name="alert" size={28} />
        ) : (
          <img src={s.thumb ?? s.url} alt="" draggable={false} />
        )}
        {s.origin === 'new' && (
          <span className="sp-new-badge">
            <Icon name="sparkles" size={11} />
            {t('spriteProject.create.badge')}
          </span>
        )}
      </button>
      <div className="sp-body">
        <div className="sp-name" title={s.path}>
          {s.name}
        </div>
        <div className="sp-meta mono">
          {s.w} × {s.h} · {fileSize(s.size)}
        </div>
        <div className="sp-chips">
          {s.origin === 'new' ? (
            <>
              <span className="chip c-orange">
                <Icon name="sparkles" size={10} />
                {t('spriteProject.create.badge')}
              </span>
              <span className="chip c-gray">{t('spriteProject.sheets.anims', { count: new Set(s.anims.map((a) => a.name)).size })}</span>
              <span className="chip c-gray">{t('spriteProject.create.dirsChip', { count: Math.max(1, new Set(s.anims.map((a) => a.dir ?? '-')).size) })}</span>
            </>
          ) : (
            <>
              <span className={s.format === 'grid' ? 'chip c-gray' : 'chip c-blue'} title={s.atlasPath ?? undefined}>
                <Icon name={s.format === 'grid' ? 'grid' : 'file'} size={10} />
                {s.format === 'grid' ? t('spriteProject.format.grid') : `${t(`spriteProject.format.${s.format}`)} · ${s.atlasName ?? ''}`}
              </span>
              <span className="chip c-gray">{t('spriteProject.sheets.frames', { count: real })}</span>
              <span className="chip c-gray">{t('spriteProject.sheets.anims', { count: s.anims.length })}</span>
            </>
          )}
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
  const [creating, setCreating] = useState(false)
  const addBtn = (
    <button type="button" className="btn primary" disabled={busy} onClick={() => void add(null)}>
      {busy ? <span className="spin" /> : <Icon name="plus" size={14} />}
      {t('spriteProject.sheets.add')}
    </button>
  )
  const newBtn = (
    <button type="button" className="btn" onClick={() => setCreating(true)}>
      <Icon name="sparkles" size={14} />
      {t('spriteProject.create.open')}
    </button>
  )
  return (
    <div className={over ? 'sp-wrap over' : 'sp-wrap'} {...bind}>
      <div className="sp-main">
        {v.sheets.length === 0 ? (
          <div className="sp-choose">
            <div className="sp-choice">
              <span className="sp-ch-ic">{busy ? <span className="spin lg" /> : <Icon name="grid" size={30} />}</span>
              <span className="chip c-blue">{t('spriteProject.create.reskinChip')}</span>
              <h2>{busy ? t('spriteProject.sheets.reading') : t('spriteProject.create.importTitle')}</h2>
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
            <div className="sp-choice new">
              <span className="sp-ch-ic">
                <Icon name="sparkles" size={30} />
              </span>
              <span className="chip c-orange">{t('spriteProject.create.newChip')}</span>
              <h2>{t('spriteProject.create.emptyTitle')}</h2>
              <p>{t('spriteProject.create.emptyDesc')}</p>
              <ul className="sp-formats">
                {(['dirs', 'anims', 'out'] as const).map((k) => (
                  <li key={k}>
                    <Icon name="check" size={12} />
                    {t(`spriteProject.create.feat_${k}`)}
                  </li>
                ))}
              </ul>
              <div className="actions">
                <button type="button" className="btn primary" onClick={() => setCreating(true)}>
                  <Icon name="sparkles" size={14} />
                  {t('spriteProject.create.open')}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            <div className="toolbar">
              {addBtn}
              {newBtn}
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
      <NewSheetDialog open={creating} v={v} onClose={() => setCreating(false)} />
      {over && (
        <div className="sp-drop">
          <Icon name="upload" size={34} />
          <b>{t('spriteProject.sheets.dropTitle')}</b>
        </div>
      )}
    </div>
  )
}

function NewSheetSummary({ sheet }: { sheet: SheetView }): ReactElement {
  const { t } = useTranslation()
  const setStep = useSprite((s) => s.setStep)
  const names = [...new Set(sheet.anims.map((a) => a.name))]
  const dirs = [...new Set(sheet.anims.map((a) => a.dir))]
  const cell = sheet.grid ? `${sheet.grid.cellW} × ${sheet.grid.cellH}` : ''
  return (
    <div className="sp-new-sum">
      <div className="sp-new-char ck">{sheet.characterUrl ? <img src={sheet.characterUrl} alt="" draggable={false} /> : <Icon name="image" size={30} />}</div>
      <div className="sp-new-body">
        <div className="sp-new-head">
          <span className="chip c-orange">
            <Icon name="sparkles" size={10} />
            {t('spriteProject.create.badge')}
          </span>
          <b>{sheet.name}</b>
          <span className="muted mono">
            {sheet.w} × {sheet.h} · {t('spriteProject.create.cell', { size: cell })}
          </span>
        </div>
        {sheet.description && <p className="sp-new-desc">{sheet.description}</p>}
        <p className="muted">{t('spriteProject.create.gridNote')}</p>
        <table className="sp-new-tbl">
          <thead>
            <tr>
              <th>{t('spriteProject.create.colAnim')}</th>
              {dirs.map((d) => (
                <th key={d ?? '-'}>{d ? t(`spriteProject.dir.${d}`) : '—'}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {names.map((n) => (
              <tr key={n}>
                <td>
                  <b>{n}</b>
                </td>
                {dirs.map((d) => {
                  const a = sheet.anims.find((x) => x.name === n && x.dir === d)
                  return <td key={d ?? '-'}>{a ? t('spriteProject.create.frames', { count: a.frames.length }) : '—'}</td>
                })}
              </tr>
            ))}
          </tbody>
        </table>
        <div className="actions">
          <button type="button" className="btn primary" onClick={() => setStep(3)}>
            {t('spriteProject.create.toStyle')}
            <Icon name="right" size={14} />
          </button>
        </div>
      </div>
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
              {(s.origin === 'new' ? s.characterUrl : s.thumb) && <img src={(s.origin === 'new' ? s.characterUrl : s.thumb) as string} alt="" draggable={false} />}
              {s.name}
            </button>
          ))}
        </div>
      )}
      {sheet.origin === 'new' ? (
        <NewSheetSummary sheet={sheet} />
      ) : sheet.status === 'missing' ? (
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
  const refresh = useSprite((s) => s.refresh)
  const snap = useQueue((s) => s.snap)
  const finished = useRef<string | null>(null)
  useEffect(() => {
    if (!snap || !view) return
    const sig = snap.jobs
      .filter((j) => samePath(j.projectPath, view.dir) && (j.status === 'done' || j.status === 'qaWarn' || j.status === 'error'))
      .map((j) => `${j.id}:${j.status}:${j.finishedAt ?? 0}`)
      .join('|')
    if (sig === finished.current) return
    const first = finished.current === null
    finished.current = sig
    if (!first) void refresh()
  }, [snap, view, refresh])

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
            {key === 'sheets' ? (
              <SheetsStep v={view} />
            ) : key === 'grid' ? (
              <GridStep v={view} />
            ) : key === 'style' ? (
              <SpriteStyleStep v={view} />
            ) : key === 'gen' ? (
              <SpriteGenStep v={view} />
            ) : key === 'review' ? (
              <SpriteReviewStep v={view} />
            ) : (
              <SpriteExportStep v={view} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  )
}
