import { BrowserWindow, dialog, shell } from 'electron'
import { IMAGE_EXT_NAMES } from '@shared/imageFormats'
import { watch, type FSWatcher } from 'chokidar'
import { EventEmitter } from 'node:events'
import { existsSync, promises as fs } from 'node:fs'
import { basename, dirname, join, resolve, sep } from 'node:path'
import type { AddResult, FolderNode, InputType, OpResult, ProjectSummary, ProjectView, WorkspaceSnapshot, WsError } from '@shared/workspace'
import type { StyleGroup } from '@shared/style'
import {
  addCollected,
  buildView,
  checkInputs,
  collect,
  compactRoots,
  emptyProject,
  isInside,
  isSameOrInside,
  pathKey,
  PROJECT_FILE,
  readProject,
  sanitizeExport,
  sanitizeGroups,
  thumbPath,
  writeProject,
  type ProjectFile
} from './project'
import { fileUrl } from './protocol'
import type { PipelineLike } from '../queue/GenJob'
import type { ReprocessOptions, ReprocessResult, ReviewPatch, VersionInfo } from '@shared/review'
import { applyReviewPatch, readVersions, reprocessVersion, sanitizeReview } from './review'
import { assetSegments } from './project'

const INVALID = /[<>:"/\\|?*\u0000-\u001f]/
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)(\..*)?$/i
const MAX_DEPTH = 10

class WsFail extends Error {
  constructor(readonly code: WsError, detail?: string) {
    super(detail ?? code)
  }
}

function validName(name: string): string {
  const n = name.trim()
  if (!n || n === '.' || n === '..' || n.length > 120 || INVALID.test(n) || RESERVED.test(n) || /[. ]$/.test(n)) throw new WsFail('invalidName')
  return n
}

function ok(rel: string | null): OpResult {
  return { ok: true, rel, error: null, detail: null }
}

function fail(e: unknown): OpResult {
  if (e instanceof WsFail) return { ok: false, rel: null, error: e.code, detail: e.message === e.code ? null : e.message }
  const err = e as NodeJS.ErrnoException
  if (err?.code === 'EEXIST') return { ok: false, rel: null, error: 'exists', detail: null }
  if (err?.code === 'ENOENT') return { ok: false, rel: null, error: 'notFound', detail: null }
  if (err?.code === 'EPERM' || err?.code === 'EBUSY' || err?.code === 'EACCES') return { ok: false, rel: null, error: 'busy', detail: err.message }
  return { ok: false, rel: null, error: 'io', detail: err?.message ?? String(e) }
}

function relJoin(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name
}

async function retry<T>(fn: () => Promise<T>): Promise<T> {
  let last: unknown
  for (let i = 0; i < 6; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      const code = (e as NodeJS.ErrnoException).code
      if (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES') throw e
      await new Promise((r) => setTimeout(r, 120 * (i + 1)))
    }
  }
  throw last
}

export class WorkspaceService extends EventEmitter {
  private root: string | null = null
  private watcher: FSWatcher | null = null
  private timer: NodeJS.Timeout | null = null
  private snap: WorkspaceSnapshot = { root: null, name: null, exists: false, tree: null, projects: [] }
  private chain: Promise<unknown> = Promise.resolve()
  private allowed = new Set<string>()
  private readonly allowedDirs: string[] = []

  constructor(private readonly log: (message: string) => void) {
    super()
  }

  get current(): string | null {
    return this.root
  }

  async setRoot(root: string | null): Promise<void> {
    const next = root ? resolve(root) : null
    if (next && this.root && pathKey(next) === pathKey(this.root)) return
    await this.stopWatch()
    this.root = next
    this.allowed.clear()
    await this.rescan()
    this.startWatch()
  }

  async dispose(): Promise<void> {
    await this.stopWatch()
  }

  snapshot(): WorkspaceSnapshot {
    return this.snap
  }

  isAllowed(abs: string): boolean {
    const p = resolve(abs)
    if (this.root && isInside(p, this.root)) return true
    if (this.allowedDirs.some((d) => isInside(p, d))) return true
    return this.allowed.has(pathKey(p))
  }

