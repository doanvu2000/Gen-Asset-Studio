import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import type { ProjectView } from '@shared/workspace'
import type { SpineProjectView, SpineRegionView } from '@shared/spine'
import { Icon, type IconName } from '@renderer/components/Icon'
import { SpineCompare } from '@renderer/components/spine/SpineCompare'
import { useViewer } from '@renderer/components/spine/SpinePreview'
import { viewTransition } from '@renderer/lib/motion'
import { importErrorText, useSpine } from '@renderer/store/spine'
import { useWs } from '@renderer/store/workspace'
import { samePath, useQueue } from '@renderer/store/queue'
import { SpineStyleStep } from './SpineStyleStep'
import { SpineGenStep } from './SpineGenStep'
import { SpineRigStep } from './SpineRigStep'
import { SpineReviewStep } from './SpineReviewStep'
import { SpineExportStep } from './SpineExportStep'

const STEPS = ['import', 'regions', 'style', 'gen', 'rig', 'review', 'export'] as const
type StepKey = (typeof STEPS)[number]
const STEP_ICON: Record<StepKey, IconName> = { import: 'upload', regions: 'grid', style: 'palette', gen: 'sparkles', rig: 'link', review: 'eye', export: 'download' }

function canStep(v: SpineProjectView, n: number): boolean {
  if (n === 1) return true
  if (n === 2 || n === 3) return v.loaded
  if (n === 4) return v.loaded && v.style.locked
  if (n === 5 || n === 6) return v.loaded && v.regions.some((r) => r.versions.length > 0)
  return v.loaded && v.regions.some((r) => r.decision === 'approved')
}

type LockKey = 'import' | 'style' | 'gen' | 'review'
const LOCK_KEY: Record<number, LockKey> = { 2: 'import', 3: 'import', 4: 'style', 5: 'gen', 6: 'gen', 7: 'review' }

