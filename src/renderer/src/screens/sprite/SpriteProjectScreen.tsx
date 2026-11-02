import { useEffect, useRef, useState, type DragEvent, type ReactElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import type { ProjectView } from '@shared/workspace'
import { DIRECTIONS, ROW_PRESETS, type Direction, type DirSet, type RowPreset, type SheetView, type SpriteProjectView, type SpriteSettings, type ViewAngle } from '@shared/sprite'
import { Advanced } from '@renderer/components/Advanced'
import { Icon, type IconName } from '@renderer/components/Icon'
import { Segmented } from '@renderer/components/Segmented'
import { SourceChangeBanner } from '@renderer/components/sprite/SourceChangeBanner'
import { SpriteDemo } from '@renderer/components/sprite/SpriteDemo'
import { OrigPreview } from '@renderer/components/sprite/OrigPreview'
import { useClock } from '@renderer/components/sprite/StripPreview'
import { EASE, viewTransition } from '@renderer/lib/motion'
import { fileSize } from '@renderer/lib/format'
import { animRow, genTargets, needsGridEdit } from '@renderer/lib/sprite'
import { useSprite } from '@renderer/store/sprite'
import { useWs } from '@renderer/store/workspace'
import { samePath, useQueue } from '@renderer/store/queue'
import { SpriteStyleStep } from './SpriteStyleStep'
import { SpriteWorkStep } from './SpriteWorkStep'
import { SpriteExportStep } from './SpriteExportStep'
import { NewSheetDialog } from './NewSheetDialog'

const STEPS = ['import', 'style', 'work', 'export'] as const
type StepKey = (typeof STEPS)[number]
const STEP_ICON: Record<StepKey, IconName> = { import: 'upload', style: 'palette', work: 'sparkles', export: 'download' }

function lockReason(v: SpriteProjectView, n: number): 'noSheet' | 'style' | 'export' | null {
  if (n === 1) return null
  if (!v.sheets.length) return 'noSheet'
  if (n === 3) return v.style.locked || v.strips.some((s) => s.versions.length > 0) ? null : 'style'
  if (n === 4) return v.strips.some((s) => s.decision === 'approved') ? null : 'export'
  return null
}

function StepBar({ v }: { v: SpriteProjectView }): ReactElement {
  const { t } = useTranslation()
  const step = useSprite((s) => s.step)
  const setStep = useSprite((s) => s.setStep)
  const anims = v.sheets.reduce((n, s) => n + new Set(s.anims.map((a) => animRow(a.name))).size, 0)
  const dirs = new Set(v.sheets.flatMap((s) => s.anims.map((a) => a.dir).filter(Boolean))).size
  const gens = genTargets(v)
  const allApproved = gens.length > 0 && gens.every((s) => s.decision === 'approved')
  const subs = [
    dirs ? t('spriteProject.sub.importDirs', { sheets: v.sheets.length, anims, dirs }) : t('spriteProject.sub.import', { sheets: v.sheets.length, anims }),
    v.style.locked ? t('spriteProject.sub.styleLocked') : t('spriteProject.sub.styleOpen'),
    t('spriteProject.sub.work', { approved: gens.filter((s) => s.decision === 'approved').length, total: gens.length }),
    v.export.lastAt > 0 ? t('spriteProject.sub.exported', { count: v.export.lastSheets }) : t('spriteProject.sub.notExported')
  ]
  return (
    <div className="steps" role="tablist">
      {STEPS.map((key, i) => {
        const n = i + 1
        const reason = lockReason(v, n)
        const locked = !!reason
        const cur = step === n
        const done = n < step && !locked && (key !== 'work' || allApproved)
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
              title={reason ? t(`spriteProject.lock.${reason}`) : undefined}
              onClick={() => !locked && setStep(n)}
            >
              <span className="num">{done && !cur ? <Icon name="check" size={13} /> : locked ? <Icon name="lock" size={12} /> : n}</span>
              <span>
                <b>{t(`spriteProject.steps.${key}`)}</b>
                <small>{reason ? t(`spriteProject.lock.${reason}`) : subs[i]}</small>
              </span>
            </button>
          </div>
        )
      })}
    </div>
  )
}

