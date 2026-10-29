import { app, BrowserWindow, dialog, shell } from 'electron'
import { EventEmitter } from 'node:events'
import { existsSync, promises as fs } from 'node:fs'
import { join } from 'node:path'
import {
  SETUP_STEPS,
  type AccountInfo,
  type DownloadProgress,
  type EnvItem,
  type EnvState,
  type EnvStatus,
  type SetupSnapshot,
  type SetupStepId,
  type StepInfo,
  type StepState,
  type TestGenInfo
} from '@shared/types'
import type { SettingsStore } from '../settings'
import type { CodexInstaller } from '../codex/installer'
import { PINNED_VERSION, compareVersions } from '../codex/installer'
import type { CodexService } from '../codex/service'
import { logger } from '../logger'
import { appDataDir, codexHome, testGenDir, userPathEntry, userPathExpanded } from '../paths'
import { addUserPath, enableLongPaths, isAdmin, readLongPathsEnabled, userPathHas } from '../system/windows'

type StepResult = 'ok' | 'wait' | 'error'

const TEST_PROMPT = [
  'Use your image generation tool to create ONE small, simple test image:',
  'a single glossy round blue game UI button with a white check mark, centered,',
  'on a solid flat magenta #FF00FF background. No text, no extra elements.',
  'Do not write any code or files yourself; just generate the image and reply with one short sentence.'
].join(' ')

function freshStep(id: SetupStepId): StepInfo {
  return { id, state: 'idle', need: null, sub: null, params: {}, progress: null, error: null }
}

function errorText(e: unknown): string {
  if (e instanceof Error) return e.message
  return String(e)
}

