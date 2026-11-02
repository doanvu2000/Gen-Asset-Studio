import { promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import type { ProjectKind } from '@shared/sprite'
import type { ProjectSummary, TodoArea, TodoItem, TodoTarget } from '@shared/workspace'
import type { QueueJob } from '@shared/queue'
import { versionsDir } from '../queue/GenJob'
import { parseSpineAtlas } from '../spine/atlas'
import { regionAsset, variantAsset } from '../spine/service'
import { readSpriteData } from '../sprite/service'
import { buildStripDefs, decisionAt } from '../sprite/strips'
import { absOf, outRelResolver, pathKey, PROJECT_FILE, readProject, sanitizeExport, type ProjectFile } from './project'
import { sanitizeReview } from './review'

type Health = 'ok' | 'warn' | 'fail'

interface Entry {
  decision: 'approved' | 'rejected' | null
  selected: number
  version?: number
  seen?: number
  updatedAt?: number
}

interface Asset {
  name: string
  target: TodoTarget
  versions: number[]
  vdir: string
  entry: Entry | undefined
  qaKey: 'qa' | 'stripQa'
}

interface Part {
  area: Exclude<TodoArea, 'queue'>
  target: TodoTarget
  label: string
  count: number
}

const rec = (v: unknown): Record<string, unknown> => (v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {})
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)

function entryOf(v: unknown): Entry | undefined {
  if (!v || typeof v !== 'object') return undefined
  const e = v as Record<string, unknown>
  return {
    decision: e.decision === 'approved' || e.decision === 'rejected' ? e.decision : null,
    selected: Math.max(0, Math.round(num(e.selected))),
    version: Math.max(0, Math.round(num(e.version))),
    seen: Math.max(0, Math.round(num(e.seen))),
    updatedAt: num(e.updatedAt)
  }
}

export class TodoIndex {
  private projects = new Map<string, { mtime: number; data: ProjectFile }>()
  private dirs = new Map<string, { mtime: number; versions: number[] }>()
  private metas = new Map<string, { mtime: number; health: Health }>()
  private atlases = new Map<string, { mtime: number; names: string[] }>()

  clear(): void {
    this.projects.clear()
    this.dirs.clear()
    this.metas.clear()
    this.atlases.clear()
  }

  async collect(root: string, projects: ProjectSummary[], jobs: QueueJob[]): Promise<TodoItem[]> {
    const out: TodoItem[] = []
    const byDir = new Map<string, ProjectSummary>()
    const live = new Set<string>()
    for (const p of projects) {
      const dir = resolve(root, ...p.rel.split('/'))
      byDir.set(pathKey(dir), p)
      live.add(dir)
      try {
        const parts = await this.parts(dir, p.kind)
        for (const part of parts) out.push({ projectRel: p.rel, projectName: p.name, kind: p.kind, ...part, updatedAt: p.updatedAt })
      } catch {
        continue
      }
    }
    for (const dir of [...this.projects.keys()]) if (!live.has(dir)) this.projects.delete(dir)
    if (this.dirs.size > 50000) this.dirs.clear()
    if (this.metas.size > 50000) this.metas.clear()

    const failed = new Map<string, QueueJob[]>()
    for (const j of jobs) {
      if (j.status !== 'error') continue
      const k = pathKey(j.projectPath)
      failed.set(k, [...(failed.get(k) ?? []), j])
    }
    for (const [k, list] of failed) {
      const p = byDir.get(k)
      if (!p) continue
      const first = list[0]
      const sprite = first.sprite
      out.push({
        projectRel: p.rel,
        projectName: p.name,
        kind: p.kind,
        area: 'queue',
        target: sprite ? { stripKey: `${sprite.sheetId}:${sprite.animId}` } : {},
        label: first.assetRelPath.split(/[\\/]/).pop() ?? first.assetRelPath,
        count: list.length,
        updatedAt: Math.max(...list.map((j) => j.finishedAt ?? j.createdAt))
      })
    }
    return out
  }

