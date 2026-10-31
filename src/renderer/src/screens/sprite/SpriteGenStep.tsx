import { useMemo, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { QueueJob } from '@shared/queue'
import type { SpriteProjectView, StripView } from '@shared/sprite'
import { Icon } from '@renderer/components/Icon'
import { StripPreview, useClock } from '@renderer/components/sprite/StripPreview'
import { OrigPreview } from '@renderer/components/sprite/OrigPreview'
import { genTargets, jobOf, qaFail, sourceOf, stripLabel, stripState, type StripState } from '@renderer/lib/sprite'
import { isActive, samePath, useQueue } from '@renderer/store/queue'
import { useSprite } from '@renderer/store/sprite'

const STATE_CHIP: Record<StripState, string> = {
  mirror: 'c-purple',
  none: 'c-gray',
  queued: 'c-gray',
  running: 'c-blue',
  error: 'c-red',
  done: 'c-green'
}

function StateChip({ strip, state, job, view }: { strip: StripView; state: StripState; job: QueueJob | null; view: SpriteProjectView }): ReactElement {
  const { t } = useTranslation()
  if (state === 'mirror') {
    const src = sourceOf(view, strip)
    return (
      <span className="chip c-purple">
        <Icon name="refresh" size={10} />
        {t('spriteProject.gen.mirrorOf', { name: stripLabel(src) })}
      </span>
    )
  }
  if (state === 'running') {
    return (
      <span className="chip c-blue" title={job?.progress}>
        <span className="spin sm" />
        {t(`spriteProject.gen.step.${job?.step ?? 'waiting'}`)}
      </span>
    )
  }
  if (state === 'done') {
    const warn = qaFail(strip)
    return (
      <span className={warn ? 'chip c-orange' : 'chip c-green'}>
        <Icon name={warn ? 'alert' : 'check'} size={10} />
        {t('spriteProject.gen.doneV', { v: strip.selected })}
        {warn ? ` · ${t('spriteProject.gen.qaWarn')}` : ''}
      </span>
    )
  }
  return <span className={`chip ${STATE_CHIP[state]}`}>{t(`spriteProject.gen.state.${state}`)}</span>
}

export function SpriteGenStep({ v }: { v: SpriteProjectView }): ReactElement {
  const { t } = useTranslation()
  const enqueue = useSprite((s) => s.enqueue)
  const setLock = useSprite((s) => s.setLock)
  const review = useSprite((s) => s.review)
  const setStep = useSprite((s) => s.setStep)
  const snap = useQueue((s) => s.snap)
  const jobs = useMemo(() => snap?.jobs ?? [], [snap])
  const [pos] = useClock(1000, 8, true)

  const targets = genTargets(v)
  const mirrors = v.strips.filter((s) => s.mirrorOf)
  const lock = v.strips.find((s) => s.key === v.lockKey) ?? null
  const lockJob = lock ? jobOf(v, lock, jobs) : null
  const lockState = lock ? stripState(lock, lockJob) : 'none'
  const lockOk = !!lock && lock.decision === 'approved'
  const projJobs = jobs.filter((j) => samePath(j.projectPath, v.dir))
  const active = projJobs.filter(isActive)
  const paused = !!snap?.paused
  const rest = targets.filter((s) => s.key !== v.lockKey && !s.versions.length && stripState(s, jobOf(v, s, jobs)) !== 'running' && stripState(s, jobOf(v, s, jobs)) !== 'queued')
  const doneCount = targets.filter((s) => s.versions.length > 0).length

  const bySheet = useMemo(() => {
    const m = new Map<string, StripView[]>()
    for (const s of v.strips) {
      const list = m.get(s.sheetId) ?? []
      list.push(s)
      m.set(s.sheetId, list)
    }
    return [...m.entries()]
  }, [v.strips])

  return (
    <div className="spg-wrap">
      <div className="spg-top">
        <section className="spg-lock">
          <div className="spg-lock-pv">
            <div className="spg-pv ck" title={lock?.created ? t('spriteProject.create.character') : t('spriteProject.gen.orig')}>
              {lock && <OrigPreview strip={lock} pos={pos % Math.max(1, lock.frameCount)} size={92} />}
            </div>
            <Icon name="right" size={14} />
            <div className="spg-pv ck" title={t('spriteProject.gen.new')}>
              {lock?.url ? <StripPreview url={lock.url} sizes={lock.frameSizes} pos={pos % Math.max(1, lock.frameCount)} size={92} /> : <Icon name="sparkles" size={20} />}
            </div>
          </div>
          <div className="spg-lock-b">
            <h3>
              <Icon name="lock" size={14} />
              {t('spriteProject.gen.lockTitle')}
            </h3>
            <p className="muted">{t('spriteProject.gen.lockDesc')}</p>
            <div className="spg-lock-row">
              <select className="inp sm" value={v.lockKey ?? ''} onChange={(e) => void setLock(e.target.value || null)}>
                {targets.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.sheetName} · {stripLabel(s)}
                  </option>
                ))}
              </select>
              {lock && <StateChip strip={lock} state={lockState} job={lockJob} view={v} />}
              {lockOk && (
                <span className="chip c-green">
                  <Icon name="check" size={10} />
                  {t('spriteProject.gen.lockApproved')}
                </span>
              )}
            </div>
          </div>
          <div className="spg-steps">
            <div className={lockOk ? 'spg-st done' : 'spg-st'}>
              <span className="spg-n">{lockOk ? <Icon name="check" size={12} /> : 1}</span>
              <div>
                <b>{t('spriteProject.gen.step1')}</b>
                <div className="spg-st-acts">
                  {lock && lockState !== 'running' && lockState !== 'queued' && (
                    <button type="button" className={lock.versions.length ? 'btn sm' : 'btn primary sm'} onClick={() => void enqueue([lock.key])}>
                      <Icon name={lock.versions.length ? 'refresh' : 'sparkles'} size={13} />
                      {lock.versions.length ? t('spriteProject.gen.regen') : t('spriteProject.gen.genLock')}
                    </button>
                  )}
                  {lock && lock.versions.length > 0 && !lockOk && (
                    <>
                      <button type="button" className="btn primary sm" onClick={() => void review({ [lock.key]: { decision: 'approved' } })}>
                        <Icon name="check" size={13} />
                        {t('spriteProject.gen.approveLock')}
                      </button>
                      <button type="button" className="btn ghost sm" onClick={() => setStep(5)}>
                        <Icon name="eye" size={13} />
                        {t('spriteProject.gen.openReview')}
                      </button>
                    </>
                  )}
                </div>
              </div>
            </div>
            <div className={lockOk ? 'spg-st' : 'spg-st off'}>
              <span className="spg-n">2</span>
              <div>
                <b>{t('spriteProject.gen.step2', { count: rest.length })}</b>
                <small className="muted">{t('spriteProject.gen.step2Sub', { mirror: mirrors.length, est: rest.length })}</small>
                <div className="spg-st-acts">
                  <button
                    type="button"
                    className="btn primary sm"
                    disabled={!lockOk || !rest.length}
                    title={!lockOk ? t('spriteProject.gen.needLock') : !rest.length ? t('spriteProject.gen.nothingLeft') : undefined}
                    onClick={() => void enqueue(rest.map((s) => s.key))}
                  >
                    <Icon name="sparkles" size={13} />
                    {t('spriteProject.gen.genRest', { count: rest.length })}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </section>
      </div>
      <div className="toolbar spg-bar">
        <span className="muted">{t('spriteProject.gen.progress', { done: doneCount, total: targets.length, mirror: mirrors.length })}</span>
        <div className="grow" />
        {active.length > 0 && (
          <span className="chip c-blue">
            <span className="spin sm" />
            {t('spriteProject.gen.active', { count: active.length })}
          </span>
        )}
        {active.length > 0 && (
          <button type="button" className="btn sm" onClick={() => void (paused ? window.gas.queue.resume() : window.gas.queue.pause())}>
            <Icon name={paused ? 'play' : 'pause'} size={13} />
            {paused ? t('spriteProject.gen.resume') : t('spriteProject.gen.pause')}
          </button>
        )}
        {active.length > 0 && (
          <button type="button" className="btn ghost sm danger" onClick={() => void window.gas.queue.cancelAll(v.dir)}>
            <Icon name="x" size={13} />
            {t('spriteProject.gen.cancel')}
          </button>
        )}
        <button type="button" className="btn sm" disabled={doneCount === 0} onClick={() => setStep(5)}>
          {t('spriteProject.gen.toReview')}
          <Icon name="right" size={13} />
        </button>
      </div>
      <div className="spg-list">
        {bySheet.map(([sheetId, list]) => (
          <section key={sheetId} className="spg-sheet">
            <h4>
              <Icon name="grid" size={13} />
              {list[0]?.sheetName}
              <span className="muted">{t('spriteProject.gen.stripCount', { count: list.length })}</span>
            </h4>
            {list.map((s) => {
              const job = jobOf(v, s, jobs)
              const state = stripState(s, job)
              const src = sourceOf(v, s)
              const p = pos % Math.max(1, s.frameCount)
              return (
                <div key={s.key} className={s.key === v.lockKey ? 'spg-row lock' : 'spg-row'}>
                  <div className="spg-pv ck sm">
                    <OrigPreview strip={s} pos={p} size={52} />
                  </div>
                  <div className="spg-pv ck sm">
                    {s.mirrorOf ? (
                      src.url ? <StripPreview url={src.url} sizes={src.frameSizes} pos={p % Math.max(1, src.frameCount)} size={52} flipX /> : <Icon name="refresh" size={14} />
                    ) : s.url ? (
                      <StripPreview url={s.url} sizes={s.frameSizes} pos={p} size={52} />
                    ) : (
                      <Icon name="sparkles" size={14} />
                    )}
                  </div>
                  <div className="spg-name">
                    <b>{s.anim}</b>
                    <small>
                      {s.dir ? t(`spriteProject.dir.${s.dir}`) : t('spriteProject.gen.noDir')} · {t('spriteProject.sheets.frames', { count: s.frameCount })}
                    </small>
                  </div>
                  {s.key === v.lockKey && (
                    <span className="chip c-orange">
                      <Icon name="lock" size={10} />
                      {t('spriteProject.gen.lockBadge')}
                    </span>
                  )}
                  <StateChip strip={s} state={state} job={job} view={v} />
                  {s.decision && <span className={s.decision === 'approved' ? 'chip c-green' : 'chip c-orange'}>{t(`spriteProject.review.decision.${s.decision}`)}</span>}
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
                    <button type="button" className={state === 'none' ? 'btn sm' : 'btn ghost sm'} onClick={() => void enqueue([s.key])}>
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
