import { app, BrowserWindow, dialog, shell, type IpcMain } from 'electron'
import { EventEmitter } from 'node:events'
import { existsSync, promises as fs } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, isAbsolute, join, parse, resolve, sep } from 'node:path'
import {
  DISK_CRITICAL_BYTES,
  DISK_LOW_BYTES,
  GEN_MIN_FREE_BYTES,
  SESSION_KEEP_DAYS,
  STORAGE_IPC,
  type CleanEntry,
  type CleanId,
  type CleanResult,
  type DiskWarn,
  type DriveInfo,
  type DriveKind,
  type MoveCheck,
  type MoveProgress,
  type StorageItem,
  type StorageScan,
  type StorageSnapshot
} from '@shared/storage'
import {
  appDataDir,
  cacheDir,
  codexCurrentDir,
  codexDownloadsDir,
  codexHome,
  codexHomeOverridden,
  codexImagesDir,
  codexReleasesDir,
  codexRoot,
  codexSessionsDir,
  customDataDir,
  DATA_DIR_NAME,
  defaultAppDataDir,
  inputCacheDir,
  logsDir,
  pathEntryFor,
  testGenDir,
  updaterCacheDir
} from '../paths'
import { addUserPath, listLogicalDisks, removeUserPath } from '../system/windows'
import { saveStorageConfig, storageConfig } from './config'
import type { LogFn } from '../logger'

const GB = 1024 * 1024 * 1024
const DAY = 24 * 60 * 60 * 1000
const IMAGE_SWEEP_AGE = 60 * 60 * 1000
const IMAGE_MANUAL_AGE = 10 * 60 * 1000
const INPUT_CACHE_AGE = DAY
const SWEEP_INTERVAL = 30 * 60 * 1000
const MOVE_MARGIN = GB
const BANNER_APP_BYTES = GB
const legacyInputDir = join(tmpdir(), 'gas-codex-input')

export interface StorageDeps {
  log: LogFn
  workspace: () => string | null
  busy: () => number
  pathAdded: () => boolean
  updateDownloaded: () => boolean
  shutdown: () => Promise<void>
}

interface Tally {
  bytes: number
  files: number
}

interface FileEntry {
  path: string
  size: number
  mtime: number
}

interface Target {
  path: string
  bytes: number
  files: number
  dir: boolean
}

const same = (a: string, b: string): boolean => resolve(a).toLowerCase() === resolve(b).toLowerCase()
const inside = (child: string, parent: string): boolean => resolve(child).toLowerCase().startsWith(resolve(parent).toLowerCase().replace(/[\\/]+$/, '') + sep)

async function listFiles(dir: string, skipDir?: (abs: string, name: string) => boolean): Promise<FileEntry[]> {
  const out: FileEntry[] = []
  const stack = [dir]
  while (stack.length) {
    const cur = stack.pop() as string
    let entries: import('node:fs').Dirent[]
    try {
      entries = await fs.readdir(cur, { withFileTypes: true })
    } catch {
      continue
    }
    for (const e of entries) {
      const abs = join(cur, e.name)
      if (e.isSymbolicLink()) continue
      if (e.isDirectory()) {
        if (!skipDir || !skipDir(abs, e.name)) stack.push(abs)
        continue
      }
      if (!e.isFile()) continue
      try {
        const st = await fs.stat(abs)
        out.push({ path: abs, size: st.size, mtime: st.mtimeMs })
      } catch {
        continue
      }
    }
  }
  return out
}

async function tally(dir: string, skipDir?: (abs: string, name: string) => boolean): Promise<Tally> {
  const files = await listFiles(dir, skipDir)
  return { bytes: files.reduce((s, f) => s + f.size, 0), files: files.length }
}

const sumTargets = (list: Target[]): Tally => ({ bytes: list.reduce((s, t) => s + t.bytes, 0), files: list.reduce((s, t) => s + t.files, 0) })

async function freeBytes(p: string): Promise<{ free: number; total: number } | null> {
  try {
    const s = await fs.statfs(p)
    return { free: Number(s.bavail) * Number(s.bsize), total: Number(s.blocks) * Number(s.bsize) }
  } catch {
    return null
  }
}