  private async project(dir: string): Promise<ProjectFile | null> {
    let mtime = 0
    try {
      mtime = (await fs.stat(join(dir, PROJECT_FILE))).mtimeMs
    } catch {
      return null
    }
    const hit = this.projects.get(dir)
    if (hit && hit.mtime === mtime) return hit.data
    try {
      const data = await readProject(dir)
      this.projects.set(dir, { mtime, data })
      return data
    } catch {
      return null
    }
  }

  private async versionList(vdir: string): Promise<number[]> {
    let mtime = 0
    try {
      mtime = (await fs.stat(vdir)).mtimeMs
    } catch {
      this.dirs.delete(vdir)
      return []
    }
    const hit = this.dirs.get(vdir)
    if (hit && hit.mtime === mtime) return hit.versions
    let names: string[] = []
    try {
      names = await fs.readdir(vdir)
    } catch {
      return []
    }
    const versions = names
      .map((n) => /^v(\d+)\.png$/i.exec(n))
      .filter((m): m is RegExpExecArray => !!m)
      .map((m) => Number(m[1]))
      .sort((a, b) => a - b)
    this.dirs.set(vdir, { mtime, versions })
    return versions
  }

  private async health(a: Asset, v: number): Promise<Health> {
    const file = join(a.vdir, `v${v}.json`)
    let mtime = 0
    try {
      mtime = (await fs.stat(file)).mtimeMs
    } catch {
      return 'ok'
    }
    const key = `${file}|${a.qaKey}`
    const hit = this.metas.get(key)
    if (hit && hit.mtime === mtime) return hit.health
    let health: Health = 'ok'
    try {
      const meta = rec(JSON.parse(await fs.readFile(file, 'utf8')))
      const qa = rec(meta[a.qaKey] ?? meta.qa ?? meta.stripQa)
      const checks = Array.isArray(qa.checks) ? qa.checks.map(rec) : []
      if (checks.some((c) => c.status === 'fail')) health = 'fail'
      else if (checks.some((c) => c.status === 'warn')) health = 'warn'
      else if (qa.pass === false && Array.isArray(qa.checks)) health = 'fail'
    } catch {
      health = 'ok'
    }
    this.metas.set(key, { mtime, health })
    return health
  }

  private async regionNames(data: ProjectFile): Promise<string[]> {
    const p = rec(rec(data.spine).atlas).path
    if (typeof p !== 'string' || !p) return []
    let mtime = 0
    try {
      mtime = (await fs.stat(p)).mtimeMs
    } catch {
      return []
    }
    const hit = this.atlases.get(p)
    if (hit && hit.mtime === mtime) return hit.names
    try {
      const names = parseSpineAtlas(await fs.readFile(p, 'utf8')).regions.map((r) => r.name)
      this.atlases.set(p, { mtime, names })
      return names
    } catch {
      return []
    }
  }

