import { useEffect, useMemo, useRef, useState, type DragEvent, type ReactElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import type { ProjectView } from '@shared/workspace'
import type { SpineProjectView, SpineRegionView } from '@shared/spine'
import { Icon, type IconName } from '@renderer/components/Icon'
import { Modal } from '@renderer/components/Modal'
import { SpineCompare } from '@renderer/components/spine/SpineCompare'
import { useViewer } from '@renderer/components/spine/SpinePreview'
import { rigEditCount, SPINE_STEPS, spineStepLock, type SpineStepKey } from '@renderer/lib/spine'
import { viewTransition } from '@renderer/lib/motion'
import { importErrorText, useSpine } from '@renderer/store/spine'
import { useWs } from '@renderer/store/workspace'
import { samePath, useQueue } from '@renderer/store/queue'
import { SpineStyleStep } from './SpineStyleStep'
import { SpineGenReviewStep } from './SpineGenReviewStep'
import { SpineExportStep } from './SpineExportStep'

const STEP_ICON: Record<SpineStepKey, IconName> = { import: 'upload', style: 'palette', gen: 'sparkles', export: 'download' }

function StepBar({ v }: { v: SpineProjectView }): ReactElement {
  const { t } = useTranslation()
  const step = useSpine((s) => s.step)
  const setStep = useSpine((s) => s.setStep)
  const used = v.regions.filter((r) => r.used)
  const pool = used.length ? used : v.regions
  const rigN = rigEditCount(v)
  const allApproved = pool.length > 0 && pool.every((r) => r.decision === 'approved')
  const subs = [
    v.loaded ? `${v.skeletonName ?? ''} · ${t('spineProject.sub.regions', { count: v.regions.length })}` : t('spineProject.sub.none'),
    v.style.locked ? t('spineProject.sub.styleLocked') : t('spineProject.sub.styleOpen'),
    t('spineProject.sub.genReview', {
      gen: pool.filter((r) => r.versions.length > 0).length,
      approved: pool.filter((r) => r.decision === 'approved').length,
      total: pool.length
    }) + (rigN ? ` · ${t('spineProject.sub.rig', { count: rigN })}` : ''),
    v.export.lastAt > 0 ? t('spineProject.sub.exported', { count: v.export.lastPages }) : t('spineProject.sub.notExported')
  ]
  return (
    <div className="steps" role="tablist">
      {SPINE_STEPS.map((key, i) => {
        const n = i + 1
        const lock = spineStepLock(v, n)
        const locked = !!lock
        const cur = step === n
        const done = n < step && !locked && (key !== 'gen' || allApproved)
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
              title={lock ? t(`spineProject.lock.${lock}`) : undefined}
              onClick={() => !locked && setStep(n)}
            >
              <span className="num">{done && !cur ? <Icon name="check" size={13} /> : locked ? <Icon name="lock" size={12} /> : n}</span>
              <span>
                <b>{t(`spineProject.steps.${key}`)}</b>
                <small>{lock ? t(`spineProject.lock.${lock}`) : subs[i]}</small>
              </span>
            </button>
          </div>
        )
      })}
    </div>
  )
}

