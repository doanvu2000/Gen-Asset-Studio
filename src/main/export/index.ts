import sharp from 'sharp'
import { outFormatOf } from '@shared/imageFormats'
import { existsSync, promises as fs } from 'node:fs'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { dialog, shell, type BrowserWindow, type IpcMain } from 'electron'
import {
  BACKUP_DIR,
  EXPORT_IPC,
  EXPORT_SKIP_REASONS,
  REPORT_FILE,
  backupStamp,
  normalizeExportOptions,
  scaledRel,
  type ExportError,
  type ExportOptions,
  type ExportPlan,
  type ExportPlanError,
  type ExportPlanItem,
  type ExportProgress,
  type ExportResult,
  type ExportScaleFactor,
  type ExportSkipReason,
  type ExportSkipped,
  type ExportTarget
} from '@shared/export'
import { mapLimit } from '../workspace/analyze'
import { absOf, assetSegments, isSameOrInside, pathKey, rootLabels, sanitizeGroups, type InputRecord, type ProjectFile } from '../workspace/project'
import { scale as directScale } from '../pipeline/process'

export type ExportScaler = (png: Uint8Array, factor: ExportScaleFactor) => Promise<Uint8Array>

export interface ExportSource {
  rel: string
  dir: string
  data: ProjectFile
}

export interface RunExportDeps {
  scale?: ExportScaler
  signal?: AbortSignal
  concurrency?: number
}

const LONG_PATH = 240
const OUTPUT_DIR = 'output'

export function longPath(p: string): string {
  if (process.platform !== 'win32') return p
  const r = resolve(p)
  if (r.length <= LONG_PATH || r.startsWith('\\\\?\\')) return r
  if (r.startsWith('\\\\')) return `\\\\?\\UNC\\${r.slice(2)}`
  return `\\\\?\\${r}`
}

function toPosix(p: string): string {
  return p.split(sep).join('/')
}

function commonAncestor(paths: string[]): string | null {
  if (!paths.length) return null
  const split = paths.map((p) => resolve(p).split(sep))
  const first = split[0]
  let n = first.length
  for (const parts of split.slice(1)) {
    let i = 0
    while (i < n && i < parts.length && (process.platform === 'win32' ? parts[i].toLowerCase() === first[i].toLowerCase() : parts[i] === first[i])) i++
    n = i
  }
  if (n === 0) return null
  const out = first.slice(0, n).join(sep)
  return out.endsWith(':') ? out + sep : out
}

export function exportRels(data: ProjectFile): string[] {
  const labels = rootLabels(data.roots)
  const multi = data.roots.length > 1
  const common = data.roots.length === 1 ? data.roots[0] : commonAncestor(data.roots)
  return data.inputs.map((record) => {
    const fromCommon = common ? toPosix(relative(common, absOf(data, record))) : ''
    if (fromCommon && !fromCommon.startsWith('..') && !isAbsolute(fromCommon)) return fromCommon
    return multi ? `${labels[record.root]}/${record.rel}` : record.rel
  })
}

function posInt(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v > 0 ? v : null
}

export function reviewOf(data: ProjectFile, input: InputRecord): { approved: boolean; selected: number | null } {
  const book = data.review && typeof data.review === 'object' ? (data.review as Record<string, unknown>) : null
  const entry = book?.[input.id]
  if (entry && typeof entry === 'object') {
    const e = entry as Record<string, unknown>
    return { approved: e.decision === 'approved', selected: posInt(e.selected) }
  }
  const r = input as unknown as Record<string, unknown>
  return { approved: r.approved === true, selected: posInt(r.selectedVersion) }
}

async function listVersions(dir: string, outRel: string): Promise<number[]> {
  let names: string[] = []
  try {
    names = await fs.readdir(longPath(join(dir, 'versions', ...assetSegments(outRel))))
  } catch {
    return []
  }
  const out: number[] = []
  for (const n of names) {
    const m = /^v(\d+)\.png$/i.exec(n)
    if (m) out.push(Number(m[1]))
  }
  return out.sort((a, b) => a - b)
}

export function versionPath(dir: string, outRel: string, version: number): string {
  return join(dir, 'versions', ...assetSegments(outRel), `v${version}.png`)
}

