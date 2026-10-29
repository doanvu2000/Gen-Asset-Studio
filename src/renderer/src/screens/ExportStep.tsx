import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import type { i18n as I18n } from 'i18next'
import {
  BACKUP_DIR,
  DEFAULT_EXPORT_OPTIONS,
  EXPORT_SCALES,
  normalizeExportOptions,
  type ExportApi,
  type ExportOptions,
  type ExportPlan,
  type ExportProgress,
  type ExportResult,
  type ExportScaleFactor,
  type ExportSkipReason
} from '@shared/export'
import type { ProjectView } from '@shared/workspace'
import { Icon } from '@renderer/components/Icon'
import { EASE, fadeTransition } from '@renderer/lib/motion'
import { errMsg } from '@renderer/lib/files'
import { toast } from '@renderer/store/toast'
import exportVi from '../i18n/export.vi.json'
import exportEn from '../i18n/export.en.json'
import '../styles/export.css'

type Vars = Record<string, string | number>
type T = (key: string, vars?: Vars) => string

const BUNDLES: Record<string, object> = { vi: exportVi, en: exportEn }
const TREE_LIMIT = 400
const OTHER_REASONS: ExportSkipReason[] = ['noVersion', 'missingFile', 'sizeMismatch', 'sprite']

function ensureBundles(i18n: I18n): void {
  for (const [lng, bundle] of Object.entries(BUNDLES)) {
    if (!i18n.getResource(lng, 'translation', 'export.title')) i18n.addResourceBundle(lng, 'translation', bundle, true, false)
  }
}

function useExportT(): T {
  const { t, i18n } = useTranslation()
  ensureBundles(i18n)
  const raw = t as unknown as (key: string, opts?: Vars) => string
  return useCallback((key: string, vars?: Vars) => raw(`export.${key}`, vars), [raw])
}

function storeKey(rel: string): string {
  return `gas.export.${rel}`
}

function loadOptions(rel: string, defaultScale: ExportScaleFactor): ExportOptions {
  try {
    const raw = localStorage.getItem(storeKey(rel))
    if (raw) return normalizeExportOptions(JSON.parse(raw) as Partial<ExportOptions>)
  } catch {
    return { ...DEFAULT_EXPORT_OPTIONS, scales: [defaultScale] }
  }
  return { ...DEFAULT_EXPORT_OPTIONS, scales: [defaultScale] }
}

function saveOptions(rel: string, o: ExportOptions): void {
  try {
    localStorage.setItem(storeKey(rel), JSON.stringify(o))
  } catch {
    return
  }
}

function lastSeg(p: string): string {
  const parts = p.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? p
}

function sepOf(p: string): string {
  return p.includes('\\') ? '\\' : '/'
}

interface TreeFile {
  rel: string
  name: string
  w: number
  h: number
  exists: boolean
}

interface TreeRow {
  key: string
  depth: number
  folder: boolean
  name: string
  file?: TreeFile
}