async function existingAncestor(p: string): Promise<string | null> {
  let cur = resolve(p)
  for (;;) {
    if (existsSync(cur)) return cur
    const up = dirname(cur)
    if (up === cur) return null
    cur = up
  }
}

function driveKind(type: number): DriveKind {
  if (type === 3) return 'fixed'
  if (type === 2) return 'removable'
  if (type === 4) return 'network'
  return 'other'
}

function systemRoot(): string {
  return `${(process.env['SystemDrive'] || 'C:').replace(/[\\/]+$/, '')}\\`
}

export function normalizeTarget(dir: string): string {
  const abs = resolve(dir)
  return basename(abs).toLowerCase() === DATA_DIR_NAME.toLowerCase() ? abs : join(abs, DATA_DIR_NAME)
}

export function suggestedWorkspaceDir(): string {
  if (customDataDir) return join(parse(appDataDir).root, 'GenAssetStudio Workspace')
  return join(app.getPath('documents'), 'GenAssetStudio')
}

export async function removeGeneratedImage(p: string | null | undefined): Promise<void> {
  if (!p || !storageConfig().autoClean || !inside(p, codexImagesDir)) return
  await fs.rm(p, { force: true }).catch(() => undefined)
}

export async function hasGenSpace(projectPath: string): Promise<boolean> {
  for (const p of [projectPath, codexHome]) {
    const anc = await existingAncestor(p)
    const space = anc ? await freeBytes(anc) : null
    if (space && space.free < GEN_MIN_FREE_BYTES) return false
  }
  return true
}

export class StorageService extends EventEmitter {
  private progress: MoveProgress = { phase: 'idle', copied: 0, total: 0, error: null }
  private sweepTimer: NodeJS.Timeout | null = null
  private appBytesCache: { at: number; bytes: number } | null = null

  constructor(private readonly deps: StorageDeps) {
    super()
  }

  start(): void {
    setTimeout(() => void this.finishOldCleanup(), 8000)
    setTimeout(() => void this.sweep(), 20000)
    this.sweepTimer = setInterval(() => void this.sweep(), SWEEP_INTERVAL)
  }

  dispose(): void {
    if (this.sweepTimer) clearInterval(this.sweepTimer)
    this.sweepTimer = null
  }

  async snapshot(): Promise<StorageSnapshot> {
    const cfg = storageConfig()
    const root = parse(appDataDir).root
    const sys = systemRoot()
    const space = await freeBytes(root)
    const sysSpace = same(root, sys) ? space : await freeBytes(sys)
    const appBytes = await this.appBytes()
    const free = space?.free ?? Number.POSITIVE_INFINITY
    const warn: DiskWarn = free < DISK_CRITICAL_BYTES ? 'critical' : free < DISK_LOW_BYTES ? 'low' : 'none'
    const onSystem = same(root, sys)
    const sysLow = (sysSpace?.free ?? Number.POSITIVE_INFINITY) < DISK_LOW_BYTES
    const banner = warn === 'critical' || (!cfg.bannerDismissed && onSystem && (appBytes > BANNER_APP_BYTES || sysLow))
    return {
      dataRoot: appDataDir,
      defaultRoot: defaultAppDataDir,
      custom: customDataDir,
      codexHomeOverridden,
      autoClean: cfg.autoClean,
      systemDrive: sys,
      dataDrive: space ? { root, label: '', free: space.free, total: space.total, system: onSystem, kind: 'fixed' } : null,
      warn,
      banner,
      appBytes
    }
  }

