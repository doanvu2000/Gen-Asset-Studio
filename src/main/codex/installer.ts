import { net } from 'electron'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, type WriteStream } from 'node:fs'
import { promises as fs } from 'node:fs'
import { arch } from 'node:os'
import { join } from 'node:path'
import * as tar from 'tar'
import type { DownloadProgress } from '@shared/types'
import { codexCurrentDir, codexDownloadsDir, codexReleasesDir, codexRoot } from '../paths'
import { run } from '../system/windows'
import type { LogFn } from '../logger'

export const PINNED_VERSION = '0.165.0'

export type CodexTarget = 'x86_64-pc-windows-msvc' | 'aarch64-pc-windows-msvc' | 'aarch64-apple-darwin' | 'x86_64-apple-darwin'

const PRIMARY_BASE = 'https://releases.openai.com/codex/releases'
const GITHUB_BASE = 'https://github.com/openai/codex/releases/download'
const LATEST_URL = 'https://releases.openai.com/codex/channels/latest'
const GITHUB_LATEST_URL = 'https://api.github.com/repos/openai/codex/releases/latest'
const SUMS_NAME = 'codex-package_SHA256SUMS'
const MIN_FREE_BYTES = 1024 * 1024 * 1024

export function detectTarget(): CodexTarget {
  if (process.platform === 'win32') {
    const hints = [process.env['PROCESSOR_ARCHITEW6432'], process.env['PROCESSOR_ARCHITECTURE'], process.env['PROCESSOR_IDENTIFIER'], arch()]
    const isArm = hints.some((h) => typeof h === 'string' && /arm/i.test(h))
    return isArm ? 'aarch64-pc-windows-msvc' : 'x86_64-pc-windows-msvc'
  }
  if (process.platform === 'darwin') return arch() === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin'
  throw new Error(`unsupported platform ${process.platform}/${arch()}`)
}

function isWindowsTarget(target: CodexTarget): boolean {
  return target.endsWith('windows-msvc')
}

export function requiredFiles(target: CodexTarget): string[] {
  const ext = isWindowsTarget(target) ? '.exe' : ''
  const base = ['codex-package.json', `bin/codex${ext}`, `bin/codex-code-mode-host${ext}`, `codex-path/rg${ext}`]
  if (!isWindowsTarget(target)) return base
  return [...base, 'codex-resources/codex-command-runner.exe', 'codex-resources/codex-windows-sandbox-setup.exe']
}

export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  const pb = b.split(/[.-]/).map((x) => parseInt(x, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0)
    if (d !== 0) return d
  }
  return 0
}

interface PackageManifest {
  layoutVersion?: number
  version?: string
  target?: string
  entrypoint?: string
}

export type ProgressFn = (p: DownloadProgress) => void

export class CodexInstaller {
  readonly target: CodexTarget = detectTarget()
  private busy = false

  constructor(private readonly log: LogFn) {}

  get installing(): boolean {
    return this.busy
  }

  releaseDir(version: string): string {
    return join(codexReleasesDir, `${version}-${this.target}`)
  }

  exePath(): string {
    return join(codexCurrentDir, 'bin', isWindowsTarget(this.target) ? 'codex.exe' : 'codex')
  }

  async installedVersion(): Promise<string | null> {
    try {
      const manifest = await this.readManifest(codexCurrentDir)
      if (!manifest.version) return null
      const missing = await this.missingFiles(codexCurrentDir)
      if (missing.length > 0) return null
      return manifest.version
    } catch {
      return null
    }
  }

  async probeVersion(dir = codexCurrentDir): Promise<string> {
    const exe = join(dir, 'bin', isWindowsTarget(this.target) ? 'codex.exe' : 'codex')
    const r = await run(exe, ['--version'], 60000)
    const m = /codex-cli\s+([0-9][^\s]*)/.exec(r.stdout)
    if (r.code !== 0 || !m) throw new Error(`codex --version failed (exit ${r.code}): ${(r.stderr || r.stdout).trim().slice(0, 400)}`)
    return m[1] ?? ''
  }

  async listReleases(): Promise<string[]> {
    try {
      const names = await fs.readdir(codexReleasesDir)
      return names.filter((n) => n.endsWith(`-${this.target}`)).map((n) => n.slice(0, -(this.target.length + 1)))
    } catch {
      return []
    }
  }