function StepBar({ v }: { v: SpineProjectView }): ReactElement {
  const { t } = useTranslation()
  const step = useSpine((s) => s.step)
  const setStep = useSpine((s) => s.setStep)
  const used = v.regions.filter((r) => r.used)
  const rigN = Object.keys(v.rig.bones).length + Object.keys(v.rig.attachments).length
  const subs = [
    v.loaded ? (v.skeletonName ?? '') : t('spineProject.sub.none'),
    t('spineProject.sub.regions', { count: v.regions.length }),
    v.style.locked ? t('spineProject.sub.styleLocked') : t('spineProject.sub.styleOpen'),
    t('spineProject.sub.gen', { done: used.filter((r) => r.versions.length > 0).length, total: used.length }),
    rigN ? t('spineProject.sub.rig', { count: rigN }) : t('spineProject.sub.rigNone'),
    t('spineProject.sub.review', { count: v.regions.filter((r) => r.decision === 'approved').length }),
    v.export.lastAt > 0 ? t('spineProject.sub.exported', { count: v.export.lastPages }) : t('spineProject.sub.notExported')
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
              title={locked ? t(`spineProject.lock.${LOCK_KEY[n] ?? 'import'}`) : undefined}
              onClick={() => !locked && setStep(n)}
            >
              <span className="num">{done && !cur ? <Icon name="check" size={13} /> : locked ? <Icon name="lock" size={12} /> : n}</span>
              <span>
                <b>{t(`spineProject.steps.${key}`)}</b>
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
    <div className="step-intro k-spine">
      <span className="si-ic">
        <Icon name={STEP_ICON[step]} size={16} />
      </span>
      <div className="si-t">
        <b>
          {t('intro.stepOf', { n, total: STEPS.length })} · {t(`spineProject.steps.${step}`)}
        </b>
        <span>{t(`spineProject.intro.${step}`)}</span>
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

function ImportStep({ v }: { v: SpineProjectView }): ReactElement {
  const { t } = useTranslation()
  const busy = useSpine((s) => s.busy)
  const importFrom = useSpine((s) => s.importFrom)
  const clear = useSpine((s) => s.clear)
  const setStep = useSpine((s) => s.setStep)
  const importError = useSpine((s) => s.importError)
  const orig = useSpine((s) => s.orig)
  const viewer = useViewer()
  const { over, bind } = useDrop((paths) => void importFrom(paths))
  const sk = v.skeleton

  const err = importError ? (
    <div className="note err">
      <Icon name="alert" size={14} />
      <span>{importErrorText(importError)}</span>
    </div>
  ) : null

  if (!v.loaded) {
    return (
      <div className={over ? 'spi-wrap over' : 'spi-wrap'} {...bind}>
        <div className="empty-drop big">
          {busy ? <span className="spin lg" /> : <Icon name="layers" size={40} />}
          <h2>{busy ? t('spineProject.import.reading') : t('spineProject.import.title')}</h2>
          <p>{t('spineProject.import.desc')}</p>
          <ul className="sp-formats">
            {(['json', 'atlas', 'png', 'ver', 'skel'] as const).map((k) => (
              <li key={k} className={k === 'skel' ? 'no' : undefined}>
                <Icon name={k === 'skel' ? 'x' : 'check'} size={12} />
                {t(`spineProject.import.fmt_${k}`)}
              </li>
            ))}
          </ul>
          {err}
          <div className="actions">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void importFrom(null)}>
              {busy ? <span className="spin" /> : <Icon name="folder" size={14} />}
              {t('spineProject.import.pick')}
            </button>
          </div>
          <small className="muted">{t('spineProject.import.dropHint')}</small>
        </div>
        {over && (
          <div className="sp-drop spine">
            <Icon name="upload" size={34} />
            <b>{t('spineProject.import.dropTitle')}</b>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className={over ? 'spi-wrap over' : 'spi-wrap'} {...bind}>
      <div className="spi-loaded">
        <section className="spi-card">
          <div className="spi-head">
            <span className="kbadge k-spine">
              <Icon name="layers" size={11} />
              Spine {sk?.version ?? ''}
            </span>
            <b>{v.skeletonName}</b>
            {v.status !== 'ok' && <span className={v.status === 'missing' ? 'chip c-red' : 'chip c-orange'}>{t(`spineProject.status.${v.status}`)}</span>}
          </div>
          <dl className="kv">
            <dt>{t('spineProject.import.skeleton')}</dt>
            <dd className="mono ellipsis" title={v.skeletonPath ?? ''}>
              {v.skeletonPath}
            </dd>
            <dt>{t('spineProject.import.atlas')}</dt>
            <dd className="mono ellipsis" title={v.atlasPath ?? ''}>
              {v.atlasPath}
            </dd>
            <dt>{t('spineProject.import.pages')}</dt>
            <dd>{v.pages.map((p) => `${p.name} (${p.w}×${p.h})`).join(', ')}</dd>
            <dt>{t('spineProject.import.counts')}</dt>
            <dd>
              {t('spineProject.import.countsVal', {
                regions: v.regions.length,
                bones: sk?.bones.length ?? 0,
                slots: sk?.slots.length ?? 0,
                skins: sk?.skins.length ?? 0,
                anims: sk?.animations.length ?? 0
              })}
            </dd>
          </dl>
          {v.error && (
            <div className="note warn">
              <Icon name="alert" size={14} />
              <span>{v.error}</span>
            </div>
          )}
          {err}
          <div className="spi-acts">
            <button type="button" className="btn" disabled={busy} onClick={() => void importFrom(null)}>
              <Icon name="refresh" size={14} />
              {t('spineProject.import.reimport')}
            </button>
            <button type="button" className="btn ghost danger" onClick={() => void clear()}>
              <Icon name="trash" size={14} />
              {t('spineProject.import.clear')}
            </button>
            <div className="grow" />
            <button type="button" className="btn primary" onClick={() => setStep(2)}>
              {t('spineProject.import.next')}
              <Icon name="right" size={14} />
            </button>
          </div>
        </section>
        <section className="spi-pv">
          <SpineCompare viewer={viewer} orig={orig} next={null} single="orig" height={380} />
        </section>
      </div>
      {over && (
        <div className="sp-drop spine">
          <Icon name="upload" size={34} />
          <b>{t('spineProject.import.dropTitle')}</b>
        </div>
      )}
    </div>
  )
}

function RegionCard({ r, on, onPick }: { r: SpineRegionView; on: boolean; onPick: () => void }): ReactElement {
  const { t } = useTranslation()
  const trimmed = r.origW !== r.w || r.origH !== r.h
  return (
    <button type="button" className={['spr-reg', on && 'on', !r.used && 'unused'].filter(Boolean).join(' ')} onClick={onPick}>
      <span className="spr-reg-img ck">{r.sourceUrl ? <img src={r.sourceUrl} alt="" draggable={false} /> : <Icon name="alert" size={18} />}</span>
      <span className="spr-reg-b">
        <b title={r.name}>{r.name}</b>
        <small className="mono">
          {r.w}×{r.h}
          {trimmed ? ` / ${r.origW}×${r.origH}` : ''}
        </small>
        <span className="spr-reg-chips">
          {r.degrees === 90 && <span className="chip c-gray">{t('spineProject.regions.rotated')}</span>}
          {trimmed && <span className="chip c-gray">{t('spineProject.regions.trimmed')}</span>}
          {r.kinds.includes('mesh') && <span className="chip c-purple">mesh</span>}
          {!r.used && <span className="chip c-orange">{t('spineProject.regions.unused')}</span>}
        </span>
      </span>
    </button>
  )
}

function RegionsStep({ v }: { v: SpineProjectView }): ReactElement {
  const { t } = useTranslation()
  const orig = useSpine((s) => s.orig)
  const setStep = useSpine((s) => s.setStep)
  const viewer = useViewer()
  const [skin, setSkin] = useState('all')
  const [pick, setPick] = useState<string | null>(null)
  const skins = v.skeleton?.skins ?? []
  const list = v.regions.filter((r) => skin === 'all' || r.skins.includes(skin))
  const cur = v.regions.find((r) => r.key === pick) ?? null
  const pages = useMemo(() => [...new Set(list.map((r) => r.page))], [list])
  const { info: vInfo, setSkin: vSetSkin } = viewer
  useEffect(() => {
    if (skin !== 'all' && vInfo?.skins.includes(skin)) vSetSkin(skin)
  }, [skin, vInfo, vSetSkin])
  return (
    <div className="spr-regions">
      <div className="spr-reg-main">
        <div className="toolbar">
          <span className="muted">{t('spineProject.regions.count', { count: list.length, total: v.regions.length })}</span>
          {skins.length > 1 && (
            <select className="inp sm" value={skin} onChange={(e) => setSkin(e.target.value)}>
              <option value="all">{t('spineProject.regions.allSkins')}</option>
              {skins.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          )}
          <div className="grow" />
          <button type="button" className="btn primary sm" onClick={() => setStep(3)}>
            {t('spineProject.regions.next')}
            <Icon name="right" size={13} />
          </button>
        </div>
        <div className="spr-reg-scroll">
          {pages.map((p) => (
            <section key={p}>
              <h4>
                <Icon name="image" size={13} />
                {p}
              </h4>
              <div className="spr-reg-grid">
                {list
                  .filter((r) => r.page === p)
                  .map((r) => (
                    <RegionCard key={r.key} r={r} on={r.key === pick} onPick={() => setPick(r.key === pick ? null : r.key)} />
                  ))}
              </div>
            </section>
          ))}
        </div>
      </div>
      <aside className="spr-reg-side">
        <SpineCompare viewer={viewer} orig={orig} next={null} single="orig" height={340} highlightSlots={cur?.slots} />
        {cur ? (
          <div className="spr-reg-info">
            <b>{cur.name}</b>
            <dl className="kv">
              <dt>{t('spineProject.regions.page')}</dt>
              <dd>
                {cur.page} · {cur.x},{cur.y}
              </dd>
              <dt>{t('spineProject.regions.slots')}</dt>
              <dd>{cur.slots.join(', ') || '—'}</dd>
              <dt>{t('spineProject.regions.skins')}</dt>
              <dd>{cur.skins.join(', ') || '—'}</dd>
            </dl>
            <small className="muted">{t('spineProject.regions.hl')}</small>
          </div>
        ) : (
          <p className="muted spr-reg-info">{t('spineProject.regions.pickHint')}</p>
        )}
      </aside>
    </div>
  )
}

export function SpineProjectScreen({ project }: { project: ProjectView }): ReactElement {
  const { t } = useTranslation()
  const load = useSpine((s) => s.load)
  const reset = useSpine((s) => s.reset)
  const refresh = useSpine((s) => s.refresh)
  const view = useSpine((s) => s.view)
  const loading = useSpine((s) => s.loading)
  const step = useSpine((s) => s.step)
  const dir = useSpine((s) => s.stepDir)
  const closeProject = useWs((s) => s.closeProject)
  const snap = useQueue((s) => s.snap)
  const finished = useRef<string | null>(null)

  useEffect(() => {
    void load(project.rel)
  }, [project.rel, load])
  useEffect(() => () => reset(), [reset])
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
            {key === 'import' ? (
              <ImportStep v={view} />
            ) : key === 'regions' ? (
              <RegionsStep v={view} />
            ) : key === 'style' ? (
              <SpineStyleStep v={view} />
            ) : key === 'gen' ? (
              <SpineGenStep v={view} />
            ) : key === 'rig' ? (
              <SpineRigStep v={view} />
            ) : key === 'review' ? (
              <SpineReviewStep v={view} />
            ) : (
              <SpineExportStep v={view} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  )
}
