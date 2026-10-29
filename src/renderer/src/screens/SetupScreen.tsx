import { useEffect, useRef, useState, type ReactElement } from 'react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import type { SetupSnapshot, StepInfo } from '@shared/types'
import { Icon } from '@renderer/components/Icon'
import { Logo } from '@renderer/components/Logo'
import { ErrorActions } from '@renderer/components/ErrorActions'
import { useApp } from '@renderer/store/app'
import { useEnv } from '@renderer/store/env'
import { EASE } from '@renderer/lib/motion'
import { mb, tDyn } from '@renderer/lib/env'

let autoEntered = false
let quickRequested = false

function StepIcon({ step, index }: { step: StepInfo; index: number }): ReactElement {
  const cls = step.state === 'done' ? 'ok' : step.state === 'skipped' ? 'skip' : step.state === 'error' ? 'err' : step.state === 'running' ? 'run' : ''
  return (
    <div className={cls ? `sic ${cls}` : 'sic'}>
      {step.state === 'done' ? (
        <Icon name="check" size={14} />
      ) : step.state === 'skipped' || step.state === 'error' ? (
        <Icon name="alert" size={13} />
      ) : step.state === 'running' && !step.need ? (
        <span className="spin" />
      ) : (
        index + 1
      )}
    </div>
  )
}

function TestGen({ snap }: { snap: SetupSnapshot }): ReactElement {
  const { t } = useTranslation()
  const tg = snap.testGen
  return (
    <div className="testgen">
      {tg.state === 'done' && tg.imageDataUrl && <img className="tg-img" src={tg.imageDataUrl} alt={t('setup.testGen.alt')} />}
      <div className="tg-body">
        {tg.state === 'running' ? (
          <div className="tg-line">
            <span className="spin" />
            {t('setup.testGen.running')}
          </div>
        ) : tg.state === 'done' ? (
          <div className="tg-line ok">
            <Icon name="check" size={14} />
            {t('setup.testGen.done', { sec: Math.round((tg.ms ?? 0) / 1000) })}
          </div>
        ) : (
          <div className="tg-line">
            <button type="button" className="btn sm" onClick={() => void window.gas.setup.testGen()}>
              <Icon name="sparkles" size={13} />
              {t('setup.testGen.run')}
            </button>
            <span className="muted small">{t('setup.testGen.hint')}</span>
          </div>
        )}
        {tg.state === 'error' && (
          <>
            <div className="st-err">
              {t('setup.testGen.error')}: {tg.error}
            </div>
            <ErrorActions source="setup" target="testGen" error={tg.error ?? ''} />
          </>
        )}
      </div>
    </div>
  )
}

function StepExtra({ step, snap }: { step: StepInfo; snap: SetupSnapshot }): ReactElement | null {
  const { t } = useTranslation()
  const dismissUac = useEnv((s) => s.dismissUac)

  if (step.id === 'codex' && step.state === 'running' && step.sub === 'downloading') {
    const d = snap.download
    const pct = step.progress !== null ? step.progress * 100 : 0
    return (
      <div className="st-extra">
        <div className="bar">
          <i style={{ width: `${pct}%` }} />
        </div>
        <span className="mono">
          {d && d.total > 0 ? t('setup.progressMb', { received: mb(d.received), total: mb(d.total) }) : d ? `${mb(d.received)} MB` : ''}
        </span>
      </div>
    )
  }
  if (step.id === 'codex' && step.state === 'running' && step.sub && step.sub !== 'checking') {
    return (
      <div className="st-extra">
        <div className="bar indeterminate">
          <i />
        </div>
      </div>
    )
  }
  if (step.need === 'pathChoice') {
    return (
      <div className="st-extra">
        <code className="mono path-chip">{String(step.params['entry'] ?? '')}</code>
        <button type="button" className="btn sm primary" onClick={() => void window.gas.setup.pathChoice(true)}>
          <Icon name="plus" size={13} />
          {t('setup.path.add')}
        </button>
        <button type="button" className="btn sm ghost" onClick={() => void window.gas.setup.pathChoice(false)}>
          {t('setup.path.skip')}
        </button>
      </div>
    )
  }
  if (step.need === 'uac') {
    return (
      <>
        {step.error && <div className="st-err">{step.error}</div>}
        <div className="st-extra">
          <button
            type="button"
            className="btn sm primary"
            onClick={() => {
              dismissUac(true)
              void window.gas.setup.uac(true)
            }}
          >
            <Icon name="shield" size={13} />
            {t('setup.longPath.grant')}
          </button>
          <button type="button" className="btn sm ghost" onClick={() => void window.gas.setup.uac(false)}>
            {t('setup.longPath.skip')}
          </button>
        </div>
      </>
    )
  }
  if (step.id === 'longPath' && step.state === 'skipped') {
    return (
      <div className="st-extra">
        <button type="button" className="btn sm" onClick={() => void window.gas.setup.retry('longPath')}>
          <Icon name="refresh" size={13} />
          {t('setup.retry')}
        </button>
      </div>
    )
  }
  if (step.need === 'login') {
    return (
      <div className="st-extra">
        <button type="button" className="btn primary" onClick={() => void window.gas.setup.login()}>
          <Icon name="user" size={14} />
          {t('setup.login.signIn')}
        </button>
      </div>
    )
  }
  if (step.need === 'loginWait') {
    return (
      <div className="st-extra">
        <span className="spin" />
        <button type="button" className="btn sm" onClick={() => void window.gas.setup.loginReopen()}>
          <Icon name="external" size={13} />
          {t('setup.login.reopen')}
        </button>
        <button type="button" className="btn sm ghost" onClick={() => void window.gas.setup.loginCancel()}>
          {t('setup.login.cancel')}
        </button>
      </div>
    )
  }
  if (step.id === 'quota' && step.state === 'done') return <TestGen snap={snap} />
  if (step.need === 'workspace') {
    return (
      <div className="st-extra">
        <button type="button" className="opt-card" onClick={() => void window.gas.setup.workspace('new')}>
          <Icon name="plus" size={18} />
          <div>
            <b>{t('setup.workspace.new')}</b>
            <span>{t('setup.workspace.newDesc')}</span>
          </div>
        </button>
        <button type="button" className="opt-card" onClick={() => void window.gas.setup.workspace('open')}>
          <Icon name="folder" size={18} />
          <div>
            <b>{t('setup.workspace.open')}</b>
            <span>{t('setup.workspace.openDesc')}</span>
          </div>
        </button>
      </div>
    )
  }
  return null
}

