import { useEffect, useRef, type ReactElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import type { EnvItem, ExportScale, Lang, RateWindow, ThemePref } from '@shared/types'
import { SUGGEST_MAX, SUGGEST_MIN, type StyleTask } from '@shared/style'
import { useStyle } from '@renderer/store/style'
import { Stepper } from './Stepper'
import { useApp, type SettingsTab } from '@renderer/store/app'
import { useEnv } from '@renderer/store/env'
import { fadeTransition, sheetTransition } from '@renderer/lib/motion'
import { formatReset } from '@renderer/lib/env'
import { Icon, type IconName } from './Icon'
import { Segmented } from './Segmented'
import { EnvChip } from './EnvChip'
import { ErrorActions } from './ErrorActions'
import { UpdateSettingsSection } from './UpdateSettingsSection'
import { useUpdateT } from '@renderer/lib/useUpdateT'

function GeneralTab(): ReactElement {
  const { t, i18n } = useTranslation()
  const updT = useUpdateT()
  const theme = useApp((s) => s.settings.theme)
  const lang = useApp((s) => s.settings.lang)
  const setTheme = useApp((s) => s.setTheme)
  const setLang = useApp((s) => s.setLang)
  const closeSettings = useApp((s) => s.closeSettings)
  const replayTours = useApp((s) => s.replayTours)

  const themeOptions = [
    { value: 'light', label: t('settings.theme.light') },
    { value: 'dark', label: t('settings.theme.dark') },
    { value: 'system', label: t('settings.theme.system') }
  ] as const satisfies readonly { value: ThemePref; label: string }[]

  const langOptions = [
    { value: 'vi', label: t('settings.langs.vi') },
    { value: 'en', label: t('settings.langs.en') }
  ] as const satisfies readonly { value: Lang; label: string }[]

  return (
    <>
      <div className="group">
        <div className="row">
          <div className="rl">{t('settings.appearance')}</div>
          <Segmented value={theme} options={themeOptions} onChange={(v) => void setTheme(v)} ariaLabel={t('settings.appearance')} />
        </div>
        <div className="row">
          <div className="rl">{t('settings.language')}</div>
          <Segmented value={lang} options={langOptions} onChange={(v) => void setLang(v)} ariaLabel={t('settings.language')} />
        </div>
      </div>
      <div className="group">
        <div className="row">
          <div className="rl">{t('settings.logs')}</div>
          <button type="button" className="btn sm" onClick={() => void window.gas.app.openLogs()}>
            <Icon name="folder" size={13} />
            {t('settings.openLogs')}
          </button>
          <button type="button" className="btn sm" onClick={() => void window.gas.app.exportLog()}>
            <Icon name="download" size={13} />
            {t('settings.exportLog')}
          </button>
        </div>
        <div className="row">
          <div className="rl" title={t('coach.ui.replayHint')}>{t('coach.ui.replay')}</div>
          <button
            type="button"
            className="btn sm"
            data-coach="settings-replay"
            onClick={() => {
              closeSettings()
              replayTours()
            }}
          >
            <Icon name="help" size={13} />
            {t('coach.ui.replay')}
          </button>
        </div>
      </div>
      <div className="group upd-group">
        <UpdateSettingsSection api={window.gas.update} t={updT} lang={i18n.language} />
      </div>
    </>
  )
}

const TASKS: StyleTask[] = ['promptPolish', 'styleSuggest', 'assetGen']
const FALLBACK_EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

function GenTab(): ReactElement {
  const { t } = useTranslation()
  const gen = useApp((s) => s.settings.gen)
  const models = useStyle((s) => s.models)
  const list = useStyle((s) => s.modelList)
  const loadList = useStyle((s) => s.loadModelList)
  const setModel = useStyle((s) => s.setModel)
  const resetModels = useStyle((s) => s.resetModels)

  useEffect(() => {
    void loadList()
  }, [loadList])

  const setGen = (patch: Partial<typeof gen>): void => {
    void window.gas.settings.set({ gen: patch })
  }

  const scaleOptions = [
    { value: '1', label: '×1' },
    { value: '2', label: '×2' },
    { value: '4', label: '×4' }
  ] as const

  return (
    <>
      <div className="group">
        <div className="row">
          <div className="rl">
            {t('settings.gen.parallel')}
            <small className="muted">{t('settings.gen.parallelHint')}</small>
          </div>
          <Stepper value={gen.concurrency} min={1} max={6} label={t('settings.gen.parallel')} onChange={(v) => setGen({ concurrency: v })} />
        </div>
        <div className="row">
          <div className="rl">
            {t('settings.gen.styles')}
            <small className="muted">{t('settings.gen.stylesHint')}</small>
          </div>
          <Stepper value={gen.styleCount} min={SUGGEST_MIN} max={SUGGEST_MAX} label={t('settings.gen.styles')} onChange={(v) => setGen({ styleCount: v })} />
        </div>
        <div className="row">
          <div className="rl">
            {t('settings.gen.scale')}
            <small className="muted">{t('settings.gen.scaleHint')}</small>
          </div>
          <Segmented value={String(gen.scale) as '1' | '2' | '4'} options={scaleOptions} onChange={(v) => setGen({ scale: Number(v) as ExportScale })} ariaLabel={t('settings.gen.scale')} />
        </div>
        <div className="row">
          <div className="rl">{t('settings.gen.maxRun')}</div>
          <b>100</b>
        </div>
      </div>
      <div className="group">
        {TASKS.map((task) => {
          const cur = models[task]
          const info = list.find((m) => m.id === cur.model || m.model === cur.model)
          const efforts = info?.efforts.length ? info.efforts : FALLBACK_EFFORTS
          const options = list.length ? list : [{ id: cur.model, model: cur.model, displayName: cur.model, efforts: FALLBACK_EFFORTS, defaultEffort: 'medium', isDefault: true, hidden: false }]
          return (
            <div className="row" key={task}>
              <div className="rl">
                {t(`settings.gen.task.${task}`)}
                <small className="muted">{t(`settings.gen.taskHint.${task}`)}</small>
              </div>
              <select className="dd" aria-label="Model" value={info?.id ?? cur.model} onChange={(e) => {
                const m = list.find((x) => x.id === e.target.value)
                const eff = m && !m.efforts.includes(cur.effort) ? (m.defaultEffort ?? m.efforts[0] ?? cur.effort) : cur.effort
                void setModel(task, m?.model ?? e.target.value, eff)
              }}>
                {!info && <option value={cur.model}>{cur.model}</option>}
                {options.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName || m.model}
                  </option>
                ))}
              </select>
              <select className="dd" aria-label="Effort" value={cur.effort} onChange={(e) => void setModel(task, cur.model, e.target.value)}>
                {!efforts.includes(cur.effort) && <option value={cur.effort}>{cur.effort}</option>}
                {efforts.map((x) => (
                  <option key={x} value={x}>
                    {x}
                  </option>
                ))}
              </select>
            </div>
          )
        })}
        <div className="row">
          <div className="rl muted small">{t('settings.gen.modelsNote')}</div>
          <button type="button" className="btn sm ghost" onClick={() => void resetModels()}>
            {t('settings.gen.reset')}
          </button>
        </div>
      </div>
    </>
  )
}