export function resolveOutDir(projectDir: string, outDir: string): string {
  if (!outDir) return resolve(projectDir, OUTPUT_DIR)
  return isAbsolute(outDir) ? resolve(outDir) : resolve(projectDir, outDir)
}

function emptyCounts(): Record<ExportSkipReason, number> {
  const out = {} as Record<ExportSkipReason, number>
  for (const r of EXPORT_SKIP_REASONS) out[r] = 0
  return out
}

export function emptyPlan(projectRel: string, projectDir: string, options: Partial<ExportOptions> | undefined, error: ExportPlanError): ExportPlan {
  const opts = normalizeExportOptions(options)
  const outDir = projectDir ? resolveOutDir(projectDir, opts.outDir) : opts.outDir
  const stamp = backupStamp()
  return {
    projectRel,
    projectDir,
    outDir,
    options: opts,
    items: [],
    skipped: [],
    skippedCounts: emptyCounts(),
    totalFiles: 0,
    conflicts: 0,
    backupStamp: stamp,
    backupDir: outDir ? join(outDir, BACKUP_DIR, stamp) : '',
    error
  }
}

async function readPng(file: string): Promise<Buffer> {
  return fs.readFile(longPath(file))
}

async function dims(buf: Uint8Array): Promise<{ w: number; h: number }> {
  const m = await sharp(buf).metadata()
  return { w: m.width ?? 0, h: m.height ?? 0 }
}

type Checked = { kind: 'item'; item: ExportPlanItem } | { kind: 'skip'; skip: ExportSkipped }

export async function planExport(src: ExportSource, options?: Partial<ExportOptions>, stampDate: Date = new Date()): Promise<ExportPlan> {
  const opts = normalizeExportOptions(options)
  const outDir = resolveOutDir(src.dir, opts.outDir)
  const plan = emptyPlan(src.rel, src.dir, opts, 'noScale')
  plan.outDir = outDir
  plan.backupStamp = backupStamp(stampDate)
  plan.backupDir = join(outDir, BACKUP_DIR, plan.backupStamp)
  plan.error = null
  if (!opts.scales.length) plan.error = 'noScale'
  else if (src.data.roots.some((r) => isSameOrInside(outDir, r))) plan.error = 'outInsideSource'
  else {
    try {
      const st = await fs.stat(longPath(outDir))
      if (!st.isDirectory()) plan.error = 'outIsFile'
    } catch {
      plan.error = null
    }
  }
  const data = src.data
  const groups = sanitizeGroups(data.groups, new Set(data.inputs.map((i) => i.id)))
  const owned = new Set(groups.flatMap((g) => g.assetIds))
  const rels = exportRels(data)
  const sources = new Set(data.inputs.map((i) => pathKey(absOf(data, i))))
  const checked = await mapLimit(data.inputs, 8, async (input, idx): Promise<Checked> => {
    const rel = rels[idx]
    const name = basename(rel)
    const skip = (reason: ExportSkipReason, detail?: string): Checked => ({ kind: 'skip', skip: detail ? { id: input.id, rel, name, reason, detail } : { id: input.id, rel, name, reason } })
    if (input.type === 'sprite') return skip('sprite')
    if (!owned.has(input.id)) return skip('notGrouped')
    const review = reviewOf(data, input)
    if (opts.onlyApproved && !review.approved) return skip('notApproved')
    const versions = await listVersions(src.dir, rel)
    if (!versions.length) return skip('noVersion')
    const version = review.selected !== null && versions.includes(review.selected) ? review.selected : versions[versions.length - 1]
    const vp = versionPath(src.dir, rel, version)
    let size: { w: number; h: number }
    try {
      size = await dims(await readPng(vp))
    } catch {
      return skip('missingFile', `v${version}`)
    }
    if (size.w !== input.w || size.h !== input.h) return skip('sizeMismatch', `v${version} ${size.w}×${size.h} ≠ ${input.w}×${input.h}`)
    const targets: ExportTarget[] = opts.scales.map((s) => {
      const trel = scaledRel(rel, s, opts.scaleLayout)
      const abs = join(outDir, ...trel.split('/'))
      return { scale: s, rel: trel, abs, w: input.w * s, h: input.h * s, exists: existsSync(longPath(abs)) }
    })
    const slash = rel.lastIndexOf('/')
    return {
      kind: 'item',
      item: {
        id: input.id,
        rel,
        name,
        dir: slash >= 0 ? rel.slice(0, slash) : '',
        version,
        versionPath: vp,
        w: input.w,
        h: input.h,
        approved: review.approved,
        targets
      }
    }
  })
  for (const c of checked) {
    if (c.kind === 'item') plan.items.push(c.item)
    else {
      plan.skipped.push(c.skip)
      plan.skippedCounts[c.skip.reason]++
    }
  }
  const cmp = (a: { rel: string }, b: { rel: string }): number => a.rel.localeCompare(b.rel, undefined, { numeric: true })
  plan.items.sort(cmp)
  plan.skipped.sort(cmp)
  plan.totalFiles = plan.items.reduce((n, i) => n + i.targets.length, 0)
  plan.conflicts = plan.items.reduce((n, i) => n + i.targets.filter((t) => t.exists).length, 0)
  if (!plan.error && plan.items.some((i) => i.targets.some((t) => sources.has(pathKey(t.abs))))) plan.error = 'outInsideSource'
  return plan
}