function introKey(step: StepKey, v: SpriteProjectView): StepKey | 'exportNew' | 'exportMixed' {
  if (step !== 'export') return step
  const fresh = v.sheets.filter((sh) => sh.origin === 'new').length
  return !fresh ? 'export' : fresh === v.sheets.length ? 'exportNew' : 'exportMixed'
}

function Intro({ step, n, v }: { step: StepKey; n: number; v: SpriteProjectView }): ReactElement {
  const { t } = useTranslation()
  const compact = step === 'work'
  const text = t(`spriteProject.intro.${introKey(step, v)}`)
  return (
    <div className={compact ? 'step-intro k-sprite compact' : 'step-intro k-sprite'}>
      <span className="si-ic">
        <Icon name={STEP_ICON[step]} size={compact ? 13 : 16} />
      </span>
      <div className="si-t">
        <b>
          {t('intro.stepOf', { n, total: STEPS.length })} · {t(`spriteProject.steps.${step}`)}
        </b>
        <span title={compact ? text : undefined}>{text}</span>
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

function SettingsCard({ v, inline = false }: { v: SpriteProjectView; inline?: boolean }): ReactElement {
  const { t } = useTranslation()
  const setSettings = useSprite((s) => s.setSettings)
  const st = v.settings
  const dirKey = String(st.dirSet) as '0' | '4' | '6' | '8'
  const advSummary = [
    st.dirSet !== 0 ? (st.rowPreset === 'rpgmaker' ? 'RPG Maker' : 'Flame') : '',
    st.dirSet !== 0 && st.mirror ? t('spriteProject.settings.mirror') : '',
    t(`spriteProject.view.${st.view}`),
    `${st.cell} px`
  ]
    .filter(Boolean)
    .join(' · ')
  const order = (dirSet: DirSet, preset: RowPreset): SpriteSettings['rowOrder'] => (dirSet === 0 ? [] : preset === 'custom' ? st.rowOrder : ROW_PRESETS[preset][dirSet])
  return (
    <aside className={inline ? 'sp-set inline' : 'sp-set'}>
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
      <Advanced id="sprite-settings" summary={advSummary}>
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
      </Advanced>
    </aside>
  )
}

function SheetCard({ s, index, on, onOpen }: { s: SheetView; index: number; on: boolean; onOpen: () => void }): ReactElement {
  const { t } = useTranslation()
  const remove = useSprite((st) => st.remove)
  const real = s.frames.length - s.empty.length
  return (
    <motion.div
      className={on ? 'sp-card on' : 'sp-card'}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE, delay: Math.min(index, 10) * 0.03 }}
    >
      <button type="button" className="sp-thumb ck" onClick={onOpen} aria-pressed={on} title={s.path}>
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
            <span className="chip c-orange">
              <Icon name="sparkles" size={10} />
              {t('spriteProject.create.badge')}
            </span>
          ) : (
            <>
              <span className={s.format === 'grid' ? 'chip c-gray' : 'chip c-blue'} title={s.atlasPath ?? undefined}>
                <Icon name={s.format === 'grid' ? 'grid' : 'file'} size={10} />
                {s.format === 'grid' ? t('spriteProject.format.grid') : t(`spriteProject.format.${s.format}`)}
              </span>
              <span className="chip c-gray">{t('spriteProject.sheets.frames', { count: real })}</span>
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
          <button type="button" className="btn ghost sm danger" onClick={() => void remove(s.id)}>
            <Icon name="trash" size={13} />
            {t('spriteProject.sheets.remove')}
          </button>
        </div>
      </div>
    </motion.div>
  )
}

