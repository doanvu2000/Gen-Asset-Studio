import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import type { JobSpec, QueueJob } from '@shared/queue'
import type { StyleGroup } from '@shared/style'
import type { InputView, ProjectView } from '@shared/workspace'
import { Icon } from '@renderer/components/Icon'
import { ModelChip } from '@renderer/components/ModelChip'
import { Stepper } from '@renderer/components/Stepper'
import { QuotaBanner } from '@renderer/components/QuotaBanner'
import { StageDots, StatusChip, jobPct, stageText } from '@renderer/components/JobBits'
import { EASE, fadeTransition } from '@renderer/lib/motion'
import { errMsg, fileUrl, projAbs } from '@renderer/lib/files'
import { tDyn } from '@renderer/lib/env'
import { gennable, groupOf, isLocked } from '@renderer/lib/project'
import { useApp } from '@renderer/store/app'
import { useEnv } from '@renderer/store/env'
import { isActive, samePath, useQueue } from '@renderer/store/queue'
import { useWs } from '@renderer/store/workspace'
import { toast } from '@renderer/store/toast'

const SEC_PER_IMAGE = 30

function minutes(count: number, conc: number): number {
  return Math.max(1, Math.ceil((count * SEC_PER_IMAGE) / Math.max(1, conc) / 60))
}