  private startWatch(): void {
    if (!this.root || !existsSync(this.root) || this.watcher) return
    const root = this.root
    this.watcher = watch(root, {
      ignoreInitial: true,
      depth: MAX_DEPTH,
      ignored: (p, stats) => {
        if (pathKey(p) === pathKey(root)) return false
        const base = basename(p)
        if (base.startsWith('.')) return true
        if (stats?.isFile() && base !== PROJECT_FILE) return true
        return false
      }
    })
    this.watcher.on('all', () => this.schedule())
    this.watcher.on('error', (e) => this.log(`watch error: ${(e as Error).message}`))
  }

  private async stopWatch(): Promise<void> {
    const w = this.watcher
    this.watcher = null
    if (w) await w.close().catch(() => undefined)
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      void this.rescan()
    }, 250)
  }

  async rescan(): Promise<WorkspaceSnapshot> {
    const root = this.root
    if (!root) {
      this.snap = { root: null, name: null, exists: false, tree: null, projects: [] }
    } else if (!existsSync(root)) {
      this.snap = { root, name: basename(root), exists: false, tree: null, projects: [] }
    } else {
      const projects: ProjectSummary[] = []
      const tree = await this.scanDir(root, '', 0, projects, true)
      tree.name = basename(root) || root
      this.snap = { root, name: tree.name, exists: true, tree, projects }
    }
    this.emit('changed', this.snap)
    return this.snap
  }

  private async scanDir(abs: string, rel: string, depth: number, projects: ProjectSummary[], isRoot = false): Promise<FolderNode> {
    let entries: import('node:fs').Dirent[] = []
    try {
      entries = await fs.readdir(abs, { withFileTypes: true })
    } catch {
      entries = []
    }
    const name = basename(abs)
    if (!isRoot && entries.some((e) => e.isFile() && e.name === PROJECT_FILE)) {
      const summary = await this.summary(abs, rel)
      projects.push(summary)
      return { rel, name, kind: 'project', children: [], projectCount: 1, imageCount: summary.imageCount }
    }
    const dirs = entries
      .filter((e) => e.isDirectory() && !e.name.startsWith('.') && !e.name.startsWith('$'))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    const children: FolderNode[] = []
    if (depth < MAX_DEPTH) {
      for (const d of dirs) children.push(await this.scanDir(join(abs, d.name), relJoin(rel, d.name), depth + 1, projects))
    }
    return {
      rel,
      name,
      kind: 'folder',
      children,
      projectCount: children.reduce((n, c) => n + c.projectCount, 0),
      imageCount: children.reduce((n, c) => n + c.imageCount, 0)
    }
  }

  private async summary(dir: string, rel: string): Promise<ProjectSummary> {
    let data: ProjectFile | null = null
    try {
      data = await readProject(dir)
    } catch {
      data = null
    }
    let mtime = 0
    try {
      mtime = (await fs.stat(join(dir, PROJECT_FILE))).mtimeMs
    } catch {
      mtime = 0
    }
    const thumbs: string[] = []
    for (const input of data?.inputs ?? []) {
      if (thumbs.length >= 4) break
      if (!input.hash) continue
      const t = thumbPath(dir, input.hash)
      if (existsSync(t)) thumbs.push(fileUrl(t, input.hash))
    }
    const count = data?.inputs.length ?? 0
    const review = data ? Object.values(sanitizeReview(data.review, new Set(data.inputs.map((i) => i.id)))) : []
    const approved = review.filter((r) => r.decision === 'approved').length
    const exp = sanitizeExport(data?.export)
    return {
      rel,
      name: basename(dir),
      parentRel: rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '',
      imageCount: count,
      groupCount: data?.groups.length ?? 0,
      approved,
      exported: exp.lastAssets,
      exportedAt: exp.lastAt,
      status: !count ? 'new' : exp.lastAt ? 'exported' : review.length ? 'review' : 'draft',
      updatedAt: Math.max(Date.parse(data?.updatedAt ?? '') || 0, Math.round(mtime)),
      thumbs,
      sample: !!(data && (data as Record<string, unknown>).sample)
    }
  }

  private abs(rel: string): string {
    if (!this.root) throw new WsFail('noWorkspace')
    const clean = rel.replace(/\\/g, '/').split('/').filter(Boolean)
    if (clean.some((p) => p === '..' || p === '.')) throw new WsFail('notFound')
    const p = resolve(this.root, ...clean)
    if (!isSameOrInside(p, this.root)) throw new WsFail('notFound')
    return p
  }

  private relOf(abs: string): string {
    if (!this.root) return ''
    return resolve(abs).slice(resolve(this.root).length).split(sep).filter(Boolean).join('/')
  }

  private run<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn)
    this.chain = next.catch(() => undefined)
    return next
  }

  private mutate(fn: () => Promise<string | null>): Promise<OpResult> {
    return this.run(async () => {
      await this.stopWatch()
      try {
        return ok(await fn())
      } catch (e) {
        this.log(`workspace op failed: ${(e as Error).message}`)
        return fail(e)
      } finally {
        await this.rescan()
        this.startWatch()
      }
    })
  }

  createFolder(parentRel: string, name: string): Promise<OpResult> {
    return this.mutate(async () => {
      const parent = this.abs(parentRel)
      const n = validName(name)
      const target = join(parent, n)
      if (existsSync(target)) throw new WsFail('exists')
      await fs.mkdir(target)
      return relJoin(parentRel, n)
    })
  }

  createProject(parentRel: string, name: string): Promise<OpResult> {
    return this.mutate(async () => {
      const parent = this.abs(parentRel)
      const n = validName(name)
      const target = join(parent, n)
      if (existsSync(target)) throw new WsFail('exists')
      await fs.mkdir(target, { recursive: true })
      await writeProject(target, emptyProject(n))
      this.log(`project created: ${target}`)
      return relJoin(parentRel, n)
    })
  }

  rename(rel: string, name: string): Promise<OpResult> {
    return this.mutate(async () => {
      if (!rel) throw new WsFail('notFound')
      const src = this.abs(rel)
      if (!existsSync(src)) throw new WsFail('notFound')
      const n = validName(name)
      const dest = join(dirname(src), n)
      if (pathKey(dest) !== pathKey(src) && existsSync(dest)) throw new WsFail('exists')
      if (dest !== src) await retry(() => fs.rename(src, dest))
      if (existsSync(join(dest, PROJECT_FILE))) {
        const data = await readProject(dest).catch(() => null)
        if (data) {
          data.name = n
          await writeProject(dest, data)
        }
      }
      return this.relOf(dest)
    })
  }

  move(rel: string, destRel: string): Promise<OpResult> {
    return this.mutate(async () => {
      if (!rel) throw new WsFail('notFound')
      const src = this.abs(rel)
      const destDir = this.abs(destRel)
      if (!existsSync(src)) throw new WsFail('notFound')
      if (isSameOrInside(destDir, src)) throw new WsFail('intoSelf')
      if (pathKey(dirname(src)) === pathKey(destDir)) return rel
      if (existsSync(join(destDir, PROJECT_FILE))) throw new WsFail('intoSelf')
      const dest = join(destDir, basename(src))
      if (existsSync(dest)) throw new WsFail('exists')
      await retry(() => fs.rename(src, dest))
      return this.relOf(dest)
    })
  }

  trash(rel: string): Promise<OpResult> {
    return this.mutate(async () => {
      if (!rel) throw new WsFail('notFound')
      const p = this.abs(rel)
      if (!existsSync(p)) throw new WsFail('notFound')
      await retry(() => shell.trashItem(p))
      this.log(`moved to recycle bin: ${p}`)
      return null
    })
  }

  reveal(rel: string): void {
    try {
      const p = this.abs(rel)
      if (rel) shell.showItemInFolder(p)
      else void shell.openPath(p)
    } catch {
      return
    }
  }

  private projectDir(rel: string): string {
    const dir = this.abs(rel)
    if (!rel || !existsSync(join(dir, PROJECT_FILE))) throw new WsFail('notFound')
    return dir
  }

  private allow(view: ProjectView): ProjectView {
    for (const i of view.inputs) this.allowed.add(pathKey(i.abs))
    return view
  }

  private async load(rel: string): Promise<{ dir: string; data: ProjectFile }> {
    const dir = this.projectDir(rel)
    return { dir, data: await readProject(dir) }
  }

  private async view(rel: string, dir: string, data: ProjectFile, forceWrite = false): Promise<ProjectView> {
    const { checked, dirty } = await checkInputs(data)
    if (dirty || forceWrite) await writeProject(dir, data)
    return this.allow(await buildView(dir, rel, data, checked))
  }

  loadForExport(rel: string): Promise<{ dir: string; data: ProjectFile }> {
    return this.run(() => this.load(rel))
  }

  setExportDir(rel: string, outDir: string): Promise<boolean> {
    return this.run(async () => {
      try {
        const { dir, data } = await this.load(rel)
        const prev = data.export && typeof data.export === 'object' ? (data.export as Record<string, unknown>) : {}
        data.export = { ...prev, outDir: outDir.trim() }
        await writeProject(dir, data)
        return true
      } catch (e) {
        this.log(`save export dir failed: ${(e as Error).message}`)
        return false
      }
    })
  }

  recordExport(rel: string, rec: { outDir: string; resolvedOutDir: string; assets: number; files: number }): Promise<boolean> {
    return this.run(async () => {
      try {
        const { dir, data } = await this.load(rel)
        data.export = {
          outDir: rec.outDir.trim(),
          last: { at: new Date().toISOString(), assets: rec.assets, files: rec.files, outDir: rec.resolvedOutDir }
        }
        await writeProject(dir, data)
        return true
      } catch (e) {
        this.log(`save export record failed: ${(e as Error).message}`)
        return false
      }
    })
  }

  open(rel: string): Promise<ProjectView | null> {
    return this.run(async () => {
      try {
        const { dir, data } = await this.load(rel)
        return await this.view(rel, dir, data)
      } catch (e) {
        this.log(`open project failed: ${(e as Error).message}`)
        return null
      }
    })
  }

  private async pick(win: BrowserWindow | null, opts: Electron.OpenDialogOptions): Promise<string[]> {
    const r = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
    return r.canceled ? [] : r.filePaths
  }

  async addFromDialog(rel: string, mode: 'folder' | 'files', win: BrowserWindow | null): Promise<AddResult> {
    const paths = await this.pick(
      win,
      mode === 'folder'
        ? { properties: ['openDirectory', 'dontAddToRecent'] }
        : { properties: ['openFile', 'multiSelections', 'dontAddToRecent'], filters: [{ name: 'Images (PNG khuyên dùng)', extensions: IMAGE_EXT_NAMES }] }
    )
    if (!paths.length) return { view: null, added: 0, skipped: [], canceled: true }
    return this.addPaths(rel, paths)
  }

  addPaths(rel: string, paths: string[]): Promise<AddResult> {
    return this.run(async () => {
      const { dir, data } = await this.load(rel)
      const clean = paths.filter((p) => typeof p === 'string' && p && !isSameOrInside(p, dir))
      const c = await collect(clean)
      const { added, skipped } = await addCollected(data, c)
      this.log(`project ${rel}: +${added} image(s), ${skipped.length} skipped`)
      const view = await this.view(rel, dir, data, added > 0)
      return { view, added, skipped, canceled: false }
    })
  }

  remove(rel: string, ids: string[]): Promise<ProjectView | null> {
    return this.run(async () => {
      const { dir, data } = await this.load(rel)
      const drop = new Set(ids)
      data.inputs = data.inputs.filter((i) => !drop.has(i.id))
      compactRoots(data)
      return this.view(rel, dir, data, true)
    })
  }

  setType(rel: string, ids: string[], type: InputType): Promise<ProjectView | null> {
    return this.run(async () => {
      if (type === 'sprite') throw new WsFail('io', 'sprite sheets are not supported yet')
      const { dir, data } = await this.load(rel)
      const set = new Set(ids)
      for (const i of data.inputs) {
        if (set.has(i.id)) {
          i.type = type
          i.typeAuto = false
        }
      }
      return this.view(rel, dir, data, true)
    })
  }

  setGroups(rel: string, groups: unknown): Promise<StyleGroup[] | null> {
    return this.run(async () => {
      try {
        const { dir, data } = await this.load(rel)
        const clean = sanitizeGroups(groups, new Set(data.inputs.map((i) => i.id)))
        data.groups = clean
        await writeProject(dir, data)
        return clean
      } catch (e) {
        this.log(`save groups failed: ${(e as Error).message}`)
        return null
      }
    })
  }

  setReview(rel: string, patch: ReviewPatch): Promise<boolean> {
    return this.run(async () => {
      try {
        const { dir, data } = await this.load(rel)
        const ids = new Set(data.inputs.map((i) => i.id))
        data.review = applyReviewPatch(sanitizeReview(data.review, ids), patch, ids)
        await writeProject(dir, data)
        return true
      } catch (e) {
        this.log(`save review failed: ${(e as Error).message}`)
        return false
      }
    })
  }

  private async assetOf(rel: string, inputId: string): Promise<{ dir: string; vdir: string; abs: string; outRel: string; versions: number[] }> {
    const { dir, data } = await this.load(rel)
    const { checked } = await checkInputs(data)
    const view = await buildView(dir, rel, data, checked.filter((c) => c.record.id === inputId))
    const input = view.inputs[0]
    if (!input) throw new WsFail('notFound')
    return { dir, vdir: join(dir, 'versions', ...assetSegments(input.outRel)), abs: input.abs, outRel: input.outRel, versions: input.versions }
  }

  versions(rel: string, inputId: string): Promise<VersionInfo[]> {
    return this.run(async () => {
      try {
        const a = await this.assetOf(rel, inputId)
        return await readVersions(a.vdir, a.versions)
      } catch (e) {
        this.log(`read versions failed: ${(e as Error).message}`)
        return []
      }
    })
  }

  async reprocess(rel: string, inputId: string, version: number, options: ReprocessOptions, pipeline: Pick<PipelineLike, 'processAsset'>): Promise<ReprocessResult> {
    try {
      const a = await this.run(() => this.assetOf(rel, inputId))
      if (!a.versions.includes(version)) throw new Error(`v${version} not found`)
      const r = await reprocessVersion(a.vdir, version, a.abs, a.outRel, options, pipeline)
      this.log(`project ${rel}: reprocessed ${a.outRel} v${version} → v${r.version}`)
      await this.setReview(rel, { [inputId]: { decision: null, selected: null } })
      return { ok: true, version: r.version, qa: r.qa, error: null }
    } catch (e) {
      this.log(`reprocess failed: ${(e as Error).message}`)
      return { ok: false, version: null, qa: null, error: (e as Error).message.split(/\r?\n/)[0] }
    }
  }

  async addRefs(rel: string, groupId: string, win: BrowserWindow | null): Promise<string[]> {
    if (!/^[a-z0-9_-]{1,64}$/i.test(groupId)) return []
    const dir = this.projectDir(rel)
    const picked = await this.pick(win, {
      properties: ['openFile', 'multiSelections', 'dontAddToRecent'],
      filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
    })
    if (!picked.length) return []
    const refDir = join(dir, 'styles', groupId, 'refs')
    await fs.mkdir(refDir, { recursive: true })
    const out: string[] = []
    for (const src of picked.slice(0, 8)) {
      const base = (basename(src).replace(/\.[^.]+$/, '').replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40) || 'ref').toLowerCase()
      let name = `${base}.png`
      for (let n = 2; existsSync(join(refDir, name)); n++) name = `${base}-${n}.png`
      try {
        const sharp = (await import('sharp')).default
        await sharp(src).png().toFile(join(refDir, name))
        out.push(`styles/${groupId}/refs/${name}`)
      } catch (e) {
        this.log(`add ref failed ${src}: ${(e as Error).message}`)
      }
    }
    return out
  }

  allowDir(dir: string | null): void {
    if (dir) this.allowedDirs.push(resolve(dir))
  }

  async relink(rel: string, rootIndex: number, win: BrowserWindow | null): Promise<ProjectView | null> {
    const opts: Electron.OpenDialogOptions = { properties: ['openDirectory', 'dontAddToRecent'] }
    const old = await this.load(rel).then(({ data }) => data.roots[rootIndex], () => undefined)
    if (old) {
      let near = dirname(old)
      while (!existsSync(near) && dirname(near) !== near) near = dirname(near)
      if (existsSync(near)) opts.defaultPath = near
    }
    const picked = await this.pick(win, opts)
    if (!picked.length) return null
    return this.run(async () => {
      const { dir, data } = await this.load(rel)
      if (rootIndex < 0 || rootIndex >= data.roots.length) throw new WsFail('notFound')
      this.log(`project ${rel}: relink root ${data.roots[rootIndex]} → ${picked[0]}`)
      data.roots[rootIndex] = resolve(picked[0])
      return this.view(rel, dir, data, true)
    })
  }
}
