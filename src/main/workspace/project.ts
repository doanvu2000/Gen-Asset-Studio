import { randomBytes } from 'node:crypto'
import { isImageFile } from '@shared/imageFormats'
import { existsSync, promises as fs } from 'node:fs'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { InputKind, InputStatus, InputType, InputView, ProjectExportState, ProjectView, RootView, SkippedFile } from '@shared/workspace'
import type { NineSliceOverride, StyleGroup } from '@shared/style'
import { PROJECT_KINDS, type ProjectKind } from '@shared/sprite'
import { analyzeImage, hashFile, makeThumb, mapLimit } from './analyze'
import { fileUrl } from './protocol'
import { readVersionQa, sanitizeReview } from './review'

export const PROJECT_FILE = 'project.json'
export const CACHE_DIR = '.cache'

export interface InputRecord {
  id: string
  root: number
  rel: string
  w: number
  h: number
  alpha: boolean
  size: number
  mtime: number
  hash: string
  type: InputType
  typeAuto: boolean
  kind: InputKind
}

export interface ProjectFile {
  version: number
  kind: ProjectKind
  name: string
  createdAt: string
  updatedAt: string
  roots: string[]
  inputs: InputRecord[]
  groups: unknown[]
  [key: string]: unknown
}

const TYPES: readonly InputType[] = ['normal', 'nine']
const KINDS: readonly InputKind[] = ['button', 'panel', 'icon', 'bar', 'character']
const SILENT = new Set(['thumbs.db', '.ds_store', 'desktop.ini'])
const MAX_SCAN = 5000

export function pathKey(p: string): string {
  const r = resolve(p)
  return process.platform === 'win32' ? r.toLowerCase() : r
}

export function isInside(child: string, parent: string): boolean {
  const rel = relative(resolve(parent), resolve(child))
  return rel !== '' && !rel.startsWith('..') && !isAbsolute(rel)
}

export function isSameOrInside(child: string, parent: string): boolean {
  return pathKey(child) === pathKey(parent) || isInside(child, parent)
}

function toPosix(p: string): string {
  return p.split(sep).join('/')
}

function newId(): string {
  return `i_${randomBytes(5).toString('hex')}`
}

function num(v: unknown, d = 0): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}

function sanitizeInput(raw: unknown, rootCount: number): InputRecord | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  if (typeof r.rel !== 'string' || !r.rel) return null
  const root = num(r.root, -1)
  if (root < 0 || root >= rootCount) return null
  return {
    id: typeof r.id === 'string' && r.id ? r.id : newId(),
    root,
    rel: r.rel.replace(/\\/g, '/'),
    w: num(r.w),
    h: num(r.h),
    alpha: r.alpha === true,
    size: num(r.size),
    mtime: num(r.mtime),
    hash: typeof r.hash === 'string' ? r.hash : '',
    type: TYPES.includes(r.type as InputType) ? (r.type as InputType) : 'normal',
    typeAuto: r.type === 'sprite' || r.typeAuto !== false,
    kind: KINDS.includes(r.kind as InputKind) ? (r.kind as InputKind) : 'icon'
  }
}

export function sanitizeExport(raw: unknown): ProjectExportState {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {}
  const last = r.last && typeof r.last === 'object' ? (r.last as Record<string, unknown>) : null
  const at = last && typeof last.at === 'string' ? Date.parse(last.at) || 0 : 0
  return {
    outDir: typeof r.outDir === 'string' ? r.outDir.trim().slice(0, 1024) : '',
    lastAt: at,
    lastAssets: at && last ? Math.max(0, Math.round(num(last.assets))) : 0,
    lastFiles: at && last ? Math.max(0, Math.round(num(last.files))) : 0,
    lastOutDir: at && last && typeof last.outDir === 'string' ? last.outDir : ''
  }
}

function strOf(v: unknown, max: number): string {
  return typeof v === 'string' ? v.slice(0, max) : ''
}

function relPathOf(v: unknown): string | null {
  if (typeof v !== 'string' || !v) return null
  const clean = v.replace(/\\/g, '/')
  if (clean.split('/').some((p) => p === '..')) return null
  return clean
}