export class SetupService extends EventEmitter {
  private steps = new Map<SetupStepId, StepInfo>(SETUP_STEPS.map((id) => [id, freshStep(id)]))
  private started = false
  private running = false
  private quick = false
  private admin: boolean | null = null
  private download: DownloadProgress | null = null
  private login: { loginId: string; authUrl: string } | null = null
  private loginCancelling = false
  private testGen: TestGenInfo = { state: 'idle', error: null, savedPath: null, imageDataUrl: null, ms: null }
  private installedVersion: string | null = null
  private latestVersion: string | null = null
  private upgrading = false
  private pathPresent: boolean | null = null
  private longPathsOn: boolean | null = null
  private emitTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly settings: SettingsStore,
    private readonly installer: CodexInstaller,
    private readonly codex: CodexService
  ) {
    super()
    codex.on('loginCompleted', (e: { loginId: string | null; success: boolean; error: string | null }) => this.onLoginCompleted(e))
    codex.on('account', (acc: AccountInfo) => this.onAccount(acc))
  }

  log(message: string): void {
    logger.write('setup', message)
  }

  logLines(): string[] {
    return logger.recent().slice(-800)
  }

  snapshot(): SetupSnapshot {
    const steps = SETUP_STEPS.map((id) => ({ ...this.step(id), params: { ...this.step(id).params } }))
    return {
      steps,
      started: this.started,
      running: this.running,
      quick: this.quick,
      isAdmin: this.admin,
      canEnter: steps.every((s) => s.state === 'done' || s.state === 'skipped'),
      completedBefore: this.settings.get().setup.completed,
      download: this.download ? { ...this.download } : null,
      login: this.login ? { ...this.login } : null,
      testGen: { ...this.testGen }
    }
  }

  envStatus(): EnvStatus {
    const s = this.settings.get()
    const st = (id: SetupStepId): StepInfo => this.step(id)
    const fromStep = (id: SetupStepId, ok: boolean | null): EnvState => {
      const step = st(id)
      if (step.state === 'running' && !step.need) return 'installing'
      if (step.state === 'error') return 'error'
      if (ok === true || step.state === 'done') return 'installed'
      return 'missing'
    }
    const codexState: EnvState =
      this.installer.installing || this.upgrading || (st('codex').state === 'running' && st('codex').sub !== 'checking')
        ? 'installing'
        : st('codex').state === 'error'
          ? 'error'
          : this.installedVersion
            ? 'installed'
            : 'missing'
    const acc = this.codex.account
    const loginState: EnvState = acc?.loggedIn
      ? 'installed'
      : this.login || (st('login').state === 'running' && !st('login').need)
        ? 'installing'
        : st('login').state === 'error'
          ? 'error'
          : 'missing'
    const imgState: EnvState =
      this.testGen.state === 'running'
        ? 'installing'
        : this.testGen.state === 'error'
          ? 'error'
          : this.testGen.state === 'done' || s.setup.testGenOk
            ? 'installed'
            : 'missing'
    const wsOk = !!s.workspace && existsSync(s.workspace)
    const items: EnvItem[] = [
      { id: 'codex', state: codexState, detail: this.installedVersion, error: st('codex').error },
      {
        id: 'path',
        state: fromStep('path', this.pathPresent),
        detail: st('path').state === 'skipped' ? 'skipped' : userPathEntry,
        error: st('path').error
      },
      {
        id: 'longPath',
        state: fromStep('longPath', this.longPathsOn),
        detail: st('longPath').state === 'skipped' ? 'skipped' : null,
        error: st('longPath').error
      },
      {
        id: 'login',
        state: loginState,
        detail: acc?.loggedIn ? [acc.email, acc.planType].filter(Boolean).join(' · ') : null,
        error: st('login').error
      },
      { id: 'imageGen', state: imgState, detail: this.testGen.savedPath, error: this.testGen.error },
      { id: 'workspace', state: wsOk ? 'installed' : 'missing', detail: s.workspace, error: null }
    ]
    return {
      items,
      codexVersion: this.installedVersion,
      latestVersion: this.latestVersion,
      updateAvailable: !!this.installedVersion && !!this.latestVersion && compareVersions(this.latestVersion, this.installedVersion) > 0,
      upgrading: this.upgrading,
      codexHome,
      appDataDir
    }
  }

  private step(id: SetupStepId): StepInfo {
    let s = this.steps.get(id)
    if (!s) {
      s = freshStep(id)
      this.steps.set(id, s)
    }
    return s
  }

  private patch(id: SetupStepId, patch: Partial<Omit<StepInfo, 'id'>>): void {
    const cur = this.step(id)
    this.steps.set(id, { ...cur, ...patch })
    this.changed()
  }

  private set(id: SetupStepId, state: StepState, sub: string | null = null, params: StepInfo['params'] = {}): void {
    this.patch(id, { state, sub, params, need: null, error: null, progress: null })
  }

  private wait(id: SetupStepId, need: NonNullable<StepInfo['need']>, sub: string | null = null, params: StepInfo['params'] = {}): void {
    this.patch(id, { state: 'running', need, sub, params, progress: null })
  }

  private fail(id: SetupStepId, e: unknown): void {
    const msg = errorText(e)
    this.log(`ERROR [${id}] ${msg}`)
    this.patch(id, { state: 'error', need: null, error: msg, progress: null })
  }

  private changed(immediate = false): void {
    if (immediate) {
      if (this.emitTimer) clearTimeout(this.emitTimer)
      this.emitTimer = null
      this.flush()
      return
    }
    if (this.emitTimer) return
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null
      this.flush()
    }, 60)
  }

  private flush(): void {
    this.emit('changed', this.snapshot())
    this.emit('env', this.envStatus())
  }

  async start(quick: boolean): Promise<void> {
    if (this.running) return
    if (!this.started) this.log(`Gen Asset Studio ${app.getVersion()} · ${process.platform} ${process.arch} · ${quick ? 'quick check' : 'setup'}`)
    this.started = true
    this.quick = quick
    await this.loop()
  }

  async recheck(): Promise<void> {
    if (this.running) return
    for (const id of SETUP_STEPS) {
      const s = this.step(id)
      if (s.state === 'running' && s.need === 'loginWait') continue
      this.steps.set(id, freshStep(id))
    }
    this.changed(true)
    await this.start(true)
  }

  async retry(id: SetupStepId): Promise<void> {
    this.steps.set(id, freshStep(id))
    this.changed(true)
    await this.kick()
  }

  private async kick(): Promise<void> {
    if (this.running) return
    this.started = true
    await this.loop()
  }

  private async loop(): Promise<void> {
    this.running = true
    this.changed(true)
    try {
      for (const id of SETUP_STEPS) {
        const s = this.step(id)
        if (s.state === 'done' || s.state === 'skipped') continue
        if (s.state === 'running' && s.need) break
        if (s.state === 'error') break
        const r = await this.runStep(id)
        if (r !== 'ok') break
      }
    } finally {
      this.running = false
      const snap = this.snapshot()
      if (snap.canEnter && !this.settings.get().setup.completed) {
        await this.settings.update({ setup: { completed: true } })
        this.log('setup complete')
      }
      this.changed(true)
    }
  }

  private async runStep(id: SetupStepId): Promise<StepResult> {
    try {
      switch (id) {
        case 'perm':
          return await this.stepPerm()
        case 'codex':
          return await this.stepCodex()
        case 'path':
          return await this.stepPath()
        case 'longPath':
          return await this.stepLongPath()
        case 'login':
          return await this.stepLogin()
        case 'quota':
          return await this.stepQuota()
        case 'workspace':
          return await this.stepWorkspace()
      }
    } catch (e) {
      this.fail(id, e)
      return 'error'
    }
  }

  private async stepPerm(): Promise<StepResult> {
    this.set('perm', 'running', 'checking')
    this.admin = await isAdmin()
    this.log(`administrator: ${this.admin ? 'yes' : 'no'}`)
    this.set('perm', 'done', this.admin ? 'admin' : 'user')
    return 'ok'
  }

  private async stepCodex(): Promise<StepResult> {
    this.set('codex', 'running', 'checking')
    const existing = await this.installer.installedVersion()
    if (existing) {
      this.installedVersion = existing
      this.log(`Codex CLI ${existing} found at ${this.installer.exePath()}`)
      this.set('codex', 'done', 'ready', { version: existing })
      void this.checkUpdate()
      return 'ok'
    }
    this.log(`installing Codex CLI ${PINNED_VERSION} (${this.installer.target})`)
    await this.runInstall(PINNED_VERSION, false)
    this.set('codex', 'done', 'ready', { version: this.installedVersion ?? PINNED_VERSION })
    void this.checkUpdate()
    return 'ok'
  }

  private async runInstall(version: string, force: boolean): Promise<void> {
    this.download = null
    try {
      const v = await this.installer.install(
        version,
        (p) => {
          this.download = p
          const sub = p.phase === 'download' ? 'downloading' : p.phase === 'verify' ? 'verifying' : p.phase === 'extract' ? 'extracting' : p.phase === 'check' ? 'probing' : 'activating'
          const progress = p.phase === 'download' && p.total > 0 ? p.received / p.total : p.phase === 'download' ? null : 1
          if (p.phase !== 'download') this.log(`${sub}…`)
          this.patch('codex', { state: 'running', sub, progress, params: { received: p.received, total: p.total, version } })
        },
        force
      )
      this.installedVersion = v
      this.log(`Codex CLI ${v} installed → ${this.installer.exePath()}`)
    } finally {
      this.download = null
    }
  }

  async checkUpdate(): Promise<void> {
    const latest = await this.installer.latestVersion()
    if (latest) {
      this.latestVersion = latest
      if (this.installedVersion && compareVersions(latest, this.installedVersion) > 0) this.log(`Codex CLI update available: ${latest}`)
    }
    this.changed()
  }

  async reinstallCodex(): Promise<void> {
    await this.replaceCodex(this.installedVersion ?? PINNED_VERSION, true)
  }

  async upgradeCodex(): Promise<void> {
    const latest = this.latestVersion ?? (await this.installer.latestVersion())
    if (!latest) throw new Error('could not determine the latest Codex version')
    await this.replaceCodex(latest, false)
  }

  private async replaceCodex(version: string, force: boolean): Promise<void> {
    if (this.upgrading || this.installer.installing) return
    this.upgrading = true
    this.changed(true)
    const previous = this.installedVersion
    try {
      this.log(`${force ? 'reinstalling' : 'upgrading'} Codex CLI → ${version}`)
      await this.codex.stop()
      await this.runInstall(version, force)
      this.set('codex', 'done', 'ready', { version })
      await this.codex.ensureStarted()
      await this.codex.readAccount().catch(() => null)
    } catch (e) {
      this.fail('codex', e)
      if (previous && previous !== version && (await this.installer.listReleases()).includes(previous)) {
        this.log(`rolling back to ${previous}`)
        await this.installer.activate(previous).catch((err: Error) => this.log(`rollback failed: ${err.message}`))
        this.installedVersion = await this.installer.installedVersion()
      }
      await this.codex.ensureStarted().catch(() => undefined)
    } finally {
      this.upgrading = false
      this.changed(true)
    }
  }

  private async stepPath(): Promise<StepResult> {
    this.set('path', 'running', 'checking')
    this.pathPresent = await userPathHas(userPathEntry, userPathExpanded)
    if (this.pathPresent) {
      this.set('path', 'done', 'added', { entry: userPathEntry })
      return 'ok'
    }
    const choice = this.settings.get().setup.pathChoice
    if (choice === 'skipped') {
      this.set('path', 'skipped', 'skipped')
      return 'ok'
    }
    if (choice === 'added') {
      this.log('PATH entry missing, re-adding')
      await this.doAddPath()
      return 'ok'
    }
    this.wait('path', 'pathChoice', 'ask', { entry: userPathEntry })
    return 'wait'
  }

  private async doAddPath(): Promise<void> {
    this.set('path', 'running', 'adding')
    this.log(`HKCU\\Environment\\Path += ${userPathEntry}`)
    await addUserPath(userPathEntry, userPathExpanded)
    this.pathPresent = await userPathHas(userPathEntry, userPathExpanded)
    if (!this.pathPresent) throw new Error('PATH entry was not saved')
    await this.settings.update({ setup: { pathChoice: 'added' } })
    this.log('PATH updated, WM_SETTINGCHANGE broadcast')
    this.set('path', 'done', 'added', { entry: userPathEntry })
  }

  async pathChoice(add: boolean): Promise<void> {
    if (!add) {
      await this.settings.update({ setup: { pathChoice: 'skipped' } })
      this.log('PATH step skipped by user')
      this.set('path', 'skipped', 'skipped')
      await this.kick()
      return
    }
    try {
      await this.doAddPath()
    } catch (e) {
      this.fail('path', e)
      return
    }
    await this.kick()
  }

  private async stepLongPath(): Promise<StepResult> {
    this.set('longPath', 'running', 'checking')
    this.longPathsOn = await readLongPathsEnabled()
    this.log(`LongPathsEnabled = ${this.longPathsOn === null ? 'unknown' : this.longPathsOn ? 1 : 0}`)
    if (this.longPathsOn) {
      this.set('longPath', 'done', 'enabled')
      return 'ok'
    }
    if (this.admin) {
      await this.doEnableLongPaths(true)
      return 'ok'
    }
    if (this.settings.get().setup.longPathSkipped) {
      this.set('longPath', 'skipped', 'skipped')
      return 'ok'
    }
    this.wait('longPath', 'uac', 'needAdmin')
    return 'wait'
  }

  private async doEnableLongPaths(admin: boolean): Promise<void> {
    this.set('longPath', 'running', admin ? 'enabling' : 'waitingUac')
    this.log(`reg add ${'HKLM\\SYSTEM\\CurrentControlSet\\Control\\FileSystem'} /v LongPathsEnabled /d 1${admin ? '' : ' (UAC)'}`)
    const r = await enableLongPaths(admin)
    this.longPathsOn = await readLongPathsEnabled()
    if (this.longPathsOn) {
      await this.settings.update({ setup: { longPathSkipped: false } })
      this.set('longPath', 'done', 'enabled')
      return
    }
    if (r.code === 1223 || /cancel/i.test(r.stderr)) throw new Error('UAC prompt was cancelled')
    throw new Error(`could not enable LongPathsEnabled (exit ${r.code}) ${r.stderr.trim()}`)
  }

  async uac(grant: boolean): Promise<void> {
    if (!grant) {
      await this.settings.update({ setup: { longPathSkipped: true } })
      this.log('long paths step skipped by user')
      this.set('longPath', 'skipped', 'skipped')
      await this.kick()
      return
    }
    try {
      await this.doEnableLongPaths(!!this.admin)
    } catch (e) {
      const msg = errorText(e)
      this.log(`long paths: ${msg}`)
      if (/cancel/i.test(msg)) {
        this.patch('longPath', { state: 'running', need: 'uac', sub: 'needAdmin', error: msg })
        return
      }
      this.fail('longPath', e)
      return
    }
    await this.kick()
  }

  private async stepLogin(): Promise<StepResult> {
    this.set('login', 'running', 'checking')
    await this.codex.ensureStarted()
    const acc = await this.codex.readAccount()
    if (acc.loggedIn) {
      this.log(`signed in: ${acc.email ?? '?'} (${acc.planType ?? '?'})`)
      this.set('login', 'done', 'signedIn', { email: acc.email ?? '', plan: acc.planType ?? '' })
      return 'ok'
    }
    this.log('not signed in')
    this.wait('login', 'login', 'signedOut')
    return 'wait'
  }

  async startLogin(): Promise<void> {
    try {
      await this.codex.ensureStarted()
      if (this.login) await this.cancelLogin()
      const r = await this.codex.loginStart()
      this.login = r
      this.log(`account/login/start → loginId ${r.loginId}`)
      this.wait('login', 'loginWait', 'waiting')
      await shell.openExternal(r.authUrl)
    } catch (e) {
      this.login = null
      this.fail('login', e)
    }
  }

  async reopenLogin(): Promise<void> {
    if (this.login) await shell.openExternal(this.login.authUrl)
  }

  async cancelLogin(): Promise<void> {
    const cur = this.login
    if (!cur) return
    this.loginCancelling = true
    try {
      const status = await this.codex.loginCancel(cur.loginId)
      this.log(`account/login/cancel → ${status}`)
    } catch (e) {
      this.log(`login cancel failed: ${errorText(e)}`)
    }
    this.login = null
    this.wait('login', 'login', 'signedOut')
  }

  private onLoginCompleted(e: { loginId: string | null; success: boolean; error: string | null }): void {
    if (!this.login || (e.loginId && e.loginId !== this.login.loginId)) {
      this.loginCancelling = false
      return
    }
    const cancelled = this.loginCancelling
    this.loginCancelling = false
    this.login = null
    if (e.success) {
      this.log('login completed')
      void this.codex
        .readAccount()
        .then((acc) => {
          this.set('login', 'done', 'signedIn', { email: acc.email ?? '', plan: acc.planType ?? '' })
          return this.kick()
        })
        .catch((err: Error) => this.fail('login', err))
      return
    }
    this.log(`login not completed: ${e.error ?? 'unknown'}`)
    if (cancelled) {
      this.wait('login', 'login', 'signedOut')
      return
    }
    this.fail('login', new Error(e.error ?? 'login failed'))
  }

  private onAccount(acc: AccountInfo): void {
    if (!acc.loggedIn && this.step('login').state === 'done') {
      this.log('signed out')
      this.wait('login', 'login', 'signedOut')
      this.steps.set('quota', freshStep('quota'))
    }
    this.changed()
  }

  async logout(): Promise<void> {
    await this.codex.logout()
  }

  async switchAccount(): Promise<void> {
    await this.codex.logout()
    await this.startLogin()
  }

  private async stepQuota(): Promise<StepResult> {
    this.set('quota', 'running', 'reading')
    const rl = await this.codex.readRateLimits()
    const left = (w: { usedPercent: number } | null): number => (w ? Math.max(0, 100 - Math.round(w.usedPercent)) : 100)
    this.log(`rate limits: 5h used ${rl.primary?.usedPercent ?? '?'}% · week used ${rl.secondary?.usedPercent ?? '?'}%`)
    this.set('quota', 'done', 'quota', { h5: left(rl.primary), week: left(rl.secondary) })
    return 'ok'
  }

  async runTestGen(): Promise<void> {
    if (this.testGen.state === 'running') return
    this.testGen = { state: 'running', error: null, savedPath: null, imageDataUrl: null, ms: null }
    this.changed(true)
    this.log('test image generation…')
    try {
      await fs.mkdir(testGenDir, { recursive: true })
      const r = await this.codex.generateImage({ cwd: testGenDir }, TEST_PROMPT, [])
      if (r.error || r.status !== 'completed') throw new Error(r.error ?? `turn ${r.status}`)
      const img = r.images.find((i) => i.savedPath || i.base64)
      if (!img) throw new Error('no image returned')
      const failure = img.failure as { type?: string } | null
      if (failure) throw new Error(`image generation failed: ${failure.type ?? JSON.stringify(failure)}`)
      const dest = join(testGenDir, `test-${Date.now()}.png`)
      let bytes: Buffer
      if (img.savedPath && existsSync(img.savedPath)) bytes = await fs.readFile(img.savedPath)
      else bytes = Buffer.from(img.base64 ?? '', 'base64')
      await fs.writeFile(dest, bytes)
      this.log(`test image OK (${r.durationMs} ms) thread ${r.threadId} → ${dest}`)
      this.testGen = {
        state: 'done',
        error: null,
        savedPath: dest,
        imageDataUrl: `data:image/png;base64,${bytes.toString('base64')}`,
        ms: r.durationMs
      }
      await this.settings.update({ setup: { testGenOk: true } })
      void this.codex.readRateLimits().catch(() => null)
    } catch (e) {
      const msg = errorText(e)
      this.log(`ERROR [testGen] ${msg}`)
      this.testGen = { state: 'error', error: msg, savedPath: null, imageDataUrl: null, ms: null }
    }
    this.changed(true)
  }

  private async stepWorkspace(): Promise<StepResult> {
    this.set('workspace', 'running', 'checking')
    const ws = this.settings.get().workspace
    if (ws && existsSync(ws)) {
      this.set('workspace', 'done', 'chosen', { path: ws })
      return 'ok'
    }
    this.wait('workspace', 'workspace', 'choose')
    return 'wait'
  }

  async pickWorkspace(mode: 'new' | 'open', win: BrowserWindow | null): Promise<void> {
    const opts: Electron.OpenDialogOptions = {
      title: mode === 'new' ? 'Gen Asset Studio — workspace' : 'Gen Asset Studio — open workspace',
      defaultPath: mode === 'new' ? join(app.getPath('documents'), 'GenAssetStudio') : app.getPath('documents'),
      properties: ['openDirectory', 'createDirectory', 'promptToCreate', 'dontAddToRecent']
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    const dir = r.filePaths[0]
    if (r.canceled || !dir) return
    try {
      await fs.mkdir(dir, { recursive: true })
      await fs.access(dir)
      await this.settings.update({ workspace: dir })
      this.log(`workspace: ${dir}`)
      this.set('workspace', 'done', 'chosen', { path: dir })
    } catch (e) {
      this.fail('workspace', e)
      return
    }
    await this.kick()
  }
}