function buildTree(plan: ExportPlan): { rows: TreeRow[]; more: number } {
  const files: TreeFile[] = []
  for (const item of plan.items) {
    for (const t of item.targets) files.push({ rel: t.rel, name: t.rel.slice(t.rel.lastIndexOf('/') + 1), w: t.w, h: t.h, exists: t.exists })
  }
  const byDir = new Map<string, TreeFile[]>()
  for (const f of files) {
    const slash = f.rel.lastIndexOf('/')
    const dir = slash >= 0 ? f.rel.slice(0, slash) : ''
    const list = byDir.get(dir)
    if (list) list.push(f)
    else byDir.set(dir, [f])
  }
  const dirs = [...byDir.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
  const rows: TreeRow[] = []
  let prev: string[] = []
  let shown = 0
  for (const d of dirs) {
    if (shown >= TREE_LIMIT) break
    const parts = d ? d.split('/') : []
    let k = 0
    while (k < prev.length && k < parts.length && prev[k] === parts[k]) k++
    for (let i = k; i < parts.length; i++) rows.push({ key: `d:${parts.slice(0, i + 1).join('/')}`, depth: i + 1, folder: true, name: parts[i] })
    const list = (byDir.get(d) ?? []).sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
    for (const f of list) {
      if (shown >= TREE_LIMIT) break
      rows.push({ key: `f:${f.rel}`, depth: parts.length + 1, folder: false, name: f.name, file: f })
      shown++
    }
    prev = parts
  }
  return { rows, more: Math.max(0, files.length - shown) }
}

export interface ExportStepProps {
  project: ProjectView
  api: ExportApi
  onPickFolder?: (current: string) => Promise<string | null>
  onBack?: () => void
  onHome?: () => void
  onExported?: (result: ExportResult) => void
  defaultScale?: ExportScaleFactor
}

export function ExportStep({ project, api, onPickFolder, onBack, onHome, onExported, defaultScale = 1 }: ExportStepProps): ReactElement {
  const t = useExportT()
  const [opts, setOpts] = useState<ExportOptions>(() => loadOptions(project.rel, defaultScale))
  const [plan, setPlan] = useState<ExportPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [showSkipped, setShowSkipped] = useState(false)
  const [progress, setProgress] = useState<ExportProgress | null>(null)
  const [running, setRunning] = useState(false)
  const [canceling, setCanceling] = useState(false)
  const [result, setResult] = useState<ExportResult | null>(null)
  const [tick, setTick] = useState(0)
  const seq = useRef(0)

  useEffect(() => {
    setOpts(loadOptions(project.rel, defaultScale))
    setResult(null)
  }, [project.rel, defaultScale])

  useEffect(() => {
    saveOptions(project.rel, opts)
  }, [project.rel, opts])

  const optsKey = JSON.stringify(opts)
  useEffect(() => {
    if (running) return
    const id = ++seq.current
    setLoading(true)
    const timer = setTimeout(() => {
      api
        .plan(project.rel, opts)
        .then((p) => {
          if (seq.current === id) setPlan(p)
        })
        .catch((e) => {
          if (seq.current === id) toast(errMsg(e), 'err')
        })
        .finally(() => {
          if (seq.current === id) setLoading(false)
        })
    }, 150)
    return () => clearTimeout(timer)
  }, [api, project.rel, project.updatedAt, optsKey, running, tick])

  useEffect(
    () =>
      api.onProgress((p) => {
        if (p.projectRel === project.rel) setProgress(p)
      }),
    [api, project.rel]
  )

  const patch = (p: Partial<ExportOptions>): void => setOpts((o) => normalizeExportOptions({ ...o, ...p }))

  const toggleScale = (s: ExportScaleFactor): void => {
    const has = opts.scales.includes(s)
    patch({ scales: has ? opts.scales.filter((x) => x !== s) : [...opts.scales, s] })
  }

  const pick = async (): Promise<void> => {
    const current = plan?.outDir ?? opts.outDir
    try {
      const dir = onPickFolder ? await onPickFolder(current) : await api.pickDir(current)
      if (dir) patch({ outDir: dir })
    } catch (e) {
      toast(errMsg(e), 'err')
    }
  }

  const openPath = async (p: string): Promise<void> => {
    try {
      if (!(await api.openPath(p))) toast(t('openFail'), 'warn')
    } catch (e) {
      toast(errMsg(e), 'err')
    }
  }

  const start = async (): Promise<void> => {
    if (running || !plan || plan.error || !plan.items.length) return
    setRunning(true)
    setCanceling(false)
    setProgress({ projectRel: project.rel, phase: 'running', done: 0, total: plan.totalFiles, current: '' })
    try {
      const r = await api.run(project.rel, opts)
      if (r.planError) toast(t(`err.${r.planError}`), 'err')
      else {
        setResult(r)
        onExported?.(r)
      }
    } catch (e) {
      toast(errMsg(e), 'err')
    } finally {
      setRunning(false)
      setProgress(null)
    }
  }

  const cancel = async (): Promise<void> => {
    setCanceling(true)
    try {
      await api.cancel(project.rel)
    } catch (e) {
      toast(errMsg(e), 'err')
    }
  }

  const again = (): void => {
    setResult(null)
    setTick((n) => n + 1)
  }

  const tree = useMemo(() => (plan ? buildTree(plan) : { rows: [], more: 0 }), [plan])
  const counts = plan?.skippedCounts
  const ready = plan?.items.length ?? 0
  const other = counts ? OTHER_REASONS.reduce((n, r) => n + counts[r], 0) : 0
  const outName = plan ? lastSeg(plan.outDir) : 'output'
  const sp = plan ? sepOf(plan.outDir) : '\\'
  const backupShort = plan ? `${outName}${sp}${BACKUP_DIR}${sp}${plan.backupStamp}${sp}` : ''
  const pct = progress && progress.total ? Math.round((progress.done / progress.total) * 100) : 0
  const blocked = !plan || !!plan.error || !ready || loading

  if (result) {
    const resSep = sepOf(result.outDir)
    const bk = result.backupDir ? `${lastSeg(result.outDir)}${resSep}${BACKUP_DIR}${resSep}${lastSeg(result.backupDir)}${resSep}` : ''
    return (
      <div className="ex-wrap">
        <motion.div className="card-s ex-success" initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.32, ease: EASE }}>
          <div className={result.ok ? 'ex-big ok' : 'ex-big warn'}>
            <Icon name={result.ok ? 'check' : 'alert'} size={36} />
          </div>
          <h2>{result.canceled ? t('done.canceled', { count: result.written }) : result.ok ? t('done.title', { count: result.exportedAssets }) : t('done.failed')}</h2>
          <p>
            {t('done.sub')} · <span className="mono" title={result.outDir}>{result.outDir}</span>
          </p>
          <p className="ex-res-chips">
            <span className="chip c-green">
              <Icon name="check" size={11} />
              {t('done.files', { count: result.written })}
            </span>
            {result.keptExisting > 0 && <span className="chip c-gray">{t('done.kept', { count: result.keptExisting })}</span>}
            {result.errors.length > 0 && (
              <span className="chip c-red">
                <Icon name="alert" size={11} />
                {t('done.errors', { count: result.errors.length })}
              </span>
            )}
          </p>
          {result.backupDir && (
            <p>
              {t('done.backup', { count: result.backedUp })} <span className="mono" title={result.backupDir}>{bk}</span>
            </p>
          )}
          {result.errors.length > 0 && (
            <ul className="ex-errs">
              {result.errors.slice(0, 8).map((e) => (
                <li key={e.rel}>
                  <span className="mono">{e.rel}</span> — {e.message}
                </li>
              ))}
            </ul>
          )}
          {result.reportPath && <p className="muted ex-report">{t('done.report', { path: result.reportPath })}</p>}
          <div className="ex-row">
            <button type="button" className="btn primary" onClick={() => void openPath(result.outDir)}>
              <Icon name="folder" size={14} />
              {t('openOut')}
            </button>
            <button type="button" className="btn" onClick={again}>
              <Icon name="refresh" size={14} />
              {t('again')}
            </button>
            {onHome && (
              <button type="button" className="btn ghost" onClick={onHome}>
                {t('toWorkspace')}
              </button>
            )}
          </div>
        </motion.div>
      </div>
    )
  }

  return (
    <div className="ex-wrap">
      <motion.div className="card-s" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE }}>
        <h2 className="ex-title">{t('title')}</h2>
        <p className="muted ex-desc">{opts.onlyApproved ? t('desc') : t('descAll')}</p>

        <div className="ex-stats">
          <div className="ex-stat g">
            <b>{plan ? ready : '–'}</b>
            <span>{opts.onlyApproved ? t('stat.readyApproved') : t('stat.ready')}</span>
          </div>
          <div className="ex-stat o">
            <b>{counts ? counts.notApproved : '–'}</b>
            <span>{t('stat.notApproved')}</span>
          </div>
          <div className="ex-stat">
            <b>{counts ? counts.notGrouped : '–'}</b>
            <span>{t('stat.notGrouped')}</span>
          </div>
          <div className="ex-stat">
            <b>{counts ? other : '–'}</b>
            <span>{t('stat.other')}</span>
          </div>
        </div>

        {plan && plan.skipped.length > 0 && (
          <div className="ex-skip">
            <button type="button" className="ex-skip-t" aria-expanded={showSkipped} onClick={() => setShowSkipped((v) => !v)}>
              <Icon name="chev" size={12} className={showSkipped ? 'ex-chev open' : 'ex-chev'} />
              {showSkipped ? t('skippedHide') : t('skippedShow', { count: plan.skipped.length })}
            </button>
            <AnimatePresence initial={false}>
              {showSkipped && (
                <motion.div className="ex-skip-list" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={fadeTransition}>
                  {plan.skipped.map((s) => (
                    <div className="ex-skip-row" key={s.id} title={s.detail ?? s.rel}>
                      <span className="mono ex-skip-rel">{s.rel}</span>
                      <span className={s.reason === 'notApproved' ? 'chip c-orange' : s.reason === 'sizeMismatch' || s.reason === 'missingFile' ? 'chip c-red' : 'chip c-gray'}>{t(`reason.${s.reason}`)}</span>
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        <div className="gkv">
          <label>{t('dest')}</label>
          <div className="val">
            <span className="ex-path" title={plan?.outDir ?? ''}>
              {plan?.outDir ?? opts.outDir}
            </span>
            <button type="button" className="btn sm" onClick={() => void pick()} disabled={running}>
              {t('change')}
            </button>
            {opts.outDir && (
              <button type="button" className="btn sm ghost" onClick={() => patch({ outDir: '' })} disabled={running}>
                {t('reset')}
              </button>
            )}
          </div>
        </div>

        <div className="gkv">
          <label>{t('size')}</label>
          <div className="val">
            <div className="seg" role="group">
              {EXPORT_SCALES.map((s) => (
                <button type="button" key={s} aria-pressed={opts.scales.includes(s)} className={opts.scales.includes(s) ? 'on' : undefined} onClick={() => toggleScale(s)} disabled={running}>
                  ×{s}
                </button>
              ))}
            </div>
            <span className="muted">{!opts.scales.length ? t('needScale') : opts.scales.some((s) => s !== 1) ? t('scaleResize') : t('scaleExact')}</span>
          </div>
        </div>

        {opts.scales.some((s) => s !== 1) && (
          <div className="gkv">
            <label>{t('layout')}</label>
            <div className="val">
              <div className="seg" role="radiogroup">
                <button type="button" role="radio" aria-checked={opts.scaleLayout === 'folder'} className={opts.scaleLayout === 'folder' ? 'on' : undefined} onClick={() => patch({ scaleLayout: 'folder' })} disabled={running}>
                  {t('layoutFolder')}
                </button>
                <button type="button" role="radio" aria-checked={opts.scaleLayout === 'suffix'} className={opts.scaleLayout === 'suffix' ? 'on' : undefined} onClick={() => patch({ scaleLayout: 'suffix' })} disabled={running}>
                  {t('layoutSuffix')}
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="gkv">
          <label>{t('format')}</label>
          <div className="val">{t('formatVal')}</div>
        </div>

        <div className="gkv">
          <label>{t('existing')}</label>
          <div className="val">
            {plan && plan.conflicts > 0 ? (
              <>
                <span className="chip c-orange">
                  <Icon name="alert" size={11} />
                  {plan.conflicts}
                </span>
                <div className="seg" role="radiogroup">
                  <button type="button" role="radio" aria-checked={opts.conflict === 'backup'} className={opts.conflict === 'backup' ? 'on' : undefined} onClick={() => patch({ conflict: 'backup' })} disabled={running}>
                    {t('policyBackup')}
                  </button>
                  <button type="button" role="radio" aria-checked={opts.conflict === 'skip'} className={opts.conflict === 'skip' ? 'on' : undefined} onClick={() => patch({ conflict: 'skip' })} disabled={running}>
                    {t('policySkip')}
                  </button>
                </div>
                <span className="muted ex-hint">
                  {opts.conflict === 'backup' ? (
                    <>
                      {t('backupPre')} <span className="mono" title={plan.backupDir}>{backupShort}</span> {t('backupPost')}
                    </>
                  ) : (
                    t('skipHint')
                  )}
                </span>
              </>
            ) : (
              <span className="muted">{t('existingNone')}</span>
            )}
          </div>
        </div>

        <div className="gkv">
          <label>{t('options')}</label>
          <div className="val">
            <label className="pk-check">
              <input type="checkbox" checked={opts.onlyApproved} onChange={(e) => patch({ onlyApproved: e.target.checked })} disabled={running} />
              {t('onlyApproved')}
            </label>
            <label className="pk-check">
              <input type="checkbox" checked={opts.openFolderWhenDone} onChange={(e) => patch({ openFolderWhenDone: e.target.checked })} disabled={running} />
              {t('openWhenDone')}
            </label>
          </div>
        </div>

        {plan?.error && (
          <div className="note err ex-note">
            <Icon name="alert" size={14} />
            {t(`err.${plan.error}`)}
          </div>
        )}

        <div className="ex-actions">
          {running ? (
            <>
              <div className="bar big ex-bar">
                <i style={{ width: `${pct}%` }} />
              </div>
              <span className="muted ex-count">{t('progress', { done: progress?.done ?? 0, total: progress?.total ?? plan?.totalFiles ?? 0 })}</span>
              <button type="button" className="btn" onClick={() => void cancel()} disabled={canceling}>
                <Icon name="x" size={14} />
                {canceling ? t('canceling') : t('cancel')}
              </button>
            </>
          ) : (
            <>
              {onBack && (
                <button type="button" className="btn" onClick={onBack}>
                  <Icon name="left" size={14} />
                  {t('back')}
                </button>
              )}
              <button type="button" className="btn primary lg" onClick={() => void start()} disabled={blocked}>
                <Icon name="download" size={15} />
                {t('run', { count: ready })}
              </button>
            </>
          )}
        </div>
        {running && progress?.current && (
          <p className="muted mono ex-current" title={progress.current}>
            {progress.current}
          </p>
        )}
      </motion.div>

      <motion.div className="card-s ex-tree-card" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE, delay: 0.05 }}>
        <div className="sec-h">
          <h3>{t('tree')}</h3>
          <span className="muted">{loading && !plan ? t('loading') : t('treeHint')}</span>
        </div>
        <div className={loading ? 'ex-tree dim' : 'ex-tree'}>
          <div style={{ ['--d' as string]: 0 }} className="f">
            <Icon name="folder" size={14} />
            {outName}
          </div>
          {tree.rows.map((r) => (
            <div key={r.key} style={{ ['--d' as string]: r.depth }} className={r.folder ? 'f' : undefined}>
              <Icon name={r.folder ? 'folder' : 'file'} size={r.folder ? 14 : 13} />
              <span className="ex-name">{r.name}</span>
              {r.file?.exists && <span className="chip c-orange ex-exists">{t('exists')}</span>}
              {r.file && (
                <span className="sz">
                  {r.file.w}×{r.file.h}
                </span>
              )}
            </div>
          ))}
          {tree.more > 0 && <div className="ex-more muted">{t('more', { count: tree.more })}</div>}
          {plan && !plan.items.length && <div className="ex-more muted">{t('treeEmpty')}</div>}
        </div>
      </motion.div>
    </div>
  )
}
