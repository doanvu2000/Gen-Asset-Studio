import { randomBytes } from 'node:crypto'
import { existsSync, promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import type { CodexService } from '../codex/service'

export type StyleCodex = Pick<CodexService, 'startThread' | 'runTurn' | 'generateImage' | 'interrupt'>

export function newId(prefix = ''): string {
  return `${prefix}${Date.now().toString(36)}${randomBytes(3).toString('hex')}`
}

export function safeId(v: string): string {
  return v
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function scanJson(text: string, open: string, close: string): string[] {
  const out: string[] = []
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== open) continue
    let depth = 0
    let inStr = false
    let esc = false
    for (let j = i; j < text.length; j++) {
      const c = text[j]
      if (inStr) {
        if (esc) esc = false
        else if (c === '\\') esc = true
        else if (c === '"') inStr = false
        continue
      }
      if (c === '"') inStr = true
      else if (c === open) depth++
      else if (c === close) {
        depth--
        if (depth === 0) {
          out.push(text.slice(i, j + 1))
          i = j
          break
        }
      }
    }
  }
  return out
}

export function extractJson(text: string, shape: 'object' | 'array'): unknown {
  const candidates: string[] = []
  const fence = /```(?:json)?\s*([\s\S]*?)```/gi
  let m: RegExpExecArray | null
  while ((m = fence.exec(text))) candidates.push(m[1].trim())
  candidates.push(text.trim())
  const [open, close] = shape === 'object' ? ['{', '}'] : ['[', ']']
  for (const c of [...candidates]) candidates.push(...scanJson(c, open, close))
  if (shape === 'array') for (const c of [...candidates]) candidates.push(...scanJson(c, '{', '}'))
  for (const c of candidates) {
    try {
      const v = JSON.parse(c) as unknown
      if (shape === 'object' && v && typeof v === 'object' && !Array.isArray(v)) return v
      if (shape === 'array') {
        if (Array.isArray(v)) return v
        if (v && typeof v === 'object') {
          const arr = Object.values(v as Record<string, unknown>).find(Array.isArray)
          if (arr) return arr
        }
      }
    } catch {
      continue
    }
  }
  return null
}

export function cleanStr(v: unknown, max = 4000): string {
  return typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, max) : ''
}

export function cleanPalette(v: unknown): string[] {
  if (!Array.isArray(v)) return []
  const out: string[] = []
  for (const x of v) {
    if (typeof x !== 'string') continue
    let h = x.trim().toUpperCase()
    if (!h.startsWith('#')) h = `#${h}`
    if (/^#[0-9A-F]{3}$/.test(h)) h = `#${h[1]}${h[1]}${h[2]}${h[2]}${h[3]}${h[3]}`
    if (/^#[0-9A-F]{6}$/.test(h) && !out.includes(h)) out.push(h)
  }
  return out.slice(0, 8)
}

export async function writeJsonAtomic(file: string, data: unknown): Promise<void> {
  await fs.mkdir(dirname(file), { recursive: true })
  const tmp = `${file}.${process.pid}.tmp`
  await fs.writeFile(tmp, JSON.stringify(data, null, 2), 'utf8')
  await fs.rename(tmp, file)
}

export async function readJson<T>(file: string): Promise<T | null> {
  if (!existsSync(file)) return null
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T
  } catch {
    return null
  }
}

export function turnFailure(r: { status: string; error: string | null }): string | null {
  if (r.status === 'completed' && !r.error) return null
  return r.error ?? `Codex turn ${r.status}`
}