function QuotaRow({ label, w }: { label: string; w: RateWindow | null }): ReactElement {
  const { t } = useTranslation()
  const lang = useApp((s) => s.settings.lang)
  const left = w ? Math.max(0, Math.min(100, Math.round(100 - w.usedPercent))) : null
  const reset = formatReset(w?.resetsAt ?? null, lang)
  return (
    <div className="row">
      <div className="rl">
        {label}
        {reset && <small className="muted">{reset.relative ? t('account.resetsIn', { t: reset.text }) : t('account.resetsAt', { t: reset.text })}</small>}
      </div>
      <div className={left !== null && left < 25 ? 'bar low qwide' : 'bar green qwide'}>
        <i style={{ width: `${left ?? 0}%` }} />
      </div>
      <output className="qval">{left !== null ? t('account.left', { n: left }) : '—'}</output>
    </div>
  )
}

function AccountTab(): ReactElement {
  const { t } = useTranslation()
  const account = useEnv((s) => s.account)
  const rl = useEnv((s) => s.rateLimits)
  const login = useEnv((s) => s.setup?.login ?? null)

  useEffect(() => {
    if (account?.loggedIn) void window.gas.account.rateLimits()
  }, [account?.loggedIn])

  if (login) {
    return (
      <div className="group">
        <div className="acc">
          <span className="spin" />
          <div className="grow">
            <b>{t('account.waiting')}</b>
          </div>
          <button type="button" className="btn sm" onClick={() => void window.gas.setup.loginReopen()}>
            <Icon name="external" size={13} />
            {t('account.reopen')}
          </button>
          <button type="button" className="btn sm ghost" onClick={() => void window.gas.setup.loginCancel()}>
            {t('account.cancel')}
          </button>
        </div>
      </div>
    )
  }

  if (!account?.loggedIn) {
    return (
      <div className="group">
        <div className="acc">
          <div className="avatar off">
            <Icon name="user" size={18} />
          </div>
          <div className="grow">
            <b>{t('account.notSignedIn')}</b>
            <div className="muted">{t('account.notSignedInDesc')}</div>
          </div>
          <button type="button" className="btn primary" onClick={() => void window.gas.setup.login()}>
            <Icon name="user" size={14} />
            {t('account.signIn')}
          </button>
        </div>
      </div>
    )
  }

  const initial = (account.email ?? '?').slice(0, 1).toUpperCase()
  return (
    <>
      <div className="group">
        <div className="acc">
          <div className="avatar">{initial}</div>
          <div className="grow">
            <b className="acc-mail">{account.email}</b>
            <div className="muted">
              {account.planType ?? ''} · {t('account.viaChatgpt')}
            </div>
          </div>
          <span className="chip c-green">
            <Icon name="check" size={11} />
            {t('account.connected')}
          </span>
        </div>
      </div>
      <div className="group">
        {rl ? (
          <>
            <QuotaRow label={t('account.q5')} w={rl.primary} />
            <QuotaRow label={t('account.qWeek')} w={rl.secondary} />
            {rl.reachedType && (
              <div className="row">
                <span className="chip c-red">
                  <Icon name="alert" size={11} />
                  {t('account.limitReached')}
                </span>
              </div>
            )}
          </>
        ) : (
          <div className="row">
            <div className="rl muted">{t('account.noData')}</div>
            <button type="button" className="btn sm" onClick={() => void window.gas.account.rateLimits()}>
              <Icon name="refresh" size={13} />
              {t('account.refresh')}
            </button>
          </div>
        )}
      </div>
      <div className="acts-r">
        <button type="button" className="btn" onClick={() => void window.gas.account.switchAccount()}>
          <Icon name="user" size={14} />
          {t('account.switch')}
        </button>
        <button type="button" className="btn danger" onClick={() => void window.gas.account.logout()}>
          <Icon name="logout" size={14} />
          {t('account.logout')}
        </button>
      </div>
    </>
  )
}