  async scan(): Promise<StorageScan> {
    const homeSkip = (abs: string): boolean => same(abs, codexImagesDir) || same(abs, codexSessionsDir)
    const [codex, images, sessions, home, cache, testGen, logs, updater] = await Promise.all([
      tally(codexRoot),
      tally(codexImagesDir),
      tally(codexSessionsDir),
      tally(codexHome, homeSkip),
      tally(cacheDir),
      tally(testGenDir),
      tally(logsDir),
      tally(updaterCacheDir)
    ])
    const items: StorageItem[] = [
      { id: 'codex', path: codexRoot, ...codex, movable: true },
      { id: 'codexImages', path: codexImagesDir, ...images, movable: !codexHomeOverridden },
      { id: 'codexSessions', path: codexSessionsDir, ...sessions, movable: !codexHomeOverridden },
      { id: 'codexHome', path: codexHome, ...home, movable: !codexHomeOverridden },
      { id: 'cache', path: cacheDir, bytes: cache.bytes + testGen.bytes, files: cache.files + testGen.files, movable: true },
      { id: 'logs', path: logsDir, ...logs, movable: true },
      { id: 'updater', path: updaterCacheDir, ...updater, movable: false }
    ]
    const ws = this.deps.workspace()
    if (ws) items.push({ id: 'workspace', path: ws, ...(await tally(ws)), movable: false })
    const installDir = app.isPackaged ? process.env['PORTABLE_EXECUTABLE_DIR'] || dirname(process.execPath) : null
    if (installDir) items.push({ id: 'install', path: installDir, ...(process.env['PORTABLE_EXECUTABLE_DIR'] ? { bytes: 0, files: 0 } : await tally(installDir)), movable: false })
    return { items, scannedAt: Date.now() }
  }

  async drives(): Promise<DriveInfo[]> {
    const sys = systemRoot()
    try {
      const disks = await listLogicalDisks()
      return disks
        .map((d) => ({ root: d.root, label: d.label, free: d.free, total: d.total, system: same(d.root, sys), kind: driveKind(d.type) }))
        .filter((d) => d.total > 0 && (d.kind === 'fixed' || d.kind === 'removable'))
    } catch (e) {
      this.deps.log(`list drives failed: ${(e as Error).message}`)
      return []
    }
  }

  async cleanPlan(): Promise<CleanEntry[]> {
    const ids: CleanId[] = ['codexImages', 'codexSessions', 'oldCodex', 'cache', 'updater']
    const out: CleanEntry[] = []
    for (const id of ids) out.push({ id, ...sumTargets(await this.targets(id, false)) })
    return out
  }

  async clean(ids: CleanId[]): Promise<CleanResult> {
    const res: CleanResult = { freed: 0, files: 0, errors: 0 }
    for (const id of ids) {
      for (const t of await this.targets(id, false)) {
        try {
          await fs.rm(t.path, { recursive: t.dir, force: true })
          res.freed += t.bytes
          res.files += t.files
        } catch {
          res.errors++
        }
      }
    }
    this.deps.log(`clean ${ids.join(',')}: freed ${(res.freed / 1048576).toFixed(1)} MB, ${res.files} files, ${res.errors} errors`)
    this.appBytesCache = null
    void this.emitChanged()
    return res
  }

  async setAutoClean(on: boolean): Promise<StorageSnapshot> {
    saveStorageConfig({ autoClean: on })
    if (on) void this.sweep()
    return this.emitChanged()
  }

  async dismissBanner(): Promise<StorageSnapshot> {
    saveStorageConfig({ bannerDismissed: true })
    return this.emitChanged()
  }

  async pickDir(win: BrowserWindow | null): Promise<string | null> {
    const drives = await this.drives()
    const other = drives.find((d) => !d.system && d.kind === 'fixed')
    const opts: Electron.OpenDialogOptions = {
      title: 'Gen Asset Studio — data folder',
      defaultPath: other ? other.root : parse(appDataDir).root,
      properties: ['openDirectory', 'createDirectory', 'promptToCreate', 'dontAddToRecent']
    }
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? null : (r.filePaths[0] ?? null)
  }

  async open(p: string): Promise<void> {
    if (p && existsSync(p)) await shell.openPath(p)
  }