async function encodeAs(png: Uint8Array, target: string): Promise<Uint8Array> {
  const fmt = outFormatOf(target)
  if (fmt === 'png') return png
  const img = sharp(png)
  if (fmt === 'jpeg') return img.flatten({ background: '#ffffff' }).jpeg({ quality: 92, mozjpeg: true }).toBuffer()
  if (fmt === 'webp') return img.webp({ quality: 92, alphaQuality: 100 }).toBuffer()
  if (fmt === 'avif') return img.avif({ quality: 70 }).toBuffer()
  return img.tiff({ compression: 'lzw' }).toBuffer()
}

async function writeAtomic(target: string, buf: Uint8Array): Promise<void> {
  await fs.mkdir(longPath(dirname(target)), { recursive: true })
  const tmp = `${target}.gas-tmp`
  await fs.writeFile(longPath(tmp), buf)
  try {
    await fs.rename(longPath(tmp), longPath(target))
  } catch (e) {
    await fs.rm(longPath(tmp), { force: true })
    throw e
  }
}

async function moveToBackup(from: string, to: string): Promise<void> {
  await fs.mkdir(longPath(dirname(to)), { recursive: true })
  try {
    await fs.rename(longPath(from), longPath(to))
  } catch {
    await fs.copyFile(longPath(from), longPath(to))
    await fs.rm(longPath(from), { force: true })
  }
}

function errText(e: unknown): string {
  return (e instanceof Error ? e.message : String(e)).split('\n')[0]
}