function SheetSummary({ v, sheet, open, onToggle }: { v: SpriteProjectView; sheet: SheetView; open: boolean; onToggle: () => void }): ReactElement {
  const { t } = useTranslation()
  const setStep = useSprite((s) => s.setStep)
  const setSettings = useSprite((s) => s.setSettings)
  const [pick, setPick] = useState<string | null>(null)
  const rows = [...new Set(sheet.anims.map((a) => animRow(a.name)))]
  const present = new Set(sheet.anims.map((a) => a.dir))
  const order = DIRECTIONS[v.settings.dirSet || 8]
  const dirs: Array<Direction | null> = [...order, ...DIRECTIONS[8].filter((d) => !order.includes(d))].filter((d) => present.has(d))
  if (present.has(null)) dirs.push(null)
  const anim = sheet.anims.find((a) => a.id === pick) ?? sheet.anims.find((a) => a.dir === 'S') ?? sheet.anims[0] ?? null
  const strip = anim ? (v.strips.find((s) => s.sheetId === sheet.id && s.animId === anim.id) ?? null) : null
  const [pos] = useClock(strip?.frameCount ?? 1, anim?.fps ?? 8, true)
  const real = sheet.frames.length - sheet.empty.length
  const hint = needsGridEdit(sheet, v.settings) ? (sheet.format === 'grid' ? 'noAtlas' : 'noDirs') : null
  const have = dirs.filter((d): d is Direction => !!d)
  const fit = ([4, 6] as const).find((n) => have.length === n && have.every((d) => DIRECTIONS[n].includes(d)))
  const st = v.settings
  const suggest =
    fit && st.dirSet !== 0 && st.dirSet !== fit && v.sheets.every((s) => s.id === sheet.id || (s.origin !== 'new' && s.anims.every((a) => !a.dir || DIRECTIONS[fit].includes(a.dir))))
      ? fit
      : null
  const applyDirs = (n: 4 | 6): void => {
    const preset = st.rowPreset === 'custom' ? 'flame' : st.rowPreset
    void setSettings({ dirSet: n, rowPreset: preset, rowOrder: ROW_PRESETS[preset][n] })
  }
  return (
    <div className="sp-new-sum sp-sum">
      <div className="sp-new-char ck">
        {strip ? (
          <OrigPreview strip={strip} pos={pos % Math.max(1, strip.frameCount)} size={200} />
        ) : sheet.origin === 'new' ? (
          sheet.characterUrl ? <img src={sheet.characterUrl} alt="" draggable={false} /> : <Icon name="image" size={30} />
        ) : (
          <img src={sheet.thumb ?? sheet.url} alt="" draggable={false} />
        )}
      </div>
      <div className="sp-new-body">
        <div className="sp-new-head">
          {sheet.origin === 'new' ? (
            <span className="chip c-orange">
              <Icon name="sparkles" size={10} />
              {t('spriteProject.create.badge')}
            </span>
          ) : (
            <span className={sheet.format === 'grid' ? 'chip c-gray' : 'chip c-blue'} title={sheet.atlasPath ?? undefined}>
              {sheet.format === 'grid' ? t('spriteProject.format.grid') : `${t(`spriteProject.format.${sheet.format}`)} · ${sheet.atlasName ?? ''}`}
            </span>
          )}
          <b>{sheet.name}</b>
          <span className="muted mono">
            {sheet.w} × {sheet.h} · {t('spriteProject.import.stats', { anims: rows.length, dirs: dirs.filter(Boolean).length, frames: real })}
          </span>
        </div>
        {sheet.description && <p className="sp-new-desc">{sheet.description}</p>}
        {sheet.origin === 'new' && <p className="muted">{t('spriteProject.create.gridNote')}</p>}
        {hint && (
          <div className="note warn">
            <Icon name="alert" size={14} />
            <span>{t(`spriteProject.import.${hint}`)}</span>
          </div>
        )}
        {suggest && (
          <div className="note">
            <Icon name="help" size={14} />
            <span className="note-t">{t('spriteProject.import.dirMismatch', { have: have.length, n: st.dirSet })}</span>
            <button type="button" className="btn sm" onClick={() => applyDirs(suggest)}>
              {t('spriteProject.import.setDirs', { n: suggest })}
            </button>
          </div>
        )}
        {rows.length > 0 && (
          <div className="sp-new-tbl-wrap">
            <table className="sp-new-tbl">
              <thead>
                <tr>
                  <th>{t('spriteProject.create.colAnim')}</th>
                  {dirs.map((d) => (
                    <th key={d ?? '-'} title={d ? t(`spriteProject.dir.${d}`) : t('spriteProject.gen.noDir')}>
                      {d ?? '—'}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((n) => (
                  <tr key={n}>
                    <td>
                      <b>{n}</b>
                    </td>
                    {dirs.map((d) => {
                      const a = sheet.anims.find((x) => animRow(x.name) === n && x.dir === d)
                      return (
                        <td key={d ?? '-'}>
                          {a ? (
                            <button type="button" className={anim?.id === a.id ? 'sp-cell on' : 'sp-cell'} onClick={() => setPick(a.id)} title={a.name}>
                              {t('spriteProject.create.frames', { count: a.frames.length })}
                            </button>
                          ) : (
                            '—'
                          )}
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="actions">
          <button type="button" className="btn" aria-expanded={open} onClick={onToggle}>
            <Icon name={open ? 'up' : 'grid'} size={14} />
            {open ? t('spriteProject.import.closeEditor') : t('spriteProject.import.openEditor')}
          </button>
          <button type="button" className="btn primary" onClick={() => setStep(2)}>
            {t('spriteProject.import.next')}
            <Icon name="right" size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

function SheetPanel({ v, sheet }: { v: SpriteProjectView; sheet: SheetView }): ReactElement {
  const { t } = useTranslation()
  const update = useSprite((s) => s.update)
  const detect = useSprite((s) => s.detect)
  const detecting = useSprite((s) => s.detecting)
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [initial] = useState<Record<string, boolean>>(() => ({}))
  if (!(sheet.id in initial)) initial[sheet.id] = needsGridEdit(sheet, v.settings)
  const isOpen = open[sheet.id] ?? initial[sheet.id]
  if (sheet.status === 'missing') {
    return (
      <div className="note err sp-panel-note">
        <Icon name="alert" size={14} />
        <span>{t('spriteProject.status.missing')}</span>
      </div>
    )
  }
  return (
    <div className="sp-panel">
      <SheetSummary key={sheet.id} v={v} sheet={sheet} open={isOpen} onToggle={() => setOpen((o) => ({ ...o, [sheet.id]: !isOpen }))} />
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div className="sp-editor" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.2, ease: EASE }}>
            <SettingsCard v={v} inline />
            {sheet.origin !== 'new' && <SpriteDemo key={sheet.id} sheet={sheet} settings={v.settings} busy={detecting} onUpdate={(patch) => void update(sheet.id, patch)} onDetect={() => void detect(sheet.id)} />}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function ImportStep({ v }: { v: SpriteProjectView }): ReactElement {
  const { t } = useTranslation()
  const busy = useSprite((s) => s.busy)
  const add = useSprite((s) => s.add)
  const sheetId = useSprite((s) => s.sheetId)
  const pickSheet = useSprite((s) => s.pickSheet)
  const { over, bind } = useDrop((paths) => void add(paths))
  const [creating, setCreating] = useState(false)
  const sheet = v.sheets.find((s) => s.id === sheetId) ?? v.sheets[0] ?? null
  const addBtn = (
    <button type="button" className="btn primary" disabled={busy} onClick={() => void add(null)}>
      {busy ? <span className="spin" /> : <Icon name="plus" size={14} />}
      {t('spriteProject.sheets.add')}
    </button>
  )
  return (
    <div className={over ? 'sp-wrap over' : 'sp-wrap'} {...bind}>
      <div className="sp-main">
        {!sheet ? (
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
              <button type="button" className="btn" onClick={() => setCreating(true)}>
                <Icon name="sparkles" size={14} />
                {t('spriteProject.create.open')}
              </button>
              <span className="muted">{t('spriteProject.sheets.dropHint')}</span>
            </div>
            {v.sheets.length > 1 && (
              <div className="sp-shelf">
                {v.sheets.map((s, i) => (
                  <SheetCard key={s.id} s={s} index={i} on={s.id === sheet.id} onOpen={() => pickSheet(s.id)} />
                ))}
              </div>
            )}
            <SheetPanel v={v} sheet={sheet} />
          </>
        )}
      </div>
      {!sheet && <SettingsCard v={v} />}
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
  useEffect(() => {
    const onFocus = (): void => void refresh()
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [refresh])
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
      <SourceChangeBanner v={view} />
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
            <Intro step={key} n={step} v={view} />
            {key === 'import' ? (
              <ImportStep v={view} />
            ) : key === 'style' ? (
              <SpriteStyleStep v={view} />
            ) : key === 'work' ? (
              <SpriteWorkStep v={view} />
            ) : (
              <SpriteExportStep v={view} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  )
}