  async check(dir: string): Promise<MoveCheck> {
    const base: MoveCheck = { ok: false, target: dir, error: null, need: 0, free: 0, removable: false }
    if (!dir || !isAbsolute(dir)) return { ...base, error: 'invalid' }
    const target = normalizeTarget(dir)
    base.target = target
    if (target.startsWith('\\\\')) return { ...base, error: 'network' }
    if (same(target, appDataDir)) return { ...base, error: 'same' }
    if (inside(target, appDataDir) || inside(appDataDir, target)) return { ...base, error: 'nested' }
    const need = (await this.sourceFiles()).reduce((s, f) => s + f.size, 0)
    const anc = await existingAncestor(target)
    if (!anc) return { ...base, need, error: 'invalid' }
    const space = await freeBytes(anc)
    const free = space?.free ?? 0
    const drives = await this.drives()
    const removable = drives.some((d) => d.kind === 'removable' && same(d.root, parse(target).root))
    const out: MoveCheck = { ...base, need, free, removable }
    try {
      const probe = join(anc, `.gas-write-test-${process.pid}`)
      await fs.writeFile(probe, 'ok')
      await fs.rm(probe, { force: true })
    } catch {
      return { ...out, error: 'notWritable' }
    }
    if (free < need + MOVE_MARGIN) return { ...out, error: 'noSpace' }
    if (this.deps.busy() > 0) return { ...out, error: 'busy' }
    return { ...out, ok: true }
  }

  async move(dir: string): Promise<MoveProgress> {
    if (this.progress.phase !== 'idle' && this.progress.phase !== 'error') return this.progress
    const c = await this.check(dir)
    if (!c.ok) return this.setProgress({ phase: 'error', copied: 0, total: 0, error: c.error })
    const target = c.target
    const files = await this.sourceFiles()
    const total = files.reduce((s, f) => s + f.size, 0)
    const created = !existsSync(target)
    let stopped = false
    this.deps.log(`move data ${appDataDir} → ${target} (${(total / 1048576).toFixed(1)} MB)`)
    try {
      this.setProgress({ phase: 'copy', copied: 0, total, error: null })
      let copied = 0
      let last = 0
      const onBytes = (n: number): void => {
        copied += n
        const now = Date.now()
        if (now - last > 150) {
          last = now
          this.setProgress({ phase: 'copy', copied, total, error: null })
        }
      }
      await this.copyTree(appDataDir, target, files, onBytes)
      this.setProgress({ phase: 'verify', copied: total, total, error: null })
      await this.verify(appDataDir, target, files)
      this.setProgress({ phase: 'stop', copied: total, total, error: null })
      stopped = true
      await this.deps.shutdown()
      const after = await this.sourceFiles()
      await this.copyTree(appDataDir, target, after, () => undefined)
      await this.verify(appDataDir, target, after)
      await this.relinkCurrent(target)
      this.setProgress({ phase: 'path', copied: total, total, error: null })
      await this.movePathEntry(target)
      saveStorageConfig({ dataRoot: same(target, defaultAppDataDir) ? null : target, cleanupOld: appDataDir, bannerDismissed: false })
      this.deps.log(`move data done → ${target}, restarting`)
      this.setProgress({ phase: 'restart', copied: total, total, error: null })
      setTimeout(() => {
        app.relaunch()
        app.exit(0)
      }, 1200)
      return this.progress
    } catch (e) {
      const msg = (e as Error).message
      this.deps.log(`move data failed: ${msg}`)
      if (created) await fs.rm(target, { recursive: true, force: true }).catch(() => undefined)
      if (stopped) {
        this.setProgress({ phase: 'error', copied: 0, total, error: msg })
        setTimeout(() => {
          app.relaunch()
          app.exit(0)
        }, 4000)
        return this.progress
      }
      return this.setProgress({ phase: 'error', copied: 0, total, error: msg })
    }
  }

  private setProgress(p: MoveProgress): MoveProgress {
    this.progress = p
    this.emit('progress', p)
    return p
  }

  private async emitChanged(): Promise<StorageSnapshot> {
    const s = await this.snapshot()
    this.emit('changed', s)
    return s
  }

  private async appBytes(): Promise<number> {
    if (this.appBytesCache && Date.now() - this.appBytesCache.at < 60000) return this.appBytesCache.bytes
    const t = await tally(appDataDir)
    this.appBytesCache = { at: Date.now(), bytes: t.bytes }
    return t.bytes
  }

