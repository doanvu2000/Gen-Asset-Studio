import { useMemo, useState, type KeyboardEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { QueueJob } from '@shared/queue'
import type { SpriteProjectView, StripView } from '@shared/sprite'
import { Icon } from '@renderer/components/Icon'
import { Segmented } from '@renderer/components/Segmented'
import { StripPreview, useClock } from '@renderer/components/sprite/StripPreview'
import { OrigPreview } from '@renderer/components/sprite/OrigPreview'
import { QueueControls } from '@renderer/components/sprite/QueueControls'
import { genTargets, jobOf, qaFail, sourceOf, stripLabel, stripMatches, stripState, type StripFilter, type StripState } from '@renderer/lib/sprite'
import { isActive, samePath, useQueue } from '@renderer/store/queue'
import { useSprite } from '@renderer/store/sprite'
import { StripDetail, StripOverview } from './StripReview'

type Tab = 'strips' | 'overview'

function StateChip({ v, strip, state, job }: { v: SpriteProjectView; strip: StripView; state: StripState; job: QueueJob | null }): ReactElement {
  const { t } = useTranslation()
  if (state === 'mirror') {
    return (
      <span className="chip c-purple">
        <Icon name="refresh" size={10} />
        {t('spriteProject.gen.mirrorOf', { name: stripLabel(sourceOf(v, strip)) })}
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
  if (state === 'queued') return <span className="chip c-gray">{t('spriteProject.gen.state.queued')}</span>
  if (state === 'error') return <span className="chip c-red">{t('spriteProject.gen.state.error')}</span>
  if (state === 'none') return <span className="chip c-gray">{t('spriteProject.gen.state.none')}</span>
  const ver = t('spriteProject.gen.doneV', { v: strip.selected })
  if (strip.decision === 'approved') {
    return (
      <span className="chip c-green">
        <Icon name="check" size={10} />
        {t('spriteProject.review.decision.approved')} · {ver}
      </span>
    )
  }
  if (strip.decision === 'rejected') return <span className="chip c-orange">{`${t('spriteProject.review.decision.rejected')} · ${ver}`}</span>
  const warn = qaFail(strip)
  return (
    <span className={warn ? 'chip c-orange' : 'chip c-blue'}>
      {warn && <Icon name="alert" size={10} />}
      {t('spriteProject.review.pending')} · {ver}
      {warn ? ` · ${t('spriteProject.gen.qaWarn')}` : ''}
    </span>
  )
}

function pickDefault(v: SpriteProjectView): string | null {
  const targets = genTargets(v)
  const pending = targets.find((s) => s.url && !s.decision)
  const lock = targets.find((s) => s.key === v.lockKey)
  return (pending ?? (lock && lock.decision !== 'approved' ? lock : null) ?? targets.find((s) => s.decision !== 'approved') ?? v.strips[0])?.key ?? null
}

export function SpriteWorkStep({ v }: { v: SpriteProjectView }): ReactElement {
  const { t } = useTranslation()
  const enqueue = useSprite((s) => s.enqueue)
  const enqueueAll = useSprite((s) => s.enqueueAll)
  const setLock = useSprite((s) => s.setLock)
  const setSettings = useSprite((s) => s.setSettings)
  const review = useSprite((s) => s.review)
  const setStep = useSprite((s) => s.setStep)
  const snap = useQueue((s) => s.snap)
  const jobs = useMemo(() => snap?.jobs ?? [], [snap])
  const [pos] = useClock(1000, 8, true)
  const [tab, setTab] = useState<Tab>('strips')
  const [filter, setFilter] = useState<StripFilter>('all')
  const [sel, setSel] = useState<string | null>(() => pickDefault(v))

  const targets = genTargets(v)
  const mirrors = v.strips.length - targets.length
  const lock = v.strips.find((s) => s.key === v.lockKey) ?? null
  const lockJob = lock ? jobOf(v, lock, jobs) : null
  const lockState = lock ? stripState(lock, lockJob) : 'none'
  const lockOk = !!lock && lock.decision === 'approved'
  const active = jobs.filter((j) => samePath(j.projectPath, v.dir) && isActive(j))
  const paused = !!snap?.paused
  const autoChain = v.settings.autoChain
  const styleOk = v.style.locked
  const doneCount = targets.filter((s) => s.versions.length > 0).length
  const approved = targets.filter((s) => s.decision === 'approved').length
  const qaOk = targets.filter((s) => s.url && !s.decision && !qaFail(s))
  const list = v.strips.filter((s) => stripMatches(v, s, filter))
  const cur = v.strips.find((s) => s.key === sel) ?? v.strips.find((s) => s.key === pickDefault(v)) ?? null

  const groups = new Map<string, StripView[]>()
  for (const s of list) groups.set(s.sheetId, [...(groups.get(s.sheetId) ?? []), s])
  const bySheet = [...groups.entries()].map(([id, rows]) => [id, [...rows.filter((s) => !s.mirrorOf), ...rows.filter((s) => s.mirrorOf)]] as const)
  const progress = t('spriteProject.work.progress', { done: doneCount, approved, total: targets.length, mirror: mirrors })

  const idle = (s: StripView): boolean => {
    const st = stripState(s, jobOf(v, s, jobs))
    return st === 'none' || st === 'error'
  }

  const next = (): void => {
    if (!cur) return
    const idx = list.findIndex((s) => s.key === cur.key)
    const after = [...list.slice(idx + 1), ...list.slice(0, idx)].find((s) => !s.mirrorOf && s.url && s.decision !== 'approved')
    if (after) setSel(after.key)
  }

  const onRowKey = (e: KeyboardEvent, key: string): void => {
    if (e.key !== 'Enter' || e.target !== e.currentTarget) return
    e.preventDefault()
    setSel(key)
  }

  const lockName = lock ? stripLabel(lock) : ''
  const allBlock = !styleOk ? 'lock.style' : lock && lock.versions.length && !lockOk ? 'work.needLock' : lock && !lock.versions.length && !idle(lock) ? 'work.lockRunning' : null
  const allHint = lock && !lock.versions.length ? 'work.genAllLockFirst' : 'work.genAllHint'
  const lockHint = lockOk
    ? 'lockDone'
    : lockState === 'queued' || lockState === 'running'
      ? 'lockRunning'
      : lock && lock.versions.length > 0
        ? autoChain
          ? 'lockReview'
          : 'lockReviewManual'
        : autoChain
          ? 'flowAuto'
          : 'flowManual'

  return (
    <div className="spr-wrap spw">
      <div className="spw-guide">
        <div className="spw-guide-pv ck">{lock?.url ? <StripPreview url={lock.url} sizes={lock.frameSizes} pos={pos % Math.max(1, lock.frameCount)} size={44} /> : lock ? <OrigPreview strip={lock} pos={pos % Math.max(1, lock.frameCount)} size={44} /> : <Icon name="lock" size={16} />}</div>
        <div className="spw-guide-b">
          <div className="spw-guide-row">
            <b>
              <Icon name="lock" size={12} />
              {t('spriteProject.gen.lockTitle')}
            </b>
            <select className="inp sm" value={v.lockKey ?? ''} onChange={(e) => void setLock(e.target.value || null)}>
              {targets.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.sheetName} · {stripLabel(s)}
                </option>
              ))}
            </select>
            {lock && <StateChip v={v} strip={lock} state={lockState} job={lockJob} />}
          </div>
          <small className="muted">{t(`spriteProject.work.${lockHint}`, { name: lockName })}</small>
        </div>
        {lock && (lockState === 'none' || lockState === 'error') && (
          <button
            type="button"
            className="btn primary sm"
            disabled={!styleOk}
            title={styleOk ? undefined : t('spriteProject.lock.style')}
            onClick={() => {
              setSel(lock.key)
              void enqueue([lock.key])
            }}
          >
            <Icon name="sparkles" size={13} />
            {t('spriteProject.gen.genLock')}
          </button>
        )}
        {lock && lock.versions.length > 0 && !lockOk && lockState === 'done' && (
          <button
            type="button"
            className="btn primary sm"
            onClick={() => {
              setSel(lock.key)
              void review({ [lock.key]: { decision: 'approved' } })
            }}
          >
            <Icon name="check" size={13} />
            {t('spriteProject.gen.approveLock')}
          </button>
        )}
        <div className="grow" />
        <label className="sp-check spw-auto" title={t('spriteProject.work.autoHint')}>
          <input type="checkbox" checked={autoChain} onChange={(e) => void setSettings({ autoChain: e.target.checked })} />
          <span>
            <b>{t('spriteProject.work.auto')}</b>
            <small>{t('spriteProject.work.autoSub')}</small>
          </span>
        </label>
      </div>
      <div className="toolbar">
        <Segmented<Tab>
          value={tab}
          ariaLabel={t('spriteProject.review.tab')}
          onChange={setTab}
          options={[
            { value: 'strips', label: t('spriteProject.review.tabStrips') },
            { value: 'overview', label: t('spriteProject.review.tabOverview') }
          ]}
        />
        {tab === 'strips' && (
          <Segmented<StripFilter>
            value={filter}
            ariaLabel={t('spriteProject.review.filter')}
            onChange={setFilter}
            options={(['all', 'pending', 'approved', 'rejected', 'qa'] as const).map((f) => ({ value: f, label: t(`spriteProject.review.f.${f}`) }))}
          />
        )}
        <div className="tb-end">
          <span className="muted tb-prog" title={progress}>
            {progress}
          </span>
          <QueueControls count={active.length} paused={paused} dir={v.dir} />
          {qaOk.length > 0 && (
            <button type="button" className="btn sm" onClick={() => void review(Object.fromEntries(qaOk.map((s) => [s.key, { decision: 'approved' as const }])))}>
              <Icon name="check" size={13} />
              {t('spriteProject.review.approveQa', { count: qaOk.length })}
            </button>
          )}
          <button type="button" className="btn primary sm" disabled={!approved} title={approved ? undefined : t('spriteProject.lock.export')} onClick={() => setStep(4)}>
            {t('spriteProject.review.toExport')}
            <Icon name="right" size={13} />
          </button>
        </div>
      </div>
      {tab === 'overview' ? (
        <StripOverview v={v} pos={pos} />
      ) : (
        <div className="spr-body">
          <div className="spg-list">
            {!bySheet.length && <div className="proj-state muted">{t('spriteProject.review.empty')}</div>}
            {bySheet.map(([sheetId, rows]) => {
              const all = v.strips.filter((s) => s.sheetId === sheetId && !s.mirrorOf)
              const left = all.filter((s) => !s.versions.length && idle(s)).length
              return (
                <section key={sheetId} className="spg-sheet">
                  <h4>
                    <Icon name="grid" size={13} />
                    {rows[0]?.sheetName}
                    <span className="muted">{t('spriteProject.gen.stripCount', { count: rows.length })}</span>
                    <span className="grow" />
                    <button
                      type="button"
                      className="btn sm"
                      disabled={!!allBlock || !left}
                      title={t(`spriteProject.${allBlock ?? (left ? allHint : 'work.nothingLeft')}`)}
                      onClick={() => void enqueueAll(sheetId)}
                    >
                      <Icon name="sparkles" size={13} />
                      {t('spriteProject.work.genAll', { count: left })}
                    </button>
                  </h4>
                  {rows.map((s) => {
                    const job = jobOf(v, s, jobs)
                    const state = stripState(s, job)
                    const src = sourceOf(v, s)
                    const p = pos % Math.max(1, s.frameCount)
                    const cls = ['spg-row', s.key === v.lockKey && 'lock', cur?.key === s.key && 'on'].filter(Boolean).join(' ')
                    return (
                      <div key={s.key} className={cls} role="button" tabIndex={0} aria-pressed={cur?.key === s.key} onClick={() => setSel(s.key)} onKeyDown={(e) => onRowKey(e, s.key)}>
                        <div className="spg-pv ck sm">
                          <OrigPreview strip={s} pos={p} size={52} />
                        </div>
                        <div className="spg-pv ck sm">
                          {src.url ? <StripPreview url={src.url} sizes={src.frameSizes} pos={p % Math.max(1, src.frameCount)} size={52} flipX={!!s.mirrorOf} /> : <Icon name={s.mirrorOf ? 'refresh' : 'sparkles'} size={14} />}
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
                        <StateChip v={v} strip={s} state={state} job={job} />
                        <div className="grow" />
                        {state === 'error' && job && (
                          <button
                            type="button"
                            className="btn sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              void window.gas.queue.retry(job.id)
                            }}
                          >
                            <Icon name="refresh" size={13} />
                            {t('spriteProject.gen.retry')}
                          </button>
                        )}
                        {state === 'none' && (
                          <button
                            type="button"
                            className="btn ghost sm"
                            disabled={!styleOk}
                            title={styleOk ? undefined : t('spriteProject.lock.style')}
                            onClick={(e) => {
                              e.stopPropagation()
                              void enqueue([s.key])
                            }}
                          >
                            <Icon name="sparkles" size={13} />
                            {t('spriteProject.gen.gen')}
                          </button>
                        )}
                        {(state === 'queued' || state === 'running') && job && (
                          <button
                            type="button"
                            className="btn ghost sm"
                            onClick={(e) => {
                              e.stopPropagation()
                              void window.gas.queue.cancel(job.id)
                            }}
                          >
                            <Icon name="x" size={13} />
                            {t('spriteProject.gen.cancelOne')}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </section>
              )
            })}
          </div>
          {cur && <StripDetail key={cur.key} v={v} s={cur} chip={<StateChip v={v} strip={cur} state={stripState(cur, jobOf(v, cur, jobs))} job={jobOf(v, cur, jobs)} />} onNext={next} />}
        </div>
      )}
    </div>
  )
}