export async function runExport(
  src: ExportSource,
  options: Partial<ExportOptions> | undefined,
  onProgress?: (p: ExportProgress) => void,
  deps: RunExportDeps = {}
): Promise<ExportResult> {
  const t0 = Date.now()
  const plan = await planExport(src, options)
  const result: ExportResult = {
    ok: false,
    canceled: false,
    projectRel: src.rel,
    outDir: plan.outDir,
    backupDir: null,
    reportPath: null,
    exportedAssets: 0,
    written: 0,
    backedUp: 0,
    keptExisting: 0,
    skipped: plan.skipped.length,
    errors: [],
    planError: plan.error,
    durationMs: 0
  }
  const total = plan.totalFiles
  const emit = (phase: ExportProgress['phase'], current: string, done: number): void => {
    onProgress?.({ projectRel: src.rel, phase, done, total, current })
  }
  if (plan.error) {
    result.durationMs = Date.now() - t0
    emit('error', '', 0)
    return result
  }
  const scaler = deps.scale ?? ((png: Uint8Array, f: ExportScaleFactor) => directScale(png, f))
  const signal = deps.signal
  const errors: ExportError[] = []
  const report: Array<{ id: string; rel: string; version: number; files: Array<{ scale: number; rel: string; w: number; h: number; status: string }> }> = []
  let done = 0
  let backupUsed = false
  await fs.mkdir(longPath(plan.outDir), { recursive: true })
  emit('running', '', 0)
  await mapLimit(plan.items, Math.max(1, Math.min(6, deps.concurrency ?? 3)), async (item) => {
    if (signal?.aborted) return
    const entry = { id: item.id, rel: item.rel, version: item.version, files: [] as Array<{ scale: number; rel: string; w: number; h: number; status: string }> }
    report.push(entry)
    let src1: Buffer
    try {
      src1 = await readPng(item.versionPath)
      const d = await dims(src1)
      if (d.w !== item.w || d.h !== item.h) throw new Error(`sizeMismatch ${d.w}×${d.h} ≠ ${item.w}×${item.h}`)
    } catch (e) {
      errors.push({ rel: item.rel, message: errText(e) })
      for (const t of item.targets) entry.files.push({ scale: t.scale, rel: t.rel, w: t.w, h: t.h, status: 'error' })
      done += item.targets.length
      emit('running', item.rel, done)
      return
    }
    let okAll = true
    for (const t of item.targets) {
      if (signal?.aborted) {
        okAll = false
        break
      }
      let status = 'written'
      try {
        if (existsSync(longPath(t.abs))) {
          if (plan.options.conflict === 'skip') {
            result.keptExisting++
            entry.files.push({ scale: t.scale, rel: t.rel, w: t.w, h: t.h, status: 'kept' })
            done++
            emit('running', t.rel, done)
            continue
          }
          await moveToBackup(t.abs, join(plan.backupDir, ...t.rel.split('/')))
          backupUsed = true
          result.backedUp++
          status = 'backedUp'
        }
        let out: Uint8Array = src1
        if (t.scale !== 1) {
          out = await scaler(new Uint8Array(src1), t.scale)
          const d = await dims(out)
          if (d.w !== t.w || d.h !== t.h) throw new Error(`scaleMismatch ${d.w}×${d.h} ≠ ${t.w}×${t.h}`)
        }
        await writeAtomic(t.abs, await encodeAs(out, t.abs))
        result.written++
      } catch (e) {
        okAll = false
        status = 'error'
        errors.push({ rel: t.rel, message: errText(e) })
      }
      entry.files.push({ scale: t.scale, rel: t.rel, w: t.w, h: t.h, status })
      done++
      emit('running', t.rel, done)
    }
    if (okAll) result.exportedAssets++
  })
  result.canceled = signal?.aborted === true
  result.errors = errors
  result.backupDir = backupUsed ? plan.backupDir : null
  result.ok = !result.canceled && errors.length === 0
  result.durationMs = Date.now() - t0
  const reportPath = join(plan.outDir, REPORT_FILE)
  report.sort((a, b) => a.rel.localeCompare(b.rel, undefined, { numeric: true }))
  try {
    await writeAtomic(
      reportPath,
      Buffer.from(
        JSON.stringify(
          {
            app: 'Gen Asset Studio',
            exportedAt: new Date().toISOString(),
            project: src.data.name,
            projectDir: src.dir,
            outDir: plan.outDir,
            options: plan.options,
            backupDir: result.backupDir,
            canceled: result.canceled,
            counts: {
              assets: plan.items.length,
              exportedAssets: result.exportedAssets,
              written: result.written,
              backedUp: result.backedUp,
              keptExisting: result.keptExisting,
              skipped: plan.skipped.length,
              errors: errors.length
            },
            items: report,
            skipped: plan.skipped,
            errors
          },
          null,
          2
        ),
        'utf8'
      )
    )
    result.reportPath = reportPath
  } catch (e) {
    errors.push({ rel: REPORT_FILE, message: errText(e) })
    result.ok = false
  }
  emit(result.canceled ? 'canceled' : 'done', '', done)
  return result
}

export interface ExportIpcDeps {
  loadProject: (projectRel: string) => Promise<{ dir: string; data: ProjectFile }>
  scale?: ExportScaler
  log?: (msg: string) => void
  saveDir?: (projectRel: string, outDir: string) => Promise<boolean>
  onExported?: (projectRel: string, result: ExportResult, options: ExportOptions) => Promise<unknown>
}

function str(v: unknown): string {
  if (typeof v !== 'string') throw new Error('invalid argument')
  return v
}

function opts(v: unknown): Partial<ExportOptions> | undefined {
  return v && typeof v === 'object' ? (v as Partial<ExportOptions>) : undefined
}

