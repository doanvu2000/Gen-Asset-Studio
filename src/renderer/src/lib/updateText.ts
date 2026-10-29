import { useEffect, useState } from 'react'
import type { UpdateApi, UpdateSnapshot } from '@shared/update'
import vi from '../i18n/update.vi.json'
import en from '../i18n/update.en.json'

export type UpdateKey = keyof typeof vi.update
export type UpdateVars = Record<string, string | number>
export type UpdateT = (key: UpdateKey, vars?: UpdateVars) => string

const DICTS: Record<string, Record<UpdateKey, string>> = { vi: vi.update, en: en.update }

export function interpolate(template: string, vars?: UpdateVars): string {
  if (!vars) return template
  return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m))
}

export function fallbackUpdateT(lang: string): UpdateT {
  const dict = DICTS[lang] ?? DICTS.vi
  return (key, vars) => interpolate(dict[key] ?? key, vars)
}

export function formatReleaseDate(iso: string | null | undefined, lang: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return new Intl.DateTimeFormat(lang === 'en' ? 'en-GB' : 'vi-VN', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  }).format(d)
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let value = bytes
  let i = 0
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024
    i++
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

export function useUpdateSnapshot(api: UpdateApi): UpdateSnapshot | null {
  const [snap, setSnap] = useState<UpdateSnapshot | null>(null)
  useEffect(() => {
    let alive = true
    void api.get().then((s) => {
      if (alive) setSnap(s)
    })
    const off = api.onChange((s) => setSnap(s))
    return () => {
      alive = false
      off()
    }
  }, [api])
  return snap
}