export function sanitizeGroups(raw: unknown, inputIds: Set<string>): StyleGroup[] {
  if (!Array.isArray(raw)) return []
  const taken = new Set<string>()
  const seen = new Set<string>()
  const out: StyleGroup[] = []
  for (const r of raw) {
    if (!r || typeof r !== 'object') continue
    const g = r as Record<string, unknown>
    const id = typeof g.id === 'string' && /^[a-z0-9_-]{1,64}$/i.test(g.id) ? g.id : ''
    if (!id || seen.has(id)) continue
    seen.add(id)
    const assetIds: string[] = []
    for (const a of Array.isArray(g.assetIds) ? g.assetIds : []) {
      if (typeof a !== 'string' || taken.has(a) || !inputIds.has(a)) continue
      taken.add(a)
      assetIds.push(a)
    }
    const overrides: Record<string, NineSliceOverride> = {}
    if (g.nineSliceOverrides && typeof g.nineSliceOverrides === 'object') {
      for (const [k, v] of Object.entries(g.nineSliceOverrides as Record<string, unknown>)) {
        if (inputIds.has(k) && (v === 'on' || v === 'off')) overrides[k] = v
      }
    }
    const group: StyleGroup = {
      id,
      name: strOf(g.name, 120) || id,
      promptEn: strOf(g.promptEn, 6000),
      notes: strOf(g.notes, 4000),
      refImages: (Array.isArray(g.refImages) ? g.refImages : []).map(relPathOf).filter((x): x is string => !!x).slice(0, 8),
      assetIds,
      nineSliceOverrides: overrides
    }
    const tid = strOf(g.templateId, 120)
    if (tid) group.templateId = tid
    const lock = relPathOf(g.lockImage)
    if (lock) group.lockImage = lock
    if (g.lockPrompt === true) group.lockPrompt = true
    const run = strOf(g.suggestRunId, 80)
    if (run && /^[a-z0-9-]+$/i.test(run)) group.suggestRunId = run
    if (Array.isArray(g.palette)) group.palette = g.palette.filter((c): c is string => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c)).slice(0, 8)
    const lockName = strOf(g.lockName, 120)
    if (lockName) group.lockName = lockName
    if (typeof g.lockedAt === 'number' && Number.isFinite(g.lockedAt)) group.lockedAt = g.lockedAt
    out.push(group)
  }
  return out
}

export function assetSegments(outRel: string): string[] {
  const parts = outRel.split(/[\\/]+/).filter((p) => p && p !== '.' && p !== '..')
  if (!parts.length) return ['_']
  const last = parts[parts.length - 1]
  const dot = last.lastIndexOf('.')
  parts[parts.length - 1] = dot > 0 ? last.slice(0, dot) : last
  return parts
}

