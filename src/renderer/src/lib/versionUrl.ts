const RE = /^(gas-file:\/\/local\/)([^?]+)(\?.*)?$/

function fromB64Url(s: string): string {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'))
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)))
}

function toB64Url(s: string): string {
  let bin = ''
  for (const b of new TextEncoder().encode(s)) bin += String.fromCharCode(b)
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** URL of vN.png next to the version file `url` points at; null when it is not a version file. */
export function siblingVersionUrl(url: string, v: number): string | null {
  const m = RE.exec(url)
  if (!m) return null
  try {
    const path = fromB64Url(m[2])
    if (!/[\/]v\d+\.png$/i.test(path)) return null
    return `${m[1]}${toB64Url(path.replace(/v\d+\.png$/i, `v${v}.png`))}?v=${v}`
  } catch {
    return null
  }
}