function GenConfig({ project }: { project: ProjectView }): ReactElement {
  const { t } = useTranslation()
  const setStep = useWs((s) => s.setStep)
  const setActiveGroup = useWs((s) => s.setActiveGroup)
  const flushGroups = useWs((s) => s.flushGroups)
  const conc = useApp((s) => s.settings.gen.concurrency)
  const rl = useEnv((s) => s.rateLimits)
  const all = useMemo(() => gennable(project), [project])
  const fresh = useMemo(() => new Set(all.filter((x) => x.input.versions.length === 0).map((x) => x.input.id)), [all])
  const [sel, setSel] = useState<Set<string>>(() => new Set(fresh.size ? fresh : all.map((x) => x.input.id)))
  const [scope, setScope] = useState<'new' | 'all' | 'custom'>(fresh.size ? 'new' : 'all')
  const [starting, setStarting] = useState(false)
  const owner = useMemo(() => groupOf(project), [project])
  const locked = project.groups.filter((g) => isLocked(g) && g.assetIds.length)
  const notLocked = project.groups.filter((g) => !isLocked(g) && g.assetIds.length)
  const ungrouped = project.inputs.filter((i) => i.type !== 'sprite' && !owner.has(i.id)).length
  const count = all.filter((x) => sel.has(x.input.id)).length
  const left5 = rl?.primary ? Math.max(0, Math.round(100 - rl.primary.usedPercent)) : null

  const setScopeTo = (s: 'new' | 'all'): void => {
    setScope(s)
    setSel(new Set(s === 'new' ? fresh : all.map((x) => x.input.id)))
  }

  const toggleGroup = (g: StyleGroup): void => {
    const ids = all.filter((x) => x.group.id === g.id).map((x) => x.input.id)
    const on = ids.every((id) => sel.has(id))
    const next = new Set(sel)
    for (const id of ids) {
      if (on) next.delete(id)
      else next.add(id)
    }
    setSel(next)
    setScope('custom')
  }

  const toggleAsset = (id: string): void => {
    const next = new Set(sel)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSel(next)
    setScope('custom')
  }

  const start = async (): Promise<void> => {
    if (!count || starting) return
    setStarting(true)
    try {
      await flushGroups()
      const specs: JobSpec[] = all
        .filter((x) => sel.has(x.input.id))
        .map(({ input, group }) => ({
          projectPath: project.dir,
          assetRelPath: input.outRel,
          sourcePath: input.abs,
          groupId: group.id,
          stylePrompt: group.promptEn,
          styleImages: group.lockImage ? [projAbs(project.dir, group.lockImage)] : [],
          refImages: group.refImages.map((r) => projAbs(project.dir, r)),
          nineSlice: input.type === 'nine'
        }))
      await window.gas.queue.clearFinished(project.dir)
      const ids = await window.gas.queue.enqueue(specs)
      toast(t('gen.enqueued', { count: ids.length }))
    } catch (e) {
      toast(errMsg(e), 'err')
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="gen-wrap">
      <QuotaBanner />
      <div className="gen-cfg">
        <motion.div className="card-s" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE }}>
          <h2 className="gc-title">{t('gen.title')}</h2>
          <p className="muted gc-desc">{t('gen.desc')}</p>
          <div className="gkv">
            <label>{t('gen.scope')}</label>
            <div className="val">
              <div className="seg" role="radiogroup">
                <button type="button" role="radio" aria-checked={scope === 'new'} className={scope === 'new' ? 'on' : undefined} onClick={() => setScopeTo('new')}>
                  {t('gen.scopeNew', { count: fresh.size })}
                </button>
                <button type="button" role="radio" aria-checked={scope === 'all'} className={scope === 'all' ? 'on' : undefined} onClick={() => setScopeTo('all')}>
                  {t('gen.scopeAll', { count: all.length })}
                </button>
                {scope === 'custom' && (
                  <button type="button" role="radio" aria-checked className="on">
                    {t('gen.scopeCustom')}
                  </button>
                )}
              </div>
            </div>
          </div>
          <div className="gkv">
            <label>{t('gen.parallel')}</label>
            <div className="val">
              <Stepper value={conc} min={1} max={6} label={t('gen.parallel')} onChange={(v) => void window.gas.settings.set({ gen: { concurrency: v } })} />
              <span className="muted">{t('gen.parallelHint')}</span>
            </div>
          </div>
          <div className="gkv">
            <label>Model</label>
            <div className="val">
              <ModelChip task="assetGen" />
              <span className="muted">{t('gen.modelNote')}</span>
            </div>
          </div>
          <div className="gkv">
            <label>{t('gen.estimate')}</label>
            <div className="val">
              <b>{t('gen.estCount', { count })}</b>
              <span className="muted">
                · ~{t('gen.estMin', { count: minutes(count, conc) })}
                {left5 !== null && ` · ${t('gen.quotaLeft', { left: left5 })}`}
              </span>
              {left5 !== null &&
                (left5 >= 25 ? (
                  <span className="chip c-green">
                    <Icon name="check" size={11} />
                    {t('gen.quotaOk')}
                  </span>
                ) : (
                  <span className="chip c-orange">
                    <Icon name="alert" size={11} />
                    {t('gen.quotaLow')}
                  </span>
                ))}
            </div>
          </div>
          <div className="gkv">
            <label>{t('gen.outOfQuota')}</label>
            <div className="val muted">{t('gen.outOfQuotaDesc')}</div>
          </div>
        </motion.div>

        <motion.div className="card-s" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.28, ease: EASE, delay: 0.05 }}>
          <h3 className="gc-sub">{t('gen.groups')}</h3>
          <div className="glock-list">
            {locked.map((g) => {
              const items = all.filter((x) => x.group.id === g.id)
              const on = items.filter((x) => sel.has(x.input.id)).length
              return (
                <div className="glock" key={g.id}>
                  <div className="glock-h">
                    <label className="pk-check">
                      <input type="checkbox" checked={on === items.length && items.length > 0} ref={(el) => {
                        if (el) el.indeterminate = on > 0 && on < items.length
                      }} onChange={() => toggleGroup(g)} />
                    </label>
                    <span className="mini ck">{g.lockImage && <img src={fileUrl(projAbs(project.dir, g.lockImage), g.lockedAt ?? 0)} alt="" draggable={false} />}</span>
                    <div className="gl-t">
                      <b>{g.name}</b>
                      <span className="muted">
                        {g.lockName || t('style.locked')} · {t('gen.selOf', { on, total: items.length })}
                      </span>
                    </div>
                    <Icon name="lock" size={14} />
                  </div>
                  <div className="gl-assets">
                    {items.map(({ input }) => (
                      <AssetToggle key={input.id} input={input} on={sel.has(input.id)} onToggle={() => toggleAsset(input.id)} />
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
          {notLocked.map((g) => (
            <div className="note warn gc-note" key={g.id}>
              <Icon name="alert" size={14} />
              <span className="note-t">{t('gen.notLocked', { name: g.name })}</span>
              <button
                type="button"
                className="btn sm"
                onClick={() => {
                  setActiveGroup(g.id)
                  setStep(2)
                }}
              >
                {t('gen.lockIt')}
              </button>
            </div>
          ))}
          {ungrouped > 0 && (
            <div className="note info gc-note">
              <Icon name="alert" size={14} />
              <span className="note-t">{t('gen.ungrouped', { count: ungrouped })}</span>
            </div>
          )}
        </motion.div>

        <div className="gc-acts">
          <button type="button" className="btn" onClick={() => setStep(2)}>
            <Icon name="left" size={14} />
            {t('project.steps.style')}
          </button>
          <button type="button" className="btn primary lg" data-coach="gen-start" disabled={!count || starting} onClick={() => void start()}>
            {starting ? <span className="spin" /> : <Icon name="sparkles" size={15} />}
            {t('gen.start', { count })}
          </button>
        </div>
      </div>
    </div>
  )
}

function AssetToggle({ input, on, onToggle }: { input: InputView; on: boolean; onToggle: () => void }): ReactElement {
  const { t } = useTranslation()
  return (
    <button type="button" className={on ? 'at on' : 'at'} onClick={onToggle} aria-pressed={on} title={input.outRel}>
      <span className="at-img ck">{input.thumb && <img src={input.thumb} alt="" draggable={false} />}</span>
      <span className="at-n">{input.name}</span>
      {input.versions.length > 0 && <span className="at-v">v{input.versions[input.versions.length - 1]}</span>}
      {input.versions.length === 0 && <span className="at-new">{t('gen.new')}</span>}
    </button>
  )
}

function JobRow({ job, input, index }: { job: QueueJob; input: InputView | undefined; index: number }): ReactElement {
  const { t } = useTranslation()
  const fixAvailable = useEnv((s) => s.fixAvailable)
  const openFix = useEnv((s) => s.openFix)
  const name = job.assetRelPath.split('/').pop() ?? job.assetRelPath
  const dir = job.assetRelPath.includes('/') ? job.assetRelPath.slice(0, job.assetRelPath.lastIndexOf('/')) : ''
  const out = job.result ? fileUrl(job.result.versionPath, job.result.version) : null
  const thumb = out ?? input?.thumb ?? null
  const qaFail = job.status === 'qaWarn' ? job.result?.qa.checks.find((c) => c.status !== 'pass') : undefined
  const errText = job.error ? `${job.error.code}: ${job.error.message}` : ''
  const running = job.status === 'running' || job.status === 'processing'

  return (
    <motion.div className={`jrow s-${job.status}`} layout="position" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.24, ease: EASE, delay: Math.min(index, 20) * 0.015 }}>
      <div className="jthumb ck">
        <AnimatePresence initial={false} mode="popLayout">
          {thumb && <motion.img key={thumb} src={thumb} alt="" draggable={false} initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.4, ease: EASE }} />}
        </AnimatePresence>
      </div>
      <div className="jinfo">
        <b title={job.assetRelPath}>{name}</b>
        <span>{dir || '—'}</span>
      </div>
      <div className="jstep">
        {job.status === 'error' ? (
          <>
            <span className="jerr" title={errText}>
              {job.error?.message ?? t('gen.status.error')}
            </span>
            <div className="jerr-acts">
              <button type="button" className="btn sm" onClick={() => void window.gas.queue.retry(job.id)}>
                <Icon name="refresh" size={12} />
                {t('gen.retry')}
              </button>
              {fixAvailable && (
                <button type="button" className="btn sm primary" onClick={() => void openFix({ source: 'gen', target: job.id, error: `${errText}\nAsset: ${job.assetRelPath}\nSource: ${job.sourcePath}` })}>
                  <Icon name="sparkles" size={12} />
                  {t('gen.sendFix')}
                </button>
              )}
              <button
                type="button"
                className="btn sm ghost"
                onClick={() => {
                  void navigator.clipboard.writeText(errText)
                  toast(t('gen.copied'), 'info')
                }}
              >
                <Icon name="copy" size={12} />
                {t('gen.copyError')}
              </button>
            </div>
          </>
        ) : (
          <>
            <StageDots job={job} />
            <span className={qaFail ? 'jqa' : undefined}>{qaFail ? qaFail.message || t('gen.status.qaWarn') : stageText(job, (k) => tDyn(t, k))}</span>
          </>
        )}
      </div>
      <div className="jbarc">
        <div className={job.status === 'done' ? 'bar green' : job.status === 'error' ? 'bar err' : job.status === 'qaWarn' ? 'bar warn' : 'bar'}>
          <i style={{ width: `${job.status === 'error' ? Math.max(8, jobPct(job)) : jobPct(job)}%` }} />
        </div>
      </div>
      <div className="jchip">
        <StatusChip status={job.status} />
        {running && (
          <button type="button" className="icon-btn" aria-label={t('gen.cancelOne')} title={t('gen.cancelOne')} onClick={() => void window.gas.queue.cancel(job.id)}>
            <Icon name="x" size={13} />
          </button>
        )}
        {job.status === 'queued' && (
          <button type="button" className="icon-btn" aria-label={t('gen.cancelOne')} title={t('gen.cancelOne')} onClick={() => void window.gas.queue.cancel(job.id)}>
            <Icon name="x" size={13} />
          </button>
        )}
      </div>
    </motion.div>
  )
}

function GenRun({ project, jobs }: { project: ProjectView; jobs: QueueJob[] }): ReactElement {
  const { t } = useTranslation()
  const setStep = useWs((s) => s.setStep)
  const conc = useQueue((s) => s.snap?.concurrency ?? 3)
  const paused = useQueue((s) => !!s.snap?.paused)
  const refreshFix = useEnv((s) => s.refreshFixAvailable)
  const inputsByOut = useMemo(() => new Map(project.inputs.map((i) => [i.outRel, i])), [project.inputs])
  const active = jobs.filter(isActive)
  const finished = jobs.filter((j) => !isActive(j))
  const projPaused = active.length > 0 && active.every((j) => j.status === 'paused')
  const hasPaused = active.some((j) => j.status === 'paused')
  const done = jobs.filter((j) => j.status === 'done').length
  const qa = jobs.filter((j) => j.status === 'qaWarn').length
  const errs = jobs.filter((j) => j.status === 'error').length
  const pct = jobs.length ? jobs.reduce((s, j) => s + (isActive(j) ? jobPct(j) : 100), 0) / jobs.length : 0
  const left = active.length

  useEffect(() => {
    void refreshFix()
  }, [refreshFix])

  return (
    <div className="gen-wrap">
      <QuotaBanner />
      <div className="run-head">
        <div className="rh-t">
          <h2>
            {left ? projPaused || paused ? <Icon name="pause" size={18} /> : <span className="spin" /> : <Icon name="check" size={18} />}
            {left ? t('gen.running', { done: finished.length, total: jobs.length }) : t('gen.finished', { count: jobs.length })}
          </h2>
          <div className={left ? 'bar big' : 'bar big green'}>
            <i style={{ width: `${pct}%` }} />
          </div>
          <div className="rh-meta">
            {left
              ? t('gen.metaRunning', { left, min: minutes(left, conc), conc })
              : t('gen.metaDone', { done, qa, err: errs })}
          </div>
        </div>
        <div className="rh-acts">
          {left > 0 ? (
            <>
              {hasPaused ? (
                <button type="button" className="btn" onClick={() => void window.gas.queue.resumeProject(project.dir)}>
                  <Icon name="play" size={14} />
                  {t('gen.resume')}
                </button>
              ) : (
                <button type="button" className="btn" onClick={() => void window.gas.queue.pauseProject(project.dir)}>
                  <Icon name="pause" size={14} />
                  {t('gen.pause')}
                </button>
              )}
              <button type="button" className="btn danger" onClick={() => void window.gas.queue.cancelAll(project.dir)}>
                <Icon name="x" size={14} />
                {t('gen.cancelRest')}
              </button>
            </>
          ) : (
            <>
              <button type="button" className="btn" onClick={() => void window.gas.queue.clearFinished(project.dir)}>
                <Icon name="refresh" size={14} />
                {t('gen.more')}
              </button>
              <button type="button" className="btn primary" disabled={!done && !qa} onClick={() => setStep(4)}>
                {t('gen.toReview')}
                <Icon name="right" size={14} />
              </button>
            </>
          )}
        </div>
      </div>
      {hasPaused && !projPaused && <div className="note info gc-note">{t('gen.somePaused')}</div>}
      <div className="jlist">
        {jobs.map((j, i) => (
          <JobRow key={j.id} job={j} input={inputsByOut.get(j.assetRelPath)} index={i} />
        ))}
      </div>
    </div>
  )
}

export function GenStep({ project }: { project: ProjectView }): ReactElement {
  const snap = useQueue((s) => s.snap)
  const jobs = useMemo(() => (snap?.jobs ?? []).filter((j) => samePath(j.projectPath, project.dir)), [snap, project.dir])
  return (
    <AnimatePresence mode="wait" initial={false}>
      <motion.div key={jobs.length ? 'run' : 'cfg'} className="gen-host" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={fadeTransition}>
        {jobs.length ? <GenRun project={project} jobs={jobs} /> : <GenConfig project={project} />}
      </motion.div>
    </AnimatePresence>
  )
}
