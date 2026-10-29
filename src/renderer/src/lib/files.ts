export function fileUrl(abs: string, version?: string | number): string {
  const bytes = new TextEncoder().encode(abs)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  const id = btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return `gas-file://local/${id}${version !== undefined ? `?v=${encodeURIComponent(String(version))}` : ''}`
}

export function projAbs(projectDir: string, p: string): string {
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/')) return p
  const sep = projectDir.includes('\\') ? '\\' : '/'
  return `${projectDir.replace(/[\\/]+$/, '')}${sep}${p.split('/').join(sep)}`
}

export function errMsg(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e)
  return m.replace(/^Error invoking remote method '[^']+':\s*/, '').replace(/^Error:\s*/, '')
}

export function newGroupId(): string {
  return `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export function modelLabel(id: string, list: { id: string; model: string; displayName: string }[]): string {
  const short = id.replace(/^gpt-\d+(\.\d+)?-/, '')
  if (short !== id) return short
  const m = list.find((x) => x.id === id || x.model === id)
  return m?.displayName || id
}

export function clock(ms: number): string {
  const t = Math.max(0, Math.round(ms / 1000))
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = t % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}
