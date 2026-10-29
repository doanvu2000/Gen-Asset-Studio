import sharp from 'sharp'
import { mkdir } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'resources', 'sample-project', 'assets')
const INK = '#3B2A4A'

function svg(w, h, body, defs = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs>${defs}</defs>${body}</svg>`
}

function vgrad(id, stops) {
  const s = stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')
  return `<linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1">${s}</linearGradient>`
}

function rgrad(id, stops, cx = 0.4, cy = 0.35, r = 0.7) {
  const s = stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('')
  return `<radialGradient id="${id}" cx="${cx}" cy="${cy}" r="${r}">${s}</radialGradient>`
}

function pill(w, h, { top, mid, bot, lip }, symbol = '') {
  const m = 4
  const bw = w - m * 2
  const bh = h - m * 2
  const r = Math.min(bh / 2, 30)
  const defs = vgrad('f', [[0, top], [0.55, mid], [1, bot]])
  const body = [
    `<rect x="${m}" y="${m}" width="${bw}" height="${bh}" rx="${r}" fill="${INK}"/>`,
    `<rect x="${m + 4}" y="${m + 4}" width="${bw - 8}" height="${bh - 8}" rx="${r - 4}" fill="${lip}"/>`,
    `<rect x="${m + 4}" y="${m + 4}" width="${bw - 8}" height="${bh - 16}" rx="${r - 4}" fill="url(#f)"/>`,
    `<rect x="${m + 18}" y="${m + 10}" width="${bw - 36}" height="${Math.round(bh * 0.22)}" rx="${Math.round(bh * 0.11)}" fill="#FFFFFF" opacity="0.45"/>`,
    symbol
  ].join('')
  return svg(w, h, body, defs)
}

