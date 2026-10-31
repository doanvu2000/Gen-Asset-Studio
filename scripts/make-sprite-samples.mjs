import sharp from 'sharp'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'resources', 'sprite-samples')
mkdirSync(out, { recursive: true })

const CELL = 128
const VEC = {
  S: [0, 1],
  SW: [-0.707, 0.707],
  W: [-1, 0],
  NW: [-0.707, -0.707],
  N: [0, -1],
  NE: [0.707, -0.707],
  E: [1, 0],
  SE: [0.707, 0.707]
}

function frameSvg(dir, f, total, mode = 'walk') {
  const [dx, dy] = VEC[dir]
  const p = mode === 'walk' ? Math.sin((2 * Math.PI * f) / total) : 0
  const bob = mode === 'walk' ? Math.abs(p) * 3 : Math.sin((2 * Math.PI * f) / total) * 2
  const legSpread = 10 * (1 - Math.abs(dx) * 0.5)
  const leftLift = Math.max(0, p) * 9
  const rightLift = Math.max(0, -p) * 9
  const stride = p * 6
  const lx = 64 - legSpread + dx * stride
  const rx = 64 + legSpread - dx * stride
  const back = dy < -0.3
  const eyeSep = 11 * (1 - Math.abs(dx) * 0.55)
  const ecx = 64 + dx * 13
  const ecy = 46 + dy * 3 - bob
  const eyes = back
    ? ''
    : `<circle cx="${ecx - eyeSep}" cy="${ecy}" r="4.2" fill="#1f2937"/><circle cx="${ecx + eyeSep}" cy="${ecy}" r="4.2" fill="#1f2937"/>`
  const nose = back ? '' : `<circle cx="${64 + dx * 24}" cy="${54 + dy * 4 - bob}" r="3.6" fill="#ef4444"/>`
  const hairDx = -dx * 6
  const hairDy = back ? 6 : -10
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${CELL}" height="${CELL}" viewBox="0 0 ${CELL} ${CELL}">
<ellipse cx="64" cy="114" rx="26" ry="7" fill="rgba(0,0,0,0.28)"/>
<circle cx="${64 + dx * 36}" cy="${112 + dy * 7}" r="4" fill="#f59e0b"/>
<rect x="${lx - 6}" y="${92 - leftLift}" width="12" height="22" rx="5" fill="#1e3a8a"/>
<rect x="${rx - 6}" y="${92 - rightLift}" width="12" height="22" rx="5" fill="#1e40af"/>
<rect x="40" y="${62 - bob}" width="48" height="38" rx="14" fill="#3b82f6" stroke="#1e3a8a" stroke-width="3"/>
<circle cx="64" cy="${42 - bob}" r="27" fill="#fcd9b6" stroke="#9a3412" stroke-width="3"/>
<circle cx="${64 + hairDx}" cy="${42 + hairDy - bob}" r="${back ? 25 : 22}" fill="#7c3aed" opacity="0.95"/>
${back ? '' : `<circle cx="${64 + dx * 4}" cy="${50 - bob}" r="19" fill="#fcd9b6"/>`}
${eyes}${nose}
</svg>`
}

async function renderFrame(dir, f, total, mode) {
  return sharp(Buffer.from(frameSvg(dir, f, total, mode))).png().toBuffer()
}

async function alphaBox(buf) {
  const { data, info } = await sharp(buf).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  let x0 = info.width
  let y0 = info.height
  let x1 = -1
  let y1 = -1
  for (let y = 0; y < info.height; y++) {
    for (let x = 0; x < info.width; x++) {
      if (data[(y * info.width + x) * 4 + 3] > 8) {
        if (x < x0) x0 = x
        if (y < y0) y0 = y
        if (x > x1) x1 = x
        if (y > y1) y1 = y
      }
    }
  }
  return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 }
}

async function gridSheet() {
  const dirs = ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE']
  const cols = 6
  const comps = []
  for (let r = 0; r < dirs.length; r++) {
    for (let c = 0; c < cols; c++) comps.push({ input: await renderFrame(dirs[r], c, cols, 'walk'), left: c * CELL, top: r * CELL })
  }
  await sharp({ create: { width: cols * CELL, height: dirs.length * CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(comps)
    .png()
    .toFile(join(out, 'hero_8dir_grid.png'))
}

async function tpSheet() {
  const dirs = [
    ['down', 'S'],
    ['left', 'W'],
    ['right', 'E'],
    ['up', 'N']
  ]
  const n = 4
  const W = 512
  const items = []
  for (const [name, dir] of dirs) {
    for (let f = 0; f < n; f++) {
      const full = await renderFrame(dir, f * 1.5, 6, 'walk')
      const trim = name !== 'left'
      const box = trim ? await alphaBox(full) : { x: 0, y: 0, w: CELL, h: CELL }
      let img = await sharp(full).extract({ left: box.x, top: box.y, width: box.w, height: box.h }).png().toBuffer()
      const rotated = name === 'up'
      if (rotated) img = await sharp(img).rotate(90).png().toBuffer()
      items.push({ key: `walk_${name}_${String(f).padStart(2, '0')}.png`, img, box, rotated, trim, sw: rotated ? box.h : box.w, sh: rotated ? box.w : box.h })
    }
  }
  let x = 0
  let y = 0
  let rowH = 0
  const comps = []
  const frames = {}
  for (const it of items) {
    if (x + it.sw > W) {
      x = 0
      y += rowH + 2
      rowH = 0
    }
    comps.push({ input: it.img, left: x, top: y })
    frames[it.key] = {
      frame: { x, y, w: it.box.w, h: it.box.h },
      rotated: it.rotated,
      trimmed: it.trim,
      spriteSourceSize: { x: it.box.x, y: it.box.y, w: it.box.w, h: it.box.h },
      sourceSize: { w: CELL, h: CELL },
      pivot: { x: 0.5, y: 1 }
    }
    x += it.sw + 2
    rowH = Math.max(rowH, it.sh)
  }
  const H = y + rowH
  await sharp({ create: { width: W, height: H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(comps)
    .png()
    .toFile(join(out, 'hero_4dir_tp.png'))
  const json = {
    frames,
    meta: { app: 'https://www.codeandweb.com/texturepacker', version: '1.0', image: 'hero_4dir_tp.png', format: 'RGBA8888', size: { w: W, h: H }, scale: '1' }
  }
  writeFileSync(join(out, 'hero_4dir_tp.json'), JSON.stringify(json, null, 2))
}

async function aseSheet() {
  const seq = [
    ...Array.from({ length: 4 }, (_, f) => ({ f, total: 4, mode: 'idle' })),
    ...Array.from({ length: 6 }, (_, f) => ({ f, total: 6, mode: 'walk' }))
  ]
  const comps = []
  const frames = []
  for (let i = 0; i < seq.length; i++) {
    comps.push({ input: await renderFrame('S', seq[i].f, seq[i].total, seq[i].mode), left: i * CELL, top: 0 })
    frames.push({
      filename: `hero ${i}.aseprite`,
      frame: { x: i * CELL, y: 0, w: CELL, h: CELL },
      rotated: false,
      trimmed: false,
      spriteSourceSize: { x: 0, y: 0, w: CELL, h: CELL },
      sourceSize: { w: CELL, h: CELL },
      duration: seq[i].mode === 'idle' ? 160 : 100
    })
  }
  const W = seq.length * CELL
  await sharp({ create: { width: W, height: CELL, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite(comps)
    .png()
    .toFile(join(out, 'hero_idle_walk.png'))
  const json = {
    frames,
    meta: {
      app: 'https://www.aseprite.org/',
      version: '1.3',
      image: 'hero_idle_walk.png',
      format: 'RGBA8888',
      size: { w: W, h: CELL },
      scale: '1',
      frameTags: [
        { name: 'idle', from: 0, to: 3, direction: 'forward' },
        { name: 'walk', from: 4, to: 9, direction: 'pingpong' }
      ]
    }
  }
  writeFileSync(join(out, 'hero_idle_walk.json'), JSON.stringify(json, null, 2))
}

await gridSheet()
await tpSheet()
await aseSheet()
console.log(`sprite samples written to ${out}`)