function EnvActions({ item }: { item: EnvItem }): ReactElement | null {
  const { t } = useTranslation()
  const env = useEnv((s) => s.env)
  const g = window.gas
  if (item.state === 'error') return <ErrorActions source="env" target={item.id === 'imageGen' ? 'testGen' : item.id} error={item.error ?? ''} compact />
  if (item.state === 'installing') return null
  if (item.id === 'codex') {
    if (item.state === 'installed') {
      return (
        <button type="button" className="btn sm ghost" disabled={env?.upgrading} onClick={() => void g.env.reinstallCodex()}>
          {t('env.act.reinstall')}
        </button>
      )
    }
    return (
      <button type="button" className="btn sm primary" onClick={() => void g.setup.retry('codex')}>
        {t('env.act.install')}
      </button>
    )
  }
  if (item.state === 'installed') return null
  const map: Partial<Record<EnvItem['id'], [string, () => void]>> = {
    path: [t('env.act.add'), () => void g.setup.pathChoice(true)],
    longPath: [t('env.act.enable'), () => void g.setup.uac(true)],
    login: [t('env.act.signIn'), () => void g.setup.login()],
    imageGen: [t('env.act.check'), () => void g.setup.testGen()],
    workspace: [t('env.act.choose'), () => void g.setup.workspace('open')]
  }
  const a = map[item.id]
  if (!a) return null
  return (
    <button type="button" className="btn sm primary" onClick={a[1]}>
      {a[0]}
    </button>
  )
}

function envDetail(item: EnvItem, tf: ReturnType<typeof useTranslation>['t']): string {
  const t = tf as unknown as (key: string, vars?: Record<string, string>) => string
  if (item.id === 'codex' && item.detail) return t('env.items.codex.version', { v: item.detail })
  if (item.detail === 'skipped') return `${t(`env.items.${item.id}.desc`)} · ${t('env.skipped')}`
  if ((item.id === 'login' || item.id === 'workspace') && item.detail) return item.detail
  return t(`env.items.${item.id}.desc`)
}