  private async sourceFiles(): Promise<FileEntry[]> {
    return listFiles(appDataDir, (abs, name) => same(abs, codexDownloadsDir) || (same(dirname(abs), codexReleasesDir) && name.startsWith('.staging.')))
  }

  private async copyTree(src: string, dst: string, files: FileEntry[], onBytes: (n: number) => void): Promise<void> {
    await fs.mkdir(dst, { recursive: true })
    for (const f of files) {
      const rel = f.path.slice(src.length).replace(/^[\\/]+/, '')
      const out = join(dst, rel)
      let cur: FileEntry | null = null
      try {
        const st = await fs.stat(f.path)
        cur = { path: f.path, size: st.size, mtime: st.mtimeMs }
      } catch {
        continue
      }
      try {
        const dt = await fs.stat(out)
        if (dt.size === cur.size && dt.mtimeMs >= cur.mtime) {
          onBytes(cur.size)
          continue
        }
      } catch {
        await fs.mkdir(dirname(out), { recursive: true })
      }
      await fs.copyFile(f.path, out)
      await fs.utimes(out, new Date(), new Date(cur.mtime)).catch(() => undefined)
      onBytes(cur.size)
    }
  }

  private async verify(src: string, dst: string, files: FileEntry[]): Promise<void> {
    for (const f of files) {
      if (!existsSync(f.path)) continue
      const rel = f.path.slice(src.length).replace(/^[\\/]+/, '')
      const st = await fs.stat(join(dst, rel)).catch(() => null)
      if (!st) throw new Error(`copy check failed: missing ${rel}`)
      const now = await fs.stat(f.path).catch(() => null)
      if (now && st.size !== now.size) throw new Error(`copy check failed: size mismatch ${rel}`)
    }
  }

  private async relinkCurrent(target: string): Promise<void> {
    let name: string | null = null
    try {
      name = basename(await fs.readlink(codexCurrentDir))
    } catch {
      name = null
    }
    if (!name) return
    const rel = join(target, 'codex', 'releases', name)
    if (!existsSync(rel)) throw new Error(`codex release ${name} missing after copy`)
    const link = join(target, 'codex', 'current')
    await fs.rm(link, { force: true }).catch(() => undefined)
    await fs.symlink(rel, link, 'junction')
  }

  private async movePathEntry(target: string): Promise<void> {
    if (!this.deps.pathAdded()) return
    try {
      await removeUserPath(pathEntryFor(appDataDir), join(codexCurrentDir, 'bin'))
      await addUserPath(pathEntryFor(target), join(target, 'codex', 'current', 'bin'))
    } catch (e) {
      this.deps.log(`PATH update failed: ${(e as Error).message}`)
    }
  }

  private async finishOldCleanup(): Promise<void> {
    const old = storageConfig().cleanupOld
    if (!old) return
    if (same(old, appDataDir) || inside(appDataDir, old) || inside(old, appDataDir)) {
      saveStorageConfig({ cleanupOld: null })
      return
    }
    if (basename(old).toLowerCase() !== DATA_DIR_NAME.toLowerCase()) {
      this.deps.log(`skip removing old data folder with unexpected name: ${old}`)
      saveStorageConfig({ cleanupOld: null })
      return
    }
    this.deps.log(`removing old data folder ${old}`)
    await fs.rm(join(old, 'codex', 'current'), { force: true }).catch(() => undefined)
    try {
      await fs.rm(old, { recursive: true, force: true })
      saveStorageConfig({ cleanupOld: null })
    } catch (e) {
      this.deps.log(`remove ${old} failed: ${(e as Error).message}`)
    }
    this.appBytesCache = null
  }

  private async sweep(): Promise<void> {
    if (!storageConfig().autoClean) return
    const list = [...(await this.targets('codexImages', true)), ...(await this.targets('codexSessions', true)), ...(await this.inputCacheTargets(INPUT_CACHE_AGE))]
    let freed = 0
    for (const t of list) {
      try {
        await fs.rm(t.path, { recursive: t.dir, force: true })
        freed += t.bytes
      } catch {
        continue
      }
    }
    if (list.length) this.deps.log(`auto clean: ${list.length} items, ${(freed / 1048576).toFixed(1)} MB`)
    this.appBytesCache = null
  }