async function listVersions(dir: string, outRel: string): Promise<number[]> {
  let names: string[] = []
  try {
    names = await fs.readdir(join(dir, 'versions', ...assetSegments(outRel)))
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

export function projectKindOf(v: unknown): ProjectKind {
  return PROJECT_KINDS.includes(v as ProjectKind) ? (v as ProjectKind) : 'reskin'
}

export function emptyProject(name: string, kind: ProjectKind = 'reskin'): ProjectFile {
  const now = new Date().toISOString()
  return { version: 1, kind, name, createdAt: now, updatedAt: now, roots: [], inputs: [], groups: [] }
}

export async function readProject(dir: string): Promise<ProjectFile> {
  const text = await fs.readFile(join(dir, PROJECT_FILE), 'utf8')
  const raw = JSON.parse(text) as Record<string, unknown>
  const roots = Array.isArray(raw.roots) ? raw.roots.filter((r): r is string => typeof r === 'string') : []
  const inputs = Array.isArray(raw.inputs) ? raw.inputs.map((i) => sanitizeInput(i, roots.length)).filter((i): i is InputRecord => !!i) : []
  return {
    ...raw,
    version: num(raw.version, 1),
    kind: projectKindOf(raw.kind),
    name: typeof raw.name === 'string' ? raw.name : basename(dir),
    createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : new Date().toISOString(),
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : new Date().toISOString(),
    roots,
    inputs,
    groups: Array.isArray(raw.groups) ? raw.groups : []
  }
}

export async function writeProject(dir: string, data: ProjectFile): Promise<void> {
  data.updatedAt = new Date().toISOString()
  const file = join(dir, PROJECT_FILE)
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

export function thumbPath(dir: string, hash: string): string {
  return join(dir, CACHE_DIR, 'thumbs', `${hash}.png`)
}

export async function ensureThumb(dir: string, abs: string, hash: string): Promise<string | null> {
  if (!hash) return null
  const dest = thumbPath(dir, hash)
  if (existsSync(dest)) return dest
  try {
    await fs.mkdir(dirname(dest), { recursive: true })
    await makeThumb(abs, dest)
    return dest
  } catch {
    return null
  }
}

export function rootLabels(roots: string[]): string[] {
  const seen = new Map<string, number>()
  return roots.map((r) => {
    const base = basename(r) || r
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    return n > 1 ? `${base} (${n})` : base
  })
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

export function absOf(data: ProjectFile, input: InputRecord): string {
  return join(data.roots[input.root], ...input.rel.split('/'))
}

export interface CheckedInput {
  record: InputRecord
  abs: string
  status: InputStatus
}

export async function checkInputs(data: ProjectFile): Promise<{ checked: CheckedInput[]; dirty: boolean }> {
  let dirty = false
  const checked = await mapLimit(data.inputs, 8, async (record) => {
    const abs = absOf(data, record)
    let status: InputStatus = 'ok'
    try {
      const st = await fs.stat(abs)
      if (!st.isFile()) status = 'missing'
      else if (st.size !== record.size || Math.round(st.mtimeMs) !== record.mtime) {
        const h = await hashFile(abs)
        if (h !== record.hash) status = 'changed'
        else {
          record.mtime = Math.round(st.mtimeMs)
          record.size = st.size
          dirty = true
        }
      }
    } catch {
      status = 'missing'
    }
    return { record, abs, status }
  })
  return { checked, dirty }
}

export async function buildView(dir: string, rel: string, data: ProjectFile, checked: CheckedInput[]): Promise<ProjectView> {
  const labels = rootLabels(data.roots)
  const multi = data.roots.length > 1
  const common = data.roots.length === 1 ? data.roots[0] : commonAncestor(data.roots)
  const review = sanitizeReview(data.review, new Set(data.inputs.map((i) => i.id)))
  const inputs: InputView[] = await mapLimit(checked, 4, async ({ record, abs, status }) => {
    const thumb = status === 'missing' ? null : await ensureThumb(dir, abs, record.hash)
    const d = dirname(record.rel).replace(/\\/g, '/')
    const dirRel = d === '.' ? '' : d
    const fromCommon = common ? toPosix(relative(common, abs)) : ''
    const outRel = fromCommon && !fromCommon.startsWith('..') && !isAbsolute(fromCommon) ? fromCommon : multi ? `${labels[record.root]}/${record.rel}` : record.rel
    const versions = await listVersions(dir, outRel)
    const last = versions.length ? versions[versions.length - 1] : 0
    const vdir = join(dir, 'versions', ...assetSegments(outRel))
    const entry = review[record.id]
    const selected = entry?.selected && versions.includes(entry.selected) ? entry.selected : last
    const qa = selected ? await readVersionQa(vdir, selected) : null
    return {
      id: record.id,
      root: record.root,
      rel: record.rel,
      abs,
      name: basename(record.rel),
      dir: multi ? (dirRel ? `${labels[record.root]}/${dirRel}` : labels[record.root]) : dirRel,
      w: record.w,
      h: record.h,
      alpha: record.alpha,
      size: record.size,
      type: record.type,
      typeAuto: record.typeAuto,
      kind: record.kind,
      status,
      thumb: thumb ? fileUrl(thumb, record.hash) : null,
      url: fileUrl(abs, `${record.mtime}`),
      outRel,
      versions,
      latest: last ? fileUrl(join(vdir, `v${last}.png`), `${last}`) : null,
      selected,
      selectedUrl: selected ? fileUrl(join(vdir, `v${selected}.png`), `${selected}`) : null,
      decision: selected ? (entry?.decision ?? null) : null,
      qa
    }
  })
  const roots: RootView[] = data.roots.map((p, index) => {
    const missingCount = checked.filter((c) => c.record.root === index && c.status === 'missing').length
    const total = checked.filter((c) => c.record.root === index).length
    return { index, path: p, label: labels[index], missing: !existsSync(p) || (total > 0 && missingCount === total), missingCount }
  })
  return {
    rel,
    name: basename(dir),
    dir,
    kind: data.kind,
    roots,
    commonRoot: common,
    inputs,
    groups: sanitizeGroups(data.groups, new Set(data.inputs.map((i) => i.id))),
    groupCount: data.groups.length,
    export: sanitizeExport(data.export),
    updatedAt: Date.parse(data.updatedAt) || 0
  }
}

export interface Collected {
  folders: Array<{ dir: string; files: string[] }>
  files: string[]
  skipped: SkippedFile[]
}

async function walkPngs(dir: string, out: string[], skipped: SkippedFile[], base: string): Promise<void> {
  if (out.length >= MAX_SCAN) return
  let entries: import('node:fs').Dirent[]
  try {
    entries = await fs.readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }))
  for (const e of entries) {
    if (e.name.startsWith('.')) continue
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      await walkPngs(p, out, skipped, base)
    } else if (e.isFile()) {
      const ext = extname(e.name).toLowerCase()
      if (isImageFile(e.name)) out.push(p)
      else if (ext !== '.meta' && !SILENT.has(e.name.toLowerCase())) skipped.push({ name: toPosix(relative(base, p)), reason: 'notPng' })
    }
    if (out.length >= MAX_SCAN) return
  }
}

export async function collect(paths: string[]): Promise<Collected> {
  const res: Collected = { folders: [], files: [], skipped: [] }
  for (const p of paths) {
    let st: import('node:fs').Stats
    try {
      st = await fs.stat(p)
    } catch {
      res.skipped.push({ name: basename(p), reason: 'unreadable' })
      continue
    }
    if (st.isDirectory()) {
      const files: string[] = []
      await walkPngs(p, files, res.skipped, dirname(p))
      res.folders.push({ dir: resolve(p), files })
    } else if (st.isFile()) {
      if (isImageFile(p)) res.files.push(resolve(p))
      else res.skipped.push({ name: basename(p), reason: 'notPng' })
    }
  }
  return res
}

function rootFor(data: ProjectFile, dir: string): number {
  for (let i = 0; i < data.roots.length; i++) if (isSameOrInside(dir, data.roots[i])) return i
  const swallowed = data.roots.map((r, i) => (isInside(r, dir) ? i : -1)).filter((i) => i >= 0)
  if (!swallowed.length) {
    data.roots.push(dir)
    return data.roots.length - 1
  }
  const target = swallowed[0]
  const oldRoots = [...data.roots]
  for (const input of data.inputs) {
    if (swallowed.includes(input.root)) {
      input.rel = toPosix(relative(dir, join(oldRoots[input.root], ...input.rel.split('/'))))
      input.root = target
    }
  }
  data.roots[target] = dir
  compactRoots(data)
  return data.roots.findIndex((r) => pathKey(r) === pathKey(dir))
}

export function compactRoots(data: ProjectFile): void {
  const used = new Set(data.inputs.map((i) => i.root))
  const map = new Map<number, number>()
  const roots: string[] = []
  const seen = new Map<string, number>()
  data.roots.forEach((r, i) => {
    if (!used.has(i)) return
    const k = pathKey(r)
    if (seen.has(k)) {
      map.set(i, seen.get(k) as number)
      return
    }
    seen.set(k, roots.length)
    map.set(i, roots.length)
    roots.push(r)
  })
  for (const input of data.inputs) input.root = map.get(input.root) ?? 0
  data.roots = roots
}

export async function addCollected(data: ProjectFile, c: Collected): Promise<{ added: number; skipped: SkippedFile[] }> {
  const skipped = [...c.skipped]
  const known = new Set(data.inputs.map((i) => pathKey(absOf(data, i))))
  const queue: Array<{ dir: string; file: string }> = []
  for (const f of c.folders) for (const file of f.files) queue.push({ dir: f.dir, file })
  for (const file of c.files) queue.push({ dir: dirname(file), file })
  const fresh: Array<{ dir: string; file: string }> = []
  for (const q of queue) {
    const k = pathKey(q.file)
    if (known.has(k)) {
      skipped.push({ name: basename(q.file), reason: 'duplicate' })
      continue
    }
    known.add(k)
    fresh.push(q)
  }
  const facts = await mapLimit(fresh, 4, async (q) => {
    try {
      return await analyzeImage(q.file)
    } catch (e) {
      skipped.push({ name: basename(q.file), reason: (e as Error).message === 'notPng' ? 'notPng' : 'unreadable' })
      return null
    }
  })
  let added = 0
  fresh.forEach((q, i) => {
    const f = facts[i]
    if (!f) return
    const root = rootFor(data, q.dir)
    data.inputs.push({
      id: newId(),
      root,
      rel: toPosix(relative(data.roots[root], q.file)),
      w: f.w,
      h: f.h,
      alpha: f.alpha,
      size: f.size,
      mtime: f.mtime,
      hash: f.hash,
      type: f.type,
      typeAuto: true,
      kind: f.kind
    })
    added++
  })
  data.inputs.sort((a, b) => a.root - b.root || a.rel.localeCompare(b.rel, undefined, { numeric: true }))
  return { added, skipped }
}