function EnvTab(): ReactElement {
  const { t } = useTranslation()
  const env = useEnv((s) => s.env)
  const navigate = useApp((s) => s.navigate)
  const close = useApp((s) => s.closeSettings)
  const items = env?.items ?? []
  const ok = items.filter((i) => i.state === 'installed').length

  return (
    <>
      <div className="sec-h">
        <h3>{t('env.title')}</h3>
        <span className="muted">{t('env.ready', { ok, total: items.length })}</span>
        <div className="grow" />
        <button type="button" className="btn sm" onClick={() => void window.gas.env.recheck()}>
          <Icon name="refresh" size={13} />
          {t('env.recheck')}
        </button>
      </div>
      {env?.updateAvailable && env.latestVersion && (
        <div className="note">
          <Icon name="cloud" size={14} />
          <div className="grow">
            <b>{t('env.update.available', { v: env.latestVersion })}</b>
            <div className="muted small">{t('env.update.warn')}</div>
          </div>
          <button type="button" className="btn sm primary" disabled={env.upgrading} onClick={() => void window.gas.env.upgradeCodex()}>
            {env.upgrading ? <span className="spin" /> : <Icon name="download" size={13} />}
            {t('env.update.button', { v: env.latestVersion })}
          </button>
        </div>
      )}
      <div className="group">
        {items.map((item) => (
          <div className="row env-row" key={item.id}>
            <div className="rl">
              <b>{t(`env.items.${item.id}.name`)}</b>
              <small className="muted">{envDetail(item, t)}</small>
              {item.state === 'error' && item.error && <span className="ee">{item.error}</span>}
            </div>
            <div className="ea">
              <EnvChip id={item.id} state={item.state} />
              <EnvActions item={item} />
            </div>
          </div>
        ))}
      </div>
      {env && <p className="muted small mono env-paths">{t('env.paths', { dir: env.appDataDir, home: env.codexHome })}</p>}
      <div className="acts-r">
        <button type="button" className="btn ghost sm" onClick={() => void window.gas.env.checkUpdate()}>
          <Icon name="cloud" size={13} />
          {t('env.update.checking')}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            close()
            navigate('setup')
          }}
        >
          <Icon name="refresh" size={14} />
          {t('env.rerun')}
        </button>
      </div>
    </>
  )
}

const TABS: { id: SettingsTab; icon: IconName }[] = [
  { id: 'general', icon: 'gear' },
  { id: 'gen', icon: 'sparkles' },
  { id: 'account', icon: 'user' },
  { id: 'env', icon: 'box' }
]

export function SettingsDialog(): ReactElement {
  const { t } = useTranslation()
  const open = useApp((s) => s.settingsOpen)
  const tab = useApp((s) => s.settingsTab)
  const setTab = useApp((s) => s.setSettingsTab)
  const close = useApp((s) => s.closeSettings)
  const fixOpen = useEnv((s) => s.fix.phase !== 'idle')
  const refreshFix = useEnv((s) => s.refreshFixAvailable)
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    sheetRef.current?.focus()
    void refreshFix()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && !fixOpen) close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close, fixOpen, refreshFix])

  return (
    <AnimatePresence>
      {open && (
        <div className="modal-root" key="settings">
          <motion.div
            className="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fadeTransition}
            onClick={close}
          />
          <motion.div
            ref={sheetRef}
            tabIndex={-1}
            className="sheet settings"
            role="dialog"
            aria-modal="true"
            aria-label={t('settings.title')}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: fadeTransition }}
            transition={sheetTransition}
          >
            <header role="tablist">
              {TABS.map((x) => (
                <button
                  key={x.id}
                  type="button"
                  className={tab === x.id ? 'stab on' : 'stab'}
                  role="tab"
                  aria-selected={tab === x.id}
                  onClick={() => setTab(x.id)}
                >
                  <Icon name={x.icon} size={20} />
                  {t(`settings.tabs.${x.id}`)}
                </button>
              ))}
              <button type="button" className="icon-btn set-close" aria-label={t('settings.close')} onClick={close}>
                <Icon name="x" />
              </button>
            </header>
            <div className="set-b" role="tabpanel">
              {tab === 'general' && <GeneralTab />}
              {tab === 'gen' && <GenTab />}
              {tab === 'account' && <AccountTab />}
              {tab === 'env' && <EnvTab />}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