  async latestVersion(): Promise<string | null> {
    for (const url of [LATEST_URL, GITHUB_LATEST_URL]) {
      try {
        const res = await net.fetch(url, { headers: { Accept: 'application/json', 'User-Agent': 'GenAssetStudio' } })
        if (!res.ok) continue
        const json = (await res.json()) as { tag_name?: string }
        const m = /^rust-v(\d+\.\d+\.\d+)$/.exec(json.tag_name ?? '')
        if (m?.[1]) return m[1]
      } catch (e) {
        this.log(`latest version check failed at ${url}: ${(e as Error).message}`)
      }
    }
    return null
  }

  async install(version: string, onProgress: ProgressFn, force = false): Promise<string> {
    if (this.busy) throw new Error('Codex install already in progress')
    this.busy = true
    try {
      return await this.doInstall(version, onProgress, force)
    } finally {
      this.busy = false
    }
  }

  async activate(version: string): Promise<void> {
    const dir = this.releaseDir(version)
    const missing = await this.missingFiles(dir)
    if (missing.length) throw new Error(`release ${version} incomplete: missing ${missing.join(', ')}`)
    await fs.mkdir(codexRoot, { recursive: true })
    const tmp = `${codexCurrentDir}.new`
    await fs.rm(tmp, { force: true }).catch(() => undefined)
    await fs.symlink(dir, tmp, 'junction')
    await fs.rm(codexCurrentDir, { force: true }).catch(() => undefined)
    await fs.rename(tmp, codexCurrentDir)
    this.log(`junction current → ${dir}`)
  }

  private async doInstall(version: string, onProgress: ProgressFn, force: boolean): Promise<string> {
    const dir = this.releaseDir(version)
    if (!force && (await this.missingFiles(dir)).length === 0) {
      this.log(`release ${version} already present at ${dir}`)
      onProgress({ phase: 'check', received: 0, total: 0, source: '' })
      const v = await this.probeVersion(dir)
      if (v !== version) throw new Error(`codex --version reports ${v}, expected ${version}`)
      onProgress({ phase: 'activate', received: 0, total: 0, source: '' })
      await this.activate(version)
      return version
    }

    await fs.mkdir(codexDownloadsDir, { recursive: true })
    await this.ensureFreeSpace()

    const asset = `codex-package-${this.target}.tar.gz`
    const bases = [`${PRIMARY_BASE}/${version}`, `${GITHUB_BASE}/rust-v${version}`]
    let lastError: Error | null = null
    let archive: string | null = null
    for (const base of bases) {
      try {
        const sums = await this.fetchText(`${base}/${SUMS_NAME}`)
        const expected = this.findSum(sums, asset)
        this.log(`expected sha256 ${expected} (${base})`)
        archive = await this.download(`${base}/${asset}`, join(codexDownloadsDir, `${asset}.${version}`), expected, onProgress, base)
        break
      } catch (e) {
        lastError = e as Error
        this.log(`download from ${base} failed: ${lastError.message}`)
      }
    }
    if (!archive) throw lastError ?? new Error('download failed')

    onProgress({ phase: 'extract', received: 0, total: 0, source: '' })
    const staging = join(codexReleasesDir, `.staging.${version}.${process.pid}`)
    await fs.rm(staging, { recursive: true, force: true })
    await fs.mkdir(staging, { recursive: true })
    this.log(`extracting ${archive} → ${staging}`)
    await tar.x({ file: archive, cwd: staging })
    const root = await this.findPackageRoot(staging)
    const manifest = await this.readManifest(root)
    if (manifest.layoutVersion !== 1) throw new Error(`unsupported package layoutVersion ${String(manifest.layoutVersion)}`)
    if (manifest.version !== version) throw new Error(`package version ${String(manifest.version)} ≠ ${version}`)
    if (manifest.target && manifest.target !== this.target) throw new Error(`package target ${manifest.target} ≠ ${this.target}`)
    const missing = await this.missingFiles(root)
    if (missing.length) throw new Error(`package incomplete, missing: ${missing.join(', ')}`)

    onProgress({ phase: 'check', received: 0, total: 0, source: '' })
    const probed = await this.probeVersion(root)
    if (probed !== version) throw new Error(`codex --version reports ${probed}, expected ${version}`)
    this.log(`codex --version → codex-cli ${probed}`)

    const wasCurrent = await this.currentTarget()
    if (existsSync(dir)) {
      if (wasCurrent && wasCurrent.toLowerCase() === dir.toLowerCase()) await fs.rm(codexCurrentDir, { force: true })
      await fs.rm(dir, { recursive: true, force: true })
    }
    await fs.rename(root, dir)
    if (root !== staging) await fs.rm(staging, { recursive: true, force: true })

    onProgress({ phase: 'activate', received: 0, total: 0, source: '' })
    await this.activate(version)
    await fs.rm(archive, { force: true })
    return version
  }