  private async assets(dir: string, kind: ProjectKind, data: ProjectFile): Promise<Array<Asset & { slot: string; exportAt: number; labelOf: string }>> {
    const out: Array<Asset & { slot: string; exportAt: number; labelOf: string }> = []
    if (kind === 'sprite') {
      const sprite = readSpriteData(data)
      const exportAt = sprite.lastExport?.at ?? 0
      for (const d of buildStripDefs(sprite.sheets, sprite.settings)) {
        if (d.mirrorOf) continue
        const vdir = versionsDir(dir, d.assetRel)
        out.push({
          name: d.anim.name,
          labelOf: d.anim.dir ? `${d.anim.name} ${d.anim.dir}` : d.anim.name,
          target: { stripKey: d.key },
          versions: await this.versionList(vdir),
          vdir,
          entry: entryOf(sprite.review[d.key]),
          qaKey: 'stripQa',
          slot: '',
          exportAt
        })
      }
      return out
    }
    if (kind === 'spine') {
      const spine = rec(data.spine)
      const last = rec(spine.lastExport)
      const exportAt = spine.lastExport ? num(last.at) : 0
      const known = rec(spine.assets)
      const slots: Array<{ id: string; name: string; review: Record<string, unknown> }> = [{ id: '', name: '', review: rec(spine.review) }]
      for (const v of Array.isArray(spine.variants) ? spine.variants : []) {
        const e = rec(v)
        if (typeof e.id === 'string' && e.id) slots.push({ id: e.id, name: typeof e.name === 'string' ? e.name : e.id, review: rec(e.review) })
      }
      const names = await this.regionNames(data)
      for (const s of slots) {
        for (const n of names) {
          const base = typeof known[n] === 'string' && (known[n] as string).startsWith('spine/') ? (known[n] as string) : regionAsset(n)
          const vdir = versionsDir(dir, s.id ? variantAsset(base, s.id) : base)
          const versions = await this.versionList(vdir)
          if (!versions.length) continue
          out.push({
            name: n,
            labelOf: s.name ? `${n} · ${s.name}` : n,
            target: { region: n, ...(s.id ? { variantId: s.id } : {}) },
            versions,
            vdir,
            entry: entryOf(s.review[n]),
            qaKey: 'qa',
            slot: s.id,
            exportAt
          })
        }
      }
      return out
    }
    const resolver = outRelResolver(data)
    const review = sanitizeReview(data.review, new Set(data.inputs.map((i) => i.id)))
    const exportAt = sanitizeExport(data.export).lastAt
    for (const input of data.inputs) {
      if (!data.roots[input.root]) continue
      const vdir = versionsDir(dir, resolver(input, absOf(data, input)))
      const r = review[input.id]
      out.push({
        name: input.rel,
        labelOf: input.rel.split('/').pop() ?? input.rel,
        target: { assetId: input.id },
        versions: await this.versionList(vdir),
        vdir,
        entry: r ? { decision: r.decision, selected: r.selected ?? 0, updatedAt: r.updatedAt } : undefined,
        qaKey: 'qa',
        slot: '',
        exportAt
      })
    }
    return out
  }

  private async parts(dir: string, kind: ProjectKind): Promise<Part[]> {
    const data = await this.project(dir)
    if (!data) return []
    const parts: Part[] = []
    const groups = new Map<string, { review: Part | null; qa: Part | null; exp: Part | null }>()
    for (const a of await this.assets(dir, kind, data)) {
      if (!a.versions.length) continue
      const latest = a.versions[a.versions.length - 1]
      const e = a.entry
      let selected = e?.selected && a.versions.includes(e.selected) ? e.selected : latest
      if (kind === 'spine' && e?.seen && latest > e.seen && e.selected && a.versions.includes(e.selected)) selected = latest
      const decision = decisionAt(e, selected)
      const g = groups.get(a.slot) ?? { review: null, qa: null, exp: null }
      groups.set(a.slot, g)
      const bump = (area: Exclude<TodoArea, 'queue'>, key: 'review' | 'qa' | 'exp'): void => {
        const cur = g[key]
        if (cur) cur.count++
        else g[key] = { area, target: a.target, label: a.labelOf, count: 1 }
      }
      if (!decision) {
        bump('review', 'review')
        if ((await this.health(a, selected)) !== 'ok') bump('qa', 'qa')
      } else if (decision === 'approved') {
        const fresh = a.exportAt === 0 || (kind === 'reskin' ? (e?.updatedAt ?? 0) > a.exportAt : await this.newerThan(a.vdir, selected, a.exportAt))
        if (fresh) bump('export', 'exp')
      }
    }
    for (const g of groups.values()) for (const p of [g.review, g.qa, g.exp]) if (p) parts.push(p)
    return parts
  }

  private async newerThan(vdir: string, v: number, at: number): Promise<boolean> {
    try {
      return (await fs.stat(join(vdir, `v${v}.png`))).mtimeMs > at
    } catch {
      return false
    }
  }
}
