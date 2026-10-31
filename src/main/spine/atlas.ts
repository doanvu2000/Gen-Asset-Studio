import type { SpineAtlasData, SpineAtlasPage, SpineRegion } from '@shared/spine'

function entry(line: string): [string, string[]] | null {
  const i = line.indexOf(':')
  if (i < 0) return null
  return [line.slice(0, i).trim(), line.slice(i + 1).split(',').map((v) => v.trim())]
}

export function parseSpineAtlas(text: string): SpineAtlasData {
  const lines = text.replace(/\r/g, '').split('\n')
  const pages: SpineAtlasPage[] = []
  const regions: SpineRegion[] = []
  let i = 0
  while (i < lines.length && !lines[i].trim()) i++
  while (i < lines.length && lines[i].trim() && entry(lines[i])) i++
  let page: SpineAtlasPage | null = null
  let region: (SpineRegion & { index: number; hasOrig: boolean }) | null = null
  const flush = (): void => {
    if (!region) return
    if (!region.hasOrig) {
      region.origW = region.w
      region.origH = region.h
    }
    const { index, hasOrig, ...rest } = region
    void hasOrig
    regions.push(index >= 0 ? { ...rest, name: `${rest.name}#${index}` } : rest)
    region = null
  }
  for (; i < lines.length; i++) {
    const raw = lines[i]
    if (!raw.trim()) {
      flush()
      page = null
      continue
    }
    const e = entry(raw)
    if (!page) {
      if (e) continue
      page = { name: raw.trim(), w: 0, h: 0, pma: false }
      pages.push(page)
      continue
    }
    if (!e) {
      flush()
      region = { name: raw.trim(), page: page.name, x: 0, y: 0, w: 0, h: 0, degrees: 0, offsetX: 0, offsetY: 0, origW: 0, origH: 0, index: -1, hasOrig: false }
      continue
    }
    const [k, v] = e
    const n = v.map((x) => parseInt(x, 10))
    if (!region) {
      if (k === 'size') {
        page.w = n[0]
        page.h = n[1]
      } else if (k === 'pma') page.pma = v[0] === 'true'
      continue
    }
    if (k === 'bounds') {
      region.x = n[0]
      region.y = n[1]
      region.w = n[2]
      region.h = n[3]
    } else if (k === 'xy') {
      region.x = n[0]
      region.y = n[1]
    } else if (k === 'size') {
      region.w = n[0]
      region.h = n[1]
    } else if (k === 'offsets') {
      region.offsetX = n[0]
      region.offsetY = n[1]
      region.origW = n[2]
      region.origH = n[3]
      region.hasOrig = true
    } else if (k === 'offset') {
      region.offsetX = n[0]
      region.offsetY = n[1]
    } else if (k === 'orig') {
      region.origW = n[0]
      region.origH = n[1]
      region.hasOrig = true
    } else if (k === 'rotate') {
      const d = v[0] === 'true' ? 90 : v[0] === 'false' ? 0 : n[0]
      if (d !== 0 && d !== 90) throw new Error(`unsupported region rotation ${d}`)
      region.degrees = d
    } else if (k === 'index') region.index = n[0]
  }
  flush()
  if (!pages.length) throw new Error('no atlas page found')
  for (const p of pages) if (!p.w || !p.h) p.w = p.h = 0
  return { pages, regions }
}

export function regionPageSize(r: SpineRegion): { w: number; h: number } {
  return r.degrees === 90 ? { w: r.h, h: r.w } : { w: r.w, h: r.h }
}
