import { useEffect, useMemo, type ReactElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import type { QueueJob } from '@shared/queue'
import type { RateWindow as RateWindowLike } from '@shared/types'
import { useApp } from '@renderer/store/app'
import { useEnv } from '@renderer/store/env'
import { isActive, projectName, samePath, useQueue } from '@renderer/store/queue'
import { useWs } from '@renderer/store/workspace'
import { formatReset, tDyn } from '@renderer/lib/env'
import { EASE, sheetTransition } from '@renderer/lib/motion'
import { Icon } from './Icon'
import { QuotaBanner } from './QuotaBanner'
import { Stepper } from './Stepper'
import { StageDots, stageText } from './JobBits'

interface ProjectGroup {
  path: string
  jobs: QueueJob[]
}

function QuotaLine({ label, w }: { label: string; w: RateWindowLike | null }): ReactElement {
  const { t } = useTranslation()
  const lang = useApp((s) => s.settings.lang)
  const left = w ? Math.max(0, Math.min(100, Math.round(100 - w.usedPercent))) : null
  const reset = formatReset(w?.resetsAt ?? null, lang)
  return (
    <div className="qline" title={reset ? (reset.relative ? t('account.resetsIn', { t: reset.text }) : t('account.resetsAt', { t: reset.text })) : undefined}>
      <span className="ql-l">{label}</span>
      <div className={left !== null && left < 25 ? 'bar low' : 'bar green'}>
        <i style={{ width: `${left ?? 0}%` }} />
      </div>
      <b>{left !== null ? t('account.left', { n: left }) : '—'}</b>
    </div>
  )
}

export function QueueDrawer(): ReactElement {
  const { t } = useTranslation()
  const open = useQueue((s) => s.drawer)
  const setDrawer = useQueue((s) => s.setDrawer)
  const snap = useQueue((s) => s.snap)
  const rl = useEnv((s) => s.rateLimits)
  const account = useEnv((s) => s.account)
  const conc = useApp((s) => s.settings.gen.concurrency)
  const ws = useWs((s) => s.snap)
  const openProject = useWs((s) => s.openProject)
  const setStep = useWs((s) => s.setStep)

  useEffect(() => {
    if (!open) return
    if (account?.loggedIn) void window.gas.account.rateLimits()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !document.querySelector('.modal-root')) setDrawer(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, setDrawer, account?.loggedIn])

  const groups = useMemo(() => {
    const map = new Map<string, ProjectGroup>()
    for (const j of snap?.jobs ?? []) {
      const k = j.projectPath.toLowerCase()
      if (!map.has(k)) map.set(k, { path: j.projectPath, jobs: [] })
      map.get(k)?.jobs.push(j)
    }
    return [...map.values()].sort((a, b) => Number(b.jobs.some(isActive)) - Number(a.jobs.some(isActive)))
  }, [snap])

  const goProject = async (path: string): Promise<void> => {
    if (!ws?.root) return
    const p = ws.projects.find((x) => samePath(`${ws.root}\\${x.rel.split('/').join('\\')}`, path))
    if (!p) return
    setDrawer(false)
    await openProject(p.rel)
    setStep(3)
  }

  const paused = !!snap?.paused

  return (
    <AnimatePresence>
      {open && (
        <motion.aside
          key="drawer"
          className="drawer"
          role="dialog"
          aria-label={t('queue.title')}
          initial={{ x: 400, opacity: 0.6 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: 400, opacity: 0, transition: { duration: 0.22, ease: EASE } }}
          transition={sheetTransition}
        >
          <header>
            <Icon name="queue" />
            <h2>{t('queue.title')}</h2>
            <div className="grow" />
            {snap && (snap.running > 0 || snap.queued > 0 || paused) && (
              <button type="button" className="btn sm" onClick={() => void (paused ? window.gas.queue.resume() : window.gas.queue.pause())}>
                <Icon name={paused ? 'play' : 'pause'} size={12} />
                {paused ? t('queue.resumeAll') : t('queue.pauseAll')}
              </button>
            )}
            <button type="button" className="icon-btn" aria-label={t('settings.close')} onClick={() => setDrawer(false)}>
              <Icon name="x" />
            </button>
          </header>
          <div className="dr-b">
            <QuotaBanner compact />
            <div className="qcard">
              <div className="qh">
                <Icon name="clock" size={14} />
                <b>
                  {t('queue.quota')}
                  {rl?.planType || account?.planType ? ` · ${rl?.planType ?? account?.planType}` : ''}
                </b>
              </div>
              <QuotaLine label="5h" w={rl?.primary ?? null} />
              <QuotaLine label={t('queue.week')} w={rl?.secondary ?? null} />
            </div>
            <div className="dr-lbl">
              <span>{t('queue.runningLabel', { n: snap?.running ?? 0, conc })}</span>
              <div className="grow" />
              <Stepper value={conc} min={1} max={6} label={t('gen.parallel')} onChange={(v) => void window.gas.settings.set({ gen: { concurrency: v } })} />
            </div>
            <AnimatePresence initial={false}>
              {groups.map((g) => {
                const total = g.jobs.length
                const fin = g.jobs.filter((j) => !isActive(j)).length
                const act = g.jobs.filter(isActive)
                const run = g.jobs.filter((j) => j.status === 'running' || j.status === 'processing')
                const projPaused = act.length > 0 && act.every((j) => j.status === 'paused')
                const errs = g.jobs.filter((j) => j.status === 'error').length
                const dot = !act.length ? (errs ? 'err' : '') : projPaused || paused ? 'warn' : 'run'
                return (
                  <motion.div layout key={g.path} className="qcard" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.24, ease: EASE }}>
                    <div className="qh">
                      <span className={dot ? `dot ${dot}` : 'dot idle'} />
                      <button type="button" className="qname" title={g.path} onClick={() => void goProject(g.path)}>
                        {projectName(g.path)}
                      </button>
                      {act.length > 0 && (
                        <>
                          <button
                            type="button"
                            className="icon-btn"
                            aria-label={projPaused ? t('gen.resume') : t('gen.pause')}
                            title={projPaused ? t('gen.resume') : t('gen.pause')}
                            onClick={() => void (projPaused ? window.gas.queue.resumeProject(g.path) : window.gas.queue.pauseProject(g.path))}
                          >
                            <Icon name={projPaused ? 'play' : 'pause'} size={14} />
                          </button>
                          <button type="button" className="icon-btn" aria-label={t('gen.cancelRest')} title={t('gen.cancelRest')} onClick={() => void window.gas.queue.cancelAll(g.path)}>
                            <Icon name="x" size={14} />
                          </button>
                        </>
                      )}
                      {!act.length && (
                        <button type="button" className="icon-btn" aria-label={t('queue.clear')} title={t('queue.clear')} onClick={() => void window.gas.queue.clearFinished(g.path)}>
                          <Icon name="trash" size={14} />
                        </button>
                      )}
                    </div>
                    <div className="qm">
                      {t('queue.progress', { done: fin, total })}
                      {act.length > 0 && projPaused && ` · ${t('gen.status.paused')}`}
                      {act.length > 0 && !projPaused && snap?.pauseReason === 'quota' && ` · ${t('queue.waitQuota')}`}
                      {!act.length && ` · ${t('queue.allDone')}`}
                      {errs > 0 && ` · ${t('queue.errors', { count: errs })}`}
                    </div>
                    <div className={act.length ? 'bar' : 'bar green'}>
                      <i style={{ width: `${total ? (fin / total) * 100 : 0}%` }} />
                    </div>
                    {run.length > 0 && (
                      <div className="qjobs">
                        {run.slice(0, 4).map((j) => (
                          <div className="qjob" key={j.id}>
                            <span className="qj-n">{j.assetRelPath.split('/').pop()}</span>
                            <StageDots job={j} />
                            <span className="qj-s">{stageText(j, (k) => tDyn(t, k))}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </motion.div>
                )
              })}
            </AnimatePresence>
            {!groups.length && (
              <div className="dr-empty">
                <Icon name="queue" size={26} />
                <p className="muted">{t('queue.empty')}</p>
              </div>
            )}
          </div>
          {groups.some((g) => g.jobs.some((j) => !isActive(j))) && (
            <footer className="dr-f">
              <button type="button" className="btn sm ghost" onClick={() => void window.gas.queue.clearFinished()}>
                <Icon name="trash" size={12} />
                {t('queue.clearAll')}
              </button>
            </footer>
          )}
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