function Intro({ step, n }: { step: SpineStepKey; n: number }): ReactElement {
  const { t } = useTranslation()
  const compact = step === 'gen'
  const text = t(`spineProject.intro.${step}`)
  return (
    <div className={compact ? 'step-intro k-spine compact' : 'step-intro k-spine'}>
      <span className="si-ic">
        <Icon name={STEP_ICON[step]} size={compact ? 13 : 16} />
      </span>
      <div className="si-t">
        <b>
          {t('intro.stepOf', { n, total: SPINE_STEPS.length })} · {t(`spineProject.steps.${step}`)}
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

function SkeletonBar({ v, err }: { v: SpineProjectView; err: ReactElement | null }): ReactElement {
  const { t } = useTranslation()
  const busy = useSpine((s) => s.busy)
  const importFrom = useSpine((s) => s.importFrom)
  const clear = useSpine((s) => s.clear)
  const importError = useSpine((s) => s.importError)
  const [confirmClear, setConfirmClear] = useState(false)
  const sk = v.skeleton
  return (
    <section className="spi-bar">
      <div className="spi-head">
        <span className="kbadge k-spine">
          <Icon name="layers" size={11} />
          Spine {sk?.version ?? ''}
        </span>
        <b title={v.skeletonPath ?? ''}>{v.skeletonName}</b>
        {v.skeletonFormat && <span className="chip c-gray">{t(`spineProject.import.format.${v.skeletonFormat}`)}</span>}
        {v.status !== 'ok' && <span className={v.status === 'missing' ? 'chip c-red' : 'chip c-orange'}>{t(`spineProject.status.${v.status}`)}</span>}
        <span className="muted spi-counts">
          {t('spineProject.import.countsVal', {
            regions: v.regions.length,
            bones: sk?.bones.length ?? 0,
            slots: sk?.slots.length ?? 0,
            skins: sk?.skins.length ?? 0,
            anims: sk?.animations.length ?? 0
          })}
        </span>
        <div className="grow" />
        <button type="button" className="btn sm" disabled={busy} onClick={() => void importFrom(null)}>
          {busy ? <span className="spin" /> : <Icon name="refresh" size={13} />}
          {t('spineProject.import.reimport')}
        </button>
        <button type="button" className="btn ghost sm danger" disabled={busy} onClick={() => setConfirmClear(true)}>
          <Icon name="trash" size={13} />
          {t('spineProject.import.clear')}
        </button>
      </div>
      <details className="spi-more">
        <summary>{t('spineProject.import.details')}</summary>
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
        </dl>
      </details>
      {v.status === 'changed' && <SourceNote v={v} dup={importError} />}
      {v.error && v.status !== 'changed' && v.error !== importError && (
        <div className="note warn">
          <Icon name="alert" size={14} />
          <span>{importErrorText(v.error)}</span>
        </div>
      )}
      {err}
      <Modal open={confirmClear} onClose={() => setConfirmClear(false)} label={t('spineProject.import.clear')} role="alertdialog">
        <h2>
          <span className="dlg-ic danger">
            <Icon name="trash" size={22} />
          </span>
          {t('spineProject.import.clearTitle', { name: v.skeletonName ?? '' })}
        </h2>
        <p>{t('spineProject.import.clearDesc')}</p>
        <div className="acts">
          <button type="button" className="btn" onClick={() => setConfirmClear(false)}>
            {t('dialogs.cancel')}
          </button>
          <button
            type="button"
            className="btn danger solid"
            onClick={() => {
              setConfirmClear(false)
              void clear()
            }}
          >
            <Icon name="trash" size={14} />
            {t('spineProject.import.clear')}
          </button>
        </div>
      </Modal>
    </section>
  )
}

function SourceNote({ v, dup }: { v: SpineProjectView; dup: string | null }): ReactElement {
  const { t } = useTranslation()
  const kind = v.status === 'missing' ? 'missing' : v.error?.split(':')[0] === 'sourceChanged' ? 'changed' : 'unreadable'
  const files = v.changedFiles?.length ? v.changedFiles : [v.skeletonPath, v.atlasPath].filter((f): f is string => !!f)
  return (
    <div className={kind === 'changed' ? 'note warn spi-src' : 'note err spi-src'}>
      <Icon name="alert" size={14} />
      <span>
        <b>{t(`spineProject.import.src.${kind}Title`)}</b> {t(`spineProject.import.src.${kind}Hint`)}
        {kind !== 'changed' && v.error && v.error !== dup && <small>{importErrorText(v.error)}</small>}
        {files.length > 0 && <small className="mono">{files.join(' · ')}</small>}
      </span>
    </div>
  )
}

function Regions({ v }: { v: SpineProjectView }): ReactElement {
  const { t } = useTranslation()
  const orig = useSpine((s) => s.orig)
  const setStep = useSpine((s) => s.setStep)
  const viewer = useViewer()
  const [skin, setSkin] = useState('all')
  const [pick, setPick] = useState<string | null>(null)
  const skins = v.skeleton?.skins ?? []
  const list = useMemo(() => v.regions.filter((r) => skin === 'all' || r.skins.includes(skin)), [v.regions, skin])
  const cur = v.regions.find((r) => r.key === pick) ?? null
  const pages = useMemo(() => [...new Set(list.map((r) => r.page))], [list])
  const { info: vInfo, setSkin: vSetSkin } = viewer
  useEffect(() => {
    if (skin !== 'all' && vInfo?.skins.includes(skin)) vSetSkin(skin)
  }, [skin, vInfo, vSetSkin])
  return (
    <>
      <div className="toolbar">
        <span className="muted">{t('spineProject.regions.count', { count: list.length, total: v.regions.length })}</span>
        {skins.length > 1 && (
          <select className="inp sm" value={skin} onChange={(e) => setSkin(e.target.value)} aria-label={t('spineProject.regions.skins')}>
            <option value="all">{t('spineProject.regions.allSkins')}</option>
            {skins.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        )}
        <div className="grow" />
        <button type="button" className="btn primary sm" onClick={() => setStep(2)}>
          {t('spineProject.regions.next')}
          <Icon name="right" size={13} />
        </button>
      </div>
      <div className="spr-regions">
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
    </>
  )
}

function ImportStep({ v }: { v: SpineProjectView }): ReactElement {
  const { t } = useTranslation()
  const busy = useSpine((s) => s.busy)
  const importFrom = useSpine((s) => s.importFrom)
  const importError = useSpine((s) => s.importError)
  const { over, bind } = useDrop((paths) => void importFrom(paths))

  const err = importError ? (
    <div className="note err">
      <Icon name="alert" size={14} />
      <span>{importErrorText(importError)}</span>
    </div>
  ) : null

  const drop = over && (
    <div className="sp-drop spine">
      <Icon name="upload" size={34} />
      <b>{t('spineProject.import.dropTitle')}</b>
    </div>
  )

  if (!v.loaded) {
    return (
      <div className={over ? 'spi-wrap over' : 'spi-wrap'} {...bind}>
        <div className="empty-drop big">
          {busy ? <span className="spin lg" /> : <Icon name="layers" size={40} />}
          <h2>{busy ? t('spineProject.import.reading') : t('spineProject.import.title')}</h2>
          <p>{t('spineProject.import.desc')}</p>
          <ul className="sp-formats">
            {(['json', 'bin', 'atlas', 'png', 'ver'] as const).map((k) => (
              <li key={k}>
                <Icon name="check" size={12} />
                {t(`spineProject.import.fmt_${k}`)}
              </li>
            ))}
          </ul>
          {(v.status === 'missing' || v.status === 'changed') && <SourceNote v={v} dup={importError} />}
          {err}
          <div className="actions">
            <button type="button" className="btn primary" disabled={busy} onClick={() => void importFrom(null)}>
              {busy ? <span className="spin" /> : <Icon name="folder" size={14} />}
              {t('spineProject.import.pick')}
            </button>
          </div>
          <small className="muted">{t('spineProject.import.dropHint')}</small>
        </div>
        {drop}
      </div>
    )
  }

  return (
    <div className={over ? 'spi-wrap loaded over' : 'spi-wrap loaded'} {...bind}>
      <SkeletonBar v={v} err={err} />
      <Regions key={`${v.skeletonPath ?? ''}:${v.regions.length}`} v={v} />
      {drop}
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

  const key = SPINE_STEPS[Math.min(Math.max(step, 1), SPINE_STEPS.length) - 1]
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
            {key === 'import' ? <ImportStep v={view} /> : key === 'style' ? <SpineStyleStep v={view} /> : key === 'gen' ? <SpineGenReviewStep v={view} /> : <SpineExportStep v={view} />}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  )
}