function stepDesc(t: unknown, step: StepInfo): string {
  if (!step.sub) return tDyn(t, `setup.steps.${step.id}.desc`)
  return tDyn(t, `setup.sub.${step.id}.${step.sub}`, step.params)
}

export function SetupScreen(): ReactElement {
  const { t } = useTranslation()
  const navigate = useApp((s) => s.navigate)
  const snap = useEnv((s) => s.setup)
  const log = useEnv((s) => s.log)
  const refreshFix = useEnv((s) => s.refreshFixAvailable)
  const [showLog, setShowLog] = useState(false)
  const logRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    if (!snap || quickRequested) return
    if (!snap.started && snap.completedBefore) {
      quickRequested = true
      void window.gas.setup.start(true)
    }
  }, [snap])

  useEffect(() => {
    if (!snap || autoEntered) return
    if (snap.quick && snap.canEnter && !snap.running) {
      autoEntered = true
      navigate('workspace')
    }
  }, [snap, navigate])

  const hasError = !!snap?.steps.some((s) => s.state === 'error') || snap?.testGen.state === 'error'
  useEffect(() => {
    if (hasError) void refreshFix()
  }, [hasError, refreshFix])

  useEffect(() => {
    if (showLog && logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight
  }, [log, showLog])

  const steps = snap?.steps ?? []
  const done = steps.filter((s) => s.state === 'done' || s.state === 'skipped').length
  const total = steps.length || 7
  const all = !!snap?.canEnter
  const current = snap?.started ? steps.find((s) => s.state !== 'done' && s.state !== 'skipped')?.id : undefined

  return (
    <main className="setup">
      <div className="setup-card">
        <div className="setup-hero">
          <Logo />
          <div>
            <h1>{t('setup.title')}</h1>
            <p>{snap?.quick && snap.running ? t('setup.quickChecking') : t('setup.intro')}</p>
          </div>
        </div>
        <div className="setup-prog">
          <div className={all ? 'bar big green' : 'bar big'}>
            <i style={{ width: `${(done / total) * 100}%` }} />
          </div>
          <span>
            {done}/{total}
          </span>
        </div>
        <ol className="steps-v">
          {steps.map((step, i) => (
            <motion.li
              key={step.id}
              className={current === step.id && !all ? 'srow cur' : 'srow'}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE, delay: 0.04 + i * 0.03 }}
            >
              <StepIcon step={step} index={i} />
              <div className="st-main">
                <div className="st-title">
                  {t(`setup.steps.${step.id}.title`)}
                  {step.id === 'longPath' && (
                    <span className="chip c-gray">
                      <Icon name="shield" size={11} />
                      {t('setup.admin')}
                    </span>
                  )}
                  {step.id === 'path' && <span className="chip c-gray">{t('setup.optional')}</span>}
                </div>
                <div className={step.state === 'skipped' ? 'st-desc warn' : 'st-desc'}>{stepDesc(t, step)}</div>
                {snap && <StepExtra step={step} snap={snap} />}
                {step.state === 'error' && step.error && (
                  <>
                    <div className="st-err">{step.error}</div>
                    <ErrorActions source="setup" target={step.id} error={step.error} />
                  </>
                )}
              </div>
            </motion.li>
          ))}
        </ol>
        <div className="setup-foot">
          <button type="button" className="btn ghost sm" onClick={() => setShowLog((v) => !v)}>
            <Icon name="terminal" size={14} />
            {showLog ? t('setup.hideLog') : t('setup.showLog')}
          </button>
          <button type="button" className="btn ghost sm" onClick={() => void window.gas.app.exportLog()}>
            <Icon name="download" size={14} />
            {t('setup.exportLog')}
          </button>
          <div className="grow" />
          {!snap?.started ? (
            <button type="button" className="btn primary lg" disabled={!snap} onClick={() => void window.gas.setup.start(false)}>
              {t('setup.start')}
            </button>
          ) : (
            <button type="button" className="btn primary lg" disabled={!all} onClick={() => navigate('workspace')}>
              {t('setup.enter')}
              <Icon name="right" size={14} />
            </button>
          )}
        </div>
        {showLog && (
          <pre className="log" ref={logRef}>
            {log.length ? log.join('\n') : t('setup.noLog')}
          </pre>
        )}
      </div>
    </main>
  )
}