export function registerExportIpc(ipcMain: IpcMain, getWindow: () => BrowserWindow | null, deps: ExportIpcDeps): () => void {
  const running = new Map<string, AbortController>()
  let lastSent = 0
  const send = (p: ExportProgress): void => {
    const now = Date.now()
    if (p.phase === 'running' && p.done > 0 && p.done < p.total && now - lastSent < 60) return
    lastSent = now
    const w = getWindow()
    if (w && !w.isDestroyed()) w.webContents.send(EXPORT_IPC.progress, p)
  }
  const load = async (rel: string): Promise<ExportSource | null> => {
    try {
      const { dir, data } = await deps.loadProject(rel)
      return { rel, dir, data }
    } catch (e) {
      deps.log?.(`export: load project failed ${rel}: ${errText(e)}`)
      return null
    }
  }
  const handlers: Record<string, (...args: unknown[]) => unknown> = {
    [EXPORT_IPC.plan]: async (rel, o) => {
      const r = str(rel)
      const src = await load(r)
      if (!src) return emptyPlan(r, '', opts(o), 'noProject')
      return planExport(src, opts(o))
    },
    [EXPORT_IPC.run]: async (rel, o) => {
      const r = str(rel)
      const options = opts(o)
      const src = await load(r)
      if (!src) {
        const p = emptyPlan(r, '', options, 'noProject')
        return { ok: false, canceled: false, projectRel: r, outDir: p.outDir, backupDir: null, reportPath: null, exportedAssets: 0, written: 0, backedUp: 0, keptExisting: 0, skipped: 0, errors: [], planError: 'noProject', durationMs: 0 } satisfies ExportResult
      }
      const key = pathKey(src.dir)
      if (running.has(key)) {
        const outDir = resolveOutDir(src.dir, normalizeExportOptions(options).outDir)
        return { ok: false, canceled: false, projectRel: r, outDir, backupDir: null, reportPath: null, exportedAssets: 0, written: 0, backedUp: 0, keptExisting: 0, skipped: 0, errors: [], planError: 'busy', durationMs: 0 } satisfies ExportResult
      }
      const ac = new AbortController()
      running.set(key, ac)
      try {
        const res = await runExport(src, options, send, { scale: deps.scale, signal: ac.signal })
        deps.log?.(`export ${r}: written=${res.written} backedUp=${res.backedUp} kept=${res.keptExisting} errors=${res.errors.length} canceled=${res.canceled} ${res.durationMs}ms`)
        const norm = normalizeExportOptions(options)
        if (!res.canceled && !res.planError && res.exportedAssets > 0 && deps.onExported) {
          try {
            await deps.onExported(r, res, norm)
          } catch (e) {
            deps.log?.(`export ${r}: record failed: ${errText(e)}`)
          }
        }
        if (res.ok && norm.openFolderWhenDone) void shell.openPath(res.outDir)
        return res
      } finally {
        running.delete(key)
      }
    },
    [EXPORT_IPC.cancel]: async (rel) => {
      const r = str(rel)
      const src = await load(r)
      const ac = src ? running.get(pathKey(src.dir)) : undefined
      if (!ac) return false
      ac.abort()
      return true
    },
    [EXPORT_IPC.pickDir]: async (current) => {
      const win = getWindow()
      const o: Electron.OpenDialogOptions = { properties: ['openDirectory', 'createDirectory', 'promptToCreate'] }
      if (typeof current === 'string' && current) o.defaultPath = current
      const res = win ? await dialog.showOpenDialog(win, o) : await dialog.showOpenDialog(o)
      return res.canceled || !res.filePaths.length ? null : res.filePaths[0]
    },
    [EXPORT_IPC.saveDir]: async (rel, dir) => {
      const r = str(rel)
      const d = typeof dir === 'string' ? dir : ''
      return deps.saveDir ? deps.saveDir(r, d) : false
    },
    [EXPORT_IPC.openPath]: async (p) => {
      const target = str(p)
      if (!existsSync(target)) return false
      return (await shell.openPath(target)) === ''
    }
  }
  for (const [ch, fn] of Object.entries(handlers)) ipcMain.handle(ch, (_e, ...args: unknown[]) => fn(...args))
  return () => {
    for (const ch of Object.keys(handlers)) ipcMain.removeHandler(ch)
    for (const ac of running.values()) ac.abort()
    running.clear()
  }
}