  private async inputCacheTargets(minAge: number): Promise<Target[]> {
    const now = Date.now()
    const out: Target[] = []
    for (const d of [inputCacheDir, legacyInputDir]) {
      for (const f of await listFiles(d)) if (now - f.mtime > minAge) out.push({ path: f.path, bytes: f.size, files: 1, dir: false })
    }
    return out
  }

  private async targets(id: CleanId, auto: boolean): Promise<Target[]> {
    const now = Date.now()
    const asFiles = (list: FileEntry[]): Target[] => list.map((f) => ({ path: f.path, bytes: f.size, files: 1, dir: false }))
    if (id === 'codexImages') {
      const age = auto ? IMAGE_SWEEP_AGE : IMAGE_MANUAL_AGE
      return asFiles((await listFiles(codexImagesDir)).filter((f) => now - f.mtime > age))
    }
    if (id === 'codexSessions') return asFiles((await listFiles(codexSessionsDir)).filter((f) => now - f.mtime > SESSION_KEEP_DAYS * DAY))
    if (id === 'cache') {
      const test = await listFiles(testGenDir)
      return [...(await this.inputCacheTargets(0)), ...asFiles(test)]
    }
    if (id === 'updater') {
      if (this.deps.updateDownloaded() || !existsSync(updaterCacheDir)) return []
      const t = await tally(updaterCacheDir)
      return t.files ? [{ path: updaterCacheDir, ...t, dir: true }] : []
    }
    const out: Target[] = []
    if (existsSync(codexDownloadsDir)) {
      const t = await tally(codexDownloadsDir)
      if (t.files) out.push({ path: codexDownloadsDir, ...t, dir: true })
    }
    let current: string | null = null
    try {
      current = basename(await fs.readlink(codexCurrentDir)).toLowerCase()
    } catch {
      current = null
    }
    let names: string[] = []
    try {
      names = await fs.readdir(codexReleasesDir)
    } catch {
      names = []
    }
    for (const n of names) {
      const stale = n.startsWith('.staging.') || (current !== null && n.toLowerCase() !== current)
      if (!stale) continue
      const p = join(codexReleasesDir, n)
      out.push({ path: p, ...(await tally(p)), dir: true })
    }
    return out
  }
}

const str = (v: unknown): string => (typeof v === 'string' ? v : '')
const CLEAN_IDS: readonly CleanId[] = ['codexImages', 'codexSessions', 'oldCodex', 'cache', 'updater']

export function registerStorageIpc(ipc: IpcMain, getWindow: () => BrowserWindow | null, service: StorageService): void {
  const send = (channel: string, payload: unknown): void => {
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
  }
  service.on('progress', (p: MoveProgress) => send(STORAGE_IPC.progress, p))
  service.on('changed', (s: StorageSnapshot) => send(STORAGE_IPC.changed, s))
  ipc.handle(STORAGE_IPC.get, () => service.snapshot())
  ipc.handle(STORAGE_IPC.scan, () => service.scan())
  ipc.handle(STORAGE_IPC.drives, () => service.drives())
  ipc.handle(STORAGE_IPC.cleanPlan, () => service.cleanPlan())
  ipc.handle(STORAGE_IPC.clean, (_e, ids: unknown) =>
    service.clean(Array.isArray(ids) ? ids.filter((x): x is CleanId => CLEAN_IDS.includes(x as CleanId)) : [])
  )
  ipc.handle(STORAGE_IPC.setAutoClean, (_e, on: unknown) => service.setAutoClean(on === true))
  ipc.handle(STORAGE_IPC.pickDir, (e) => service.pickDir(BrowserWindow.fromWebContents(e.sender)))
  ipc.handle(STORAGE_IPC.check, (_e, dir: unknown) => service.check(str(dir)))
  ipc.handle(STORAGE_IPC.move, (_e, dir: unknown) => service.move(str(dir)))
  ipc.handle(STORAGE_IPC.open, (_e, p: unknown) => service.open(str(p)))
  ipc.handle(STORAGE_IPC.dismissBanner, () => service.dismissBanner())
}
