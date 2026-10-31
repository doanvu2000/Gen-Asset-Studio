import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { QueueJob } from '@shared/queue'
import type { SpineProjectView, SpineRegionView } from '@shared/spine'
import { Icon } from '@renderer/components/Icon'
import { Segmented } from '@renderer/components/Segmented'
import { regionJob, regionQaFail, regionState, type RegionState } from '@renderer/lib/spine'
import { isActive, samePath, useQueue } from '@renderer/store/queue'
import { useSpine } from '@renderer/store/spine'

type Scope = 'todo' | 'all' | 'picked'

const STATE_CHIP: Record<RegionState, string> = { none: 'c-gray', queued: 'c-gray', running: 'c-blue', error: 'c-red', done: 'c-green' }

function StateChip({ r, state, job }: { r: SpineRegionView; state: RegionState; job: QueueJob | null }): ReactElement {
  const { t } = useTranslation()
  if (state === 'running') {
    return (
      <span className="chip c-blue" title={job?.progress}>
        <span className="spin sm" />
        {t(`spriteProject.gen.step.${job?.step ?? 'waiting'}`)}
      </span>
    )
  }
  if (state === 'done') {
    const warn = regionQaFail(r)
    return (
      <span className={warn ? 'chip c-orange' : 'chip c-green'}>
        <Icon name={warn ? 'alert' : 'check'} size={10} />
        {t('spriteProject.gen.doneV', { v: r.selected })}
        {warn ? ` · ${t('spriteProject.gen.qaWarn')}` : ''}
      </span>
    )
  }
  return <span className={`chip ${STATE_CHIP[state]}`}>{t(`spriteProject.gen.state.${state}`)}</span>
}

export function SpineGenStep({ v }: { v: SpineProjectView }): ReactElement {
  const { t } = useTranslation()
  const enqueue = useSpine((s) => s.enqueue)
  const setStep = useSpine((s) => s.setStep)
  const snap = useQueue((s) => s.snap)
  const jobs = useMemo(() => snap?.jobs ?? [], [snap])
  const [scope, setScope] = useState<Scope>('todo')
  const [picked, setPicked] = useState<Set<string>>(new Set())

  const used = v.regions.filter((r) => r.used)
  const busyKeys = new Set(v.regions.filter((r) => ['queued', 'running'].includes(regionState(r, regionJob(v, r, jobs)))).map((r) => r.key))
  const targets = (scope === 'todo' ? used.filter((r) => !r.versions.length) : scope === 'all' ? used : v.regions.filter((r) => picked.has(r.key))).filter((r) => !busyKeys.has(r.key))
  const projJobs = jobs.filter((j) => samePath(j.projectPath, v.dir))
  const active = projJobs.filter(isActive)
  const paused = !!snap?.paused
  const done = used.filter((r) => r.versions.length > 0).length
  const pages = useMemo(() => [...new Set(v.regions.map((r) => r.page))], [v.regions])

  const toggle = (key: string): void => {
    const next = new Set(picked)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    setPicked(next)
    if (next.size) setScope('picked')
  }

  return (
    <div className="sgn-wrap">
      <div className="toolbar">
        <Segmented<Scope>
          value={scope}
          ariaLabel={t('spineProject.gen.scope')}
          onChange={setScope}
          options={[
            { value: 'todo', label: t('spineProject.gen.scopeTodo') },
            { value: 'all', label: t('spineProject.gen.scopeAll') },
            { value: 'picked', label: t('spineProject.gen.scopePicked', { count: picked.size }) }
          ]}
        />
        <button type="button" className="btn primary sm" disabled={!targets.length} onClick={() => void enqueue(targets.map((r) => r.key)).then((n) => n > 0 && setPicked(new Set()))}>
          <Icon name="sparkles" size={13} />
          {t('spineProject.gen.go', { count: targets.length })}
        </button>
        <span className="muted">{t('spineProject.gen.estimate', { count: targets.length })}</span>
        <div className="grow" />
        <span className="muted">{t('spineProject.gen.progress', { done, total: used.length })}</span>
        {active.length > 0 && (
          <>
            <span className="chip c-blue">
              <span className="spin sm" />
              {t('spriteProject.gen.active', { count: active.length })}
            </span>
            <button type="button" className="btn sm" onClick={() => void (paused ? window.gas.queue.resume() : window.gas.queue.pause())}>
              <Icon name={paused ? 'play' : 'pause'} size={13} />
              {paused ? t('spriteProject.gen.resume') : t('spriteProject.gen.pause')}
            </button>
            <button type="button" className="btn ghost sm danger" onClick={() => void window.gas.queue.cancelAll(v.dir)}>
              <Icon name="x" size={13} />
              {t('spriteProject.gen.cancel')}
            </button>
          </>
        )}
        <button type="button" className="btn sm" disabled={!done} onClick={() => setStep(5)}>
          {t('spineProject.gen.toRig')}
          <Icon name="right" size={13} />
        </button>
      </div>
      <div className="sgn-list">
        {pages.map((p) => (
          <section key={p} className="spg-sheet">
            <h4>
              <Icon name="image" size={13} />
              {p}
            </h4>
            {v.regions
              .filter((r) => r.page === p)
              .map((r) => {
                const job = regionJob(v, r, jobs)
                const state = regionState(r, job)
                return (
                  <div key={r.key} className={['spg-row', !r.used && 'unused'].filter(Boolean).join(' ')}>
                    <input type="checkbox" checked={picked.has(r.key)} onChange={() => toggle(r.key)} aria-label={r.name} />
                    <div className="spg-pv ck sm">{r.sourceUrl ? <img src={r.sourceUrl} alt="" draggable={false} /> : null}</div>
                    <Icon name="right" size={12} />
                    <div className="spg-pv ck sm">{r.url ? <img src={r.url} alt="" draggable={false} /> : <Icon name="sparkles" size={14} />}</div>
                    <div className="spg-name">
                      <b>{r.name}</b>
                      <small>
                        {r.w}×{r.h} · {r.slots.join(', ') || t('spineProject.regions.unused')}
                      </small>
                    </div>
                    <StateChip r={r} state={state} job={job} />
                    {r.decision && <span className={r.decision === 'approved' ? 'chip c-green' : 'chip c-orange'}>{t(`spriteProject.review.decision.${r.decision}`)}</span>}
                    <div className="grow" />
                    {state === 'error' && job?.error && (
                      <span className="spg-err" title={job.error.message}>
                        {job.error.message}
                      </span>
                    )}
                    {state === 'error' && job && (
                      <button type="button" className="btn sm" onClick={() => void window.gas.queue.retry(job.id)}>
                        <Icon name="refresh" size={13} />
                        {t('spriteProject.gen.retry')}
                      </button>
                    )}
                    {(state === 'none' || state === 'done') && (
                      <button type="button" className={state === 'none' ? 'btn sm' : 'btn ghost sm'} onClick={() => void enqueue([r.key])}>
                        <Icon name={state === 'none' ? 'sparkles' : 'refresh'} size={13} />
                        {state === 'none' ? t('spriteProject.gen.gen') : t('spriteProject.gen.regen')}
                      </button>
                    )}
                    {(state === 'queued' || state === 'running') && job && (
                      <button type="button" className="btn ghost sm" onClick={() => void window.gas.queue.cancel(job.id)}>
                        <Icon name="x" size={13} />
                        {t('spriteProject.gen.cancelOne')}
                      </button>
                    )}
                  </div>
                )
              })}
          </section>
        ))}
      </div>
    </div>
  )
}