  private async currentTarget(): Promise<string | null> {
    try {
      return await fs.readlink(codexCurrentDir)
    } catch {
      return null
    }
  }

  private async ensureFreeSpace(): Promise<void> {
    try {
      const s = await fs.statfs(codexRoot)
      const free = Number(s.bavail) * Number(s.bsize)
      if (free < MIN_FREE_BYTES) throw new Error(`not enough free disk space: ${(free / 1048576).toFixed(0)} MB free, need ≥ 1024 MB`)
    } catch (e) {
      if ((e as Error).message.startsWith('not enough')) throw e
    }
  }

  private async fetchText(url: string): Promise<string> {
    const res = await net.fetch(url, { headers: { 'User-Agent': 'GenAssetStudio' } })
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
    return res.text()
  }

  private findSum(sums: string, asset: string): string {
    for (const line of sums.split(/\r?\n/)) {
      const m = /^([0-9a-f]{64})\s+\*?(.+)$/i.exec(line.trim())
      if (m && m[2]?.trim() === asset) return (m[1] ?? '').toLowerCase()
    }
    throw new Error(`${asset} not listed in ${SUMS_NAME}`)
  }

  private async download(url: string, dest: string, expected: string, onProgress: ProgressFn, source: string): Promise<string> {
    const part = `${dest}.part`
    let offset = 0
    try {
      offset = (await fs.stat(part)).size
    } catch {
      offset = 0
    }
    const headers: Record<string, string> = { 'User-Agent': 'GenAssetStudio' }
    if (offset > 0) headers['Range'] = `bytes=${offset}-`
    this.log(`GET ${url}${offset > 0 ? ` (resume at ${offset})` : ''}`)
    const res = await net.fetch(url, { headers })
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status} for ${url}`)
    const resumed = offset > 0 && res.status === 206
    if (!resumed) offset = 0
    const hash = createHash('sha256')
    if (resumed) {
      await new Promise<void>((resolve, reject) => {
        createReadStream(part)
          .on('data', (chunk) => hash.update(chunk))
          .on('end', () => resolve())
          .on('error', reject)
      })
    }
    const length = Number(res.headers.get('content-length') ?? '0')
    const total = length > 0 ? offset + length : 0
    const out = createWriteStream(part, { flags: resumed ? 'a' : 'w' })
    let received = offset
    let last = 0
    await this.pump(res.body, out, (chunk) => {
      hash.update(chunk)
      received += chunk.length
      const now = Date.now()
      if (now - last > 120) {
        last = now
        onProgress({ phase: 'download', received, total, source })
      }
    })
    onProgress({ phase: 'verify', received, total, source })
    const actual = hash.digest('hex')
    if (actual !== expected) {
      await fs.rm(part, { force: true })
      throw new Error(`SHA-256 mismatch: got ${actual}, expected ${expected}`)
    }
    this.log(`sha256 OK ${actual}`)
    await fs.rm(dest, { force: true })
    await fs.rename(part, dest)
    return dest
  }

  private async pump(body: ReadableStream<Uint8Array>, out: WriteStream, onChunk: (chunk: Buffer) => void): Promise<void> {
    const reader = body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        if (!value) continue
        const chunk = Buffer.from(value.buffer, value.byteOffset, value.byteLength)
        onChunk(chunk)
        if (!out.write(chunk)) await new Promise<void>((resolve) => out.once('drain', () => resolve()))
      }
    } finally {
      await new Promise<void>((resolve, reject) => out.end((err?: Error | null) => (err ? reject(err) : resolve())))
    }
  }

  private async findPackageRoot(staging: string): Promise<string> {
    if (existsSync(join(staging, 'codex-package.json'))) return staging
    const entries = await fs.readdir(staging, { withFileTypes: true })
    for (const e of entries) {
      if (e.isDirectory() && existsSync(join(staging, e.name, 'codex-package.json'))) return join(staging, e.name)
    }
    throw new Error('codex-package.json not found in archive')
  }

  private async readManifest(dir: string): Promise<PackageManifest> {
    return JSON.parse(await fs.readFile(join(dir, 'codex-package.json'), 'utf8')) as PackageManifest
  }

  private async missingFiles(dir: string): Promise<string[]> {
    const missing: string[] = []
    for (const f of requiredFiles(this.target)) {
      try {
        await fs.access(join(dir, f))
      } catch {
        missing.push(f)
      }
    }
    return missing
  }
}