function symbolCheck(cx, cy, s) {
  const d = `M ${cx - s} ${cy} L ${cx - s * 0.3} ${cy + s * 0.7} L ${cx + s} ${cy - s * 0.65}`
  return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${s * 0.62}" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#FFFFFF" stroke-width="${s * 0.36}" stroke-linecap="round" stroke-linejoin="round"/>`
}

function symbolX(cx, cy, s, color = '#FFFFFF') {
  const d = `M ${cx - s} ${cy - s} L ${cx + s} ${cy + s} M ${cx + s} ${cy - s} L ${cx - s} ${cy + s}`
  return `<path d="${d}" fill="none" stroke="${INK}" stroke-width="${s * 0.75}" stroke-linecap="round"/><path d="${d}" fill="none" stroke="${color}" stroke-width="${s * 0.42}" stroke-linecap="round"/>`
}

function symbolPlay(cx, cy, s) {
  const d = `M ${cx - s * 0.7} ${cy - s} L ${cx + s} ${cy} L ${cx - s * 0.7} ${cy + s} Z`
  return `<path d="${d}" fill="#FFFFFF" stroke="${INK}" stroke-width="${s * 0.26}" stroke-linejoin="round"/>`
}

function btnClose() {
  const defs = vgrad('f', [[0, '#FF7A6B'], [0.6, '#F0453A'], [1, '#C92A2A']])
  const body = [
    `<circle cx="48" cy="48" r="43" fill="${INK}"/>`,
    `<circle cx="48" cy="48" r="38" fill="#A51E1E"/>`,
    `<circle cx="48" cy="45" r="37" fill="url(#f)"/>`,
    `<ellipse cx="48" cy="26" rx="22" ry="9" fill="#FFFFFF" opacity="0.45"/>`,
    symbolX(48, 47, 14)
  ].join('')
  return svg(96, 96, body, defs)
}

function popupFrame() {
  const w = 480
  const h = 360
  const defs = vgrad('fr', [[0, '#8FD3FF'], [1, '#3C8FE0']]) + vgrad('in', [[0, '#FFF9EC'], [1, '#FFEFD0']])
  const body = [
    `<rect x="4" y="4" width="${w - 8}" height="${h - 8}" rx="36" fill="${INK}"/>`,
    `<rect x="10" y="10" width="${w - 20}" height="${h - 20}" rx="31" fill="url(#fr)"/>`,
    `<rect x="16" y="14" width="${w - 32}" height="14" rx="7" fill="#FFFFFF" opacity="0.35"/>`,
    `<rect x="28" y="28" width="${w - 56}" height="${h - 56}" rx="20" fill="${INK}" opacity="0.9"/>`,
    `<rect x="31" y="31" width="${w - 62}" height="${h - 62}" rx="18" fill="url(#in)"/>`
  ].join('')
  return svg(w, h, body, defs)
}

function ribbon() {
  const w = 400
  const h = 120
  const defs = vgrad('f', [[0, '#FF6FB5'], [0.6, '#F0378F'], [1, '#C21F72']]) + vgrad('t', [[0, '#C21F72'], [1, '#8E1252']])
  const tailL = `M 6 52 L 70 52 L 70 104 L 6 104 L 26 78 Z`
  const tailR = `M ${w - 6} 52 L ${w - 70} 52 L ${w - 70} 104 L ${w - 6} 104 L ${w - 26} 78 Z`
  const foldL = `M 52 92 L 70 104 L 70 86 Z`
  const foldR = `M ${w - 52} 92 L ${w - 70} 104 L ${w - 70} 86 Z`
  const band = `M 44 16 Q ${w / 2} 4 ${w - 44} 16 L ${w - 44} 86 Q ${w / 2} 74 44 86 Z`
  const shine = `M 56 24 Q ${w / 2} 13 ${w - 56} 24 L ${w - 56} 34 Q ${w / 2} 23 56 34 Z`
  const body = [
    `<path d="${tailL}" fill="url(#t)" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`,
    `<path d="${tailR}" fill="url(#t)" stroke="${INK}" stroke-width="5" stroke-linejoin="round"/>`,
    `<path d="${foldL}" fill="${INK}"/>`,
    `<path d="${foldR}" fill="${INK}"/>`,
    `<path d="${band}" fill="url(#f)" stroke="${INK}" stroke-width="6" stroke-linejoin="round"/>`,
    `<path d="${shine}" fill="#FFFFFF" opacity="0.4"/>`
  ].join('')
  return svg(w, h, body, defs)
}

function progressBg() {
  const w = 360
  const h = 44
  const body = [
    `<rect x="3" y="3" width="${w - 6}" height="${h - 6}" rx="${(h - 6) / 2}" fill="${INK}"/>`,
    `<rect x="8" y="8" width="${w - 16}" height="${h - 16}" rx="${(h - 16) / 2}" fill="#2A1D36"/>`,
    `<rect x="8" y="${h - 16}" width="${w - 16}" height="8" rx="4" fill="#4C3A5E"/>`
  ].join('')
  return svg(w, h, body)
}

function progressFill() {
  const w = 344
  const h = 28
  const defs = vgrad('f', [[0, '#B8FF6A'], [0.55, '#5FD83A'], [1, '#2FA82A']])
  const body = [
    `<rect x="2" y="2" width="${w - 4}" height="${h - 4}" rx="${(h - 4) / 2}" fill="url(#f)"/>`,
    `<rect x="12" y="5" width="${w - 24}" height="6" rx="3" fill="#FFFFFF" opacity="0.5"/>`
  ].join('')
  return svg(w, h, body, defs)
}

function iconCoin() {
  const defs = rgrad('f', [[0, '#FFF27A'], [0.6, '#FFC928'], [1, '#E79A10']])
  const body = [
    `<circle cx="48" cy="50" r="42" fill="${INK}"/>`,
    `<circle cx="48" cy="50" r="37" fill="#C77A0A"/>`,
    `<circle cx="48" cy="47" r="36" fill="url(#f)"/>`,
    `<circle cx="48" cy="47" r="25" fill="none" stroke="#E79A10" stroke-width="5"/>`,
    `<rect x="42" y="31" width="12" height="32" rx="6" fill="#E79A10"/>`,
    `<ellipse cx="36" cy="28" rx="12" ry="6" fill="#FFFFFF" opacity="0.6" transform="rotate(-25 36 28)"/>`
  ].join('')
  return svg(96, 96, body, defs)
}

function iconGem() {
  const top = 'M 22 34 L 34 16 L 62 16 L 74 34 Z'
  const bottom = 'M 22 34 L 74 34 L 48 82 Z'
  const outline = 'M 22 34 L 34 16 L 62 16 L 74 34 L 48 82 Z'
  const body = [
    `<path d="${outline}" fill="none" stroke="${INK}" stroke-width="10" stroke-linejoin="round"/>`,
    `<path d="${top}" fill="#7FF0FF"/>`,
    `<path d="${bottom}" fill="#26B8E8"/>`,
    `<path d="M 34 34 L 48 82 L 22 34 Z" fill="#1A8FCC"/>`,
    `<path d="M 40 16 L 34 34 L 22 34 L 34 16 Z" fill="#B8F8FF"/>`,
    `<path d="M 48 16 L 62 16 L 74 34 L 60 34 Z" fill="#4FD6F5"/>`,
    `<path d="M 34 34 L 48 16 L 62 34 Z" fill="#9AF5FF"/>`,
    `<path d="${outline}" fill="none" stroke="${INK}" stroke-width="4" stroke-linejoin="round"/>`,
    `<path d="M 30 26 L 36 20" stroke="#FFFFFF" stroke-width="4" stroke-linecap="round" opacity="0.85"/>`
  ].join('')
  return svg(96, 96, `<g transform="translate(48 49) scale(1.15) translate(-48 -49)">${body}</g>`)
}

function starPath(cx, cy, ro, ri, n = 5) {
  const pts = []
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 === 0 ? ro : ri
    const a = -Math.PI / 2 + (i * Math.PI) / n
    pts.push(`${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`)
  }
  return `M ${pts.join(' L ')} Z`
}

function iconStar() {
  const defs = vgrad('f', [[0, '#FFF27A'], [0.6, '#FFCC22'], [1, '#F29B0E']])
  const d = starPath(48, 52, 42, 19)
  const body = [
    `<path d="${d}" fill="${INK}" stroke="${INK}" stroke-width="9" stroke-linejoin="round"/>`,
    `<path d="${d}" fill="url(#f)"/>`,
    `<path d="${starPath(48, 52, 26, 12)}" fill="#FFFFFF" opacity="0.18"/>`,
    `<ellipse cx="38" cy="40" rx="7" ry="4" fill="#FFFFFF" opacity="0.75" transform="rotate(-35 38 40)"/>`
  ].join('')
  return svg(96, 96, body, defs)
}

function iconHeart() {
  const defs = vgrad('f', [[0, '#FF7FA8'], [0.6, '#F23D6E'], [1, '#C21F4E']])
  const d = 'M 48 84 C 20 64 10 50 10 34 C 10 20 21 12 32 12 C 40 12 45 16 48 22 C 51 16 56 12 64 12 C 75 12 86 20 86 34 C 86 50 76 64 48 84 Z'
  const body = [
    `<path d="${d}" fill="${INK}" stroke="${INK}" stroke-width="8" stroke-linejoin="round"/>`,
    `<path d="${d}" fill="url(#f)"/>`,
    `<ellipse cx="30" cy="30" rx="10" ry="6" fill="#FFFFFF" opacity="0.7" transform="rotate(-30 30 30)"/>`
  ].join('')
  return svg(96, 96, body, defs)
}

function toggle(on) {
  const w = 128
  const h = 64
  const track = on ? vgrad('f', [[0, '#7BEA5C'], [1, '#2FA82A']]) : vgrad('f', [[0, '#C9C4CF'], [1, '#8F8898']])
  const knob = vgrad('k', [[0, '#FFFFFF'], [1, '#E3DDE8']])
  const kx = on ? w - 34 : 34
  const body = [
    `<rect x="4" y="6" width="${w - 8}" height="${h - 12}" rx="${(h - 12) / 2}" fill="${INK}"/>`,
    `<rect x="9" y="11" width="${w - 18}" height="${h - 22}" rx="${(h - 22) / 2}" fill="url(#f)"/>`,
    `<rect x="18" y="14" width="${w - 36}" height="7" rx="3.5" fill="#FFFFFF" opacity="0.35"/>`,
    `<circle cx="${kx}" cy="32" r="26" fill="${INK}"/>`,
    `<circle cx="${kx}" cy="31" r="21" fill="url(#k)"/>`,
    `<ellipse cx="${kx - 6}" cy="23" rx="8" ry="4" fill="#FFFFFF"/>`
  ].join('')
  return svg(w, h, body, track + knob)
}

const assets = [
  ['ui/buttons/btn_play.png', pill(256, 96, { top: '#FFE36B', mid: '#FFB21E', bot: '#F28A0C', lip: '#C2620A' }, symbolPlay(128, 44, 22))],
  ['ui/buttons/btn_ok_green.png', pill(256, 96, { top: '#9BF06E', mid: '#4FCB3A', bot: '#2FA82A', lip: '#1F7A1E' }, symbolCheck(128, 45, 20))],
  ['ui/buttons/btn_cancel_grey.png', pill(256, 96, { top: '#D9D4DE', mid: '#ADA6B6', bot: '#8F8898', lip: '#6A6373' }, symbolX(128, 44, 14))],
  ['ui/buttons/btn_close.png', btnClose()],
  ['ui/panels/popup_frame.png', popupFrame()],
  ['ui/panels/ribbon_title.png', ribbon()],
  ['ui/bars/progress_bg.png', progressBg()],
  ['ui/bars/progress_fill.png', progressFill()],
  ['ui/toggles/toggle_on.png', toggle(true)],
  ['ui/toggles/toggle_off.png', toggle(false)],
  ['icons/icon_coin.png', iconCoin()],
  ['icons/icon_gem.png', iconGem()],
  ['icons/icon_star.png', iconStar()],
  ['icons/icon_heart.png', iconHeart()]
]

async function main() {
  for (const [rel, markup] of assets) {
    const file = join(outDir, ...rel.split('/'))
    await mkdir(dirname(file), { recursive: true })
    await sharp(Buffer.from(markup), { density: 72 }).png({ compressionLevel: 9 }).toFile(file)
    const meta = await sharp(file).metadata()
    console.log(`${rel} ${meta.width}x${meta.height}`)
  }
  if (process.argv.includes('--sheet')) {
    const cell = 300
    const cols = 4
    const rows = Math.ceil(assets.length / cols)
    const tiles = []
    for (let i = 0; i < assets.length; i++) {
      const file = join(outDir, ...assets[i][0].split('/'))
      const img = sharp(file).resize({ width: cell - 20, height: cell - 20, fit: 'inside', withoutEnlargement: true })
      const buf = await img.png().toBuffer()
      const m = await sharp(buf).metadata()
      tiles.push({ input: buf, left: (i % cols) * cell + Math.round((cell - m.width) / 2), top: Math.floor(i / cols) * cell + Math.round((cell - m.height) / 2) })
    }
    const checker = Buffer.from(svg(cols * cell, rows * cell, `<defs><pattern id="c" width="20" height="20" patternUnits="userSpaceOnUse"><rect width="20" height="20" fill="#FFFFFF"/><rect width="10" height="10" fill="#E4E4E9"/><rect x="10" y="10" width="10" height="10" fill="#E4E4E9"/></pattern></defs><rect width="100%" height="100%" fill="url(#c)"/>`))
    const sheet = process.argv[process.argv.indexOf('--sheet') + 1]
    await sharp(checker).composite(tiles).png().toFile(sheet)
    console.log(`sheet ${sheet}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
