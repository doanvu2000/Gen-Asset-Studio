import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const out = join(root, 'resources', 'spine-samples', 'hero')
mkdirSync(out, { recursive: true })

const svg = (w, h, body) => Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${body}</svg>`)

const parts = {
  head: { w: 100, h: 100, svg: svg(100, 100, '<circle cx="50" cy="52" r="44" fill="#ffd9b0" stroke="#7a3b12" stroke-width="5"/><path d="M8 46 Q50 -8 92 46 Q70 26 50 30 Q30 26 8 46Z" fill="#8a3ffc" stroke="#4b1d8f" stroke-width="4"/><circle cx="36" cy="58" r="6" fill="#222"/><circle cx="64" cy="58" r="6" fill="#222"/><path d="M38 76 Q50 86 62 76" stroke="#b33" stroke-width="4" fill="none"/>') },
  body: { w: 80, h: 100, svg: svg(80, 100, '<rect x="4" y="4" width="72" height="92" rx="22" fill="#2f7cf6" stroke="#173c86" stroke-width="5"/><rect x="10" y="58" width="60" height="10" fill="#f5c542"/>') },
  arm_l: { w: 30, h: 80, svg: svg(30, 80, '<rect x="4" y="3" width="22" height="64" rx="11" fill="#2f7cf6" stroke="#173c86" stroke-width="4"/><circle cx="15" cy="68" r="10" fill="#ffd9b0" stroke="#7a3b12" stroke-width="4"/>') },
  arm_r: { w: 30, h: 80, svg: svg(30, 80, '<rect x="4" y="3" width="22" height="64" rx="11" fill="#2f7cf6" stroke="#173c86" stroke-width="4"/><circle cx="15" cy="68" r="10" fill="#ffd9b0" stroke="#7a3b12" stroke-width="4"/>') },
  leg_l: { w: 32, h: 70, svg: svg(32, 70, '<rect x="5" y="2" width="22" height="52" rx="8" fill="#203a7a" stroke="#0d1d44" stroke-width="4"/><rect x="2" y="50" width="28" height="17" rx="7" fill="#6b3a1e" stroke="#2e170a" stroke-width="3"/>') },
  leg_r: { w: 32, h: 70, svg: svg(32, 70, '<rect x="5" y="2" width="22" height="52" rx="8" fill="#203a7a" stroke="#0d1d44" stroke-width="4"/><rect x="2" y="50" width="28" height="17" rx="7" fill="#6b3a1e" stroke="#2e170a" stroke-width="3"/>') }
}

const layout = [
  { name: 'head', x: 2, y: 2, rotate: false },
  { name: 'body', x: 104, y: 2, rotate: false, trim: { offX: 8, offY: 6, origW: 96, origH: 112 } },
  { name: 'arm_l', x: 190, y: 2, rotate: true },
  { name: 'arm_r', x: 272, y: 2, rotate: false },
  { name: 'leg_l', x: 304, y: 2, rotate: false },
  { name: 'leg_r', x: 338, y: 2, rotate: true }
]

const PAGE_W = 512
const PAGE_H = 128
const comps = []
const lines = ['hero.png', `size:${PAGE_W},${PAGE_H}`, 'filter:Linear,Linear']
for (const l of layout) {
  const p = parts[l.name]
  let img = await sharp(p.svg).png().toBuffer()
  if (l.rotate) img = await sharp(img).rotate(-90).png().toBuffer()
  comps.push({ input: img, left: l.x, top: l.y })
  lines.push(l.name)
  lines.push(`bounds:${l.x},${l.y},${p.w},${p.h}`)
  if (l.trim) lines.push(`offsets:${l.trim.offX},${l.trim.offY},${l.trim.origW},${l.trim.origH}`)
  if (l.rotate) lines.push('rotate:90')
}
await sharp({ create: { width: PAGE_W, height: PAGE_H, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).composite(comps).png().toFile(join(out, 'hero.png'))
writeFileSync(join(out, 'hero.atlas'), lines.join('\n') + '\n')

const skeleton = {
  skeleton: { hash: 'gas-sample-hero', spine: '4.2.11', x: -70, y: -5, width: 140, height: 290, images: './', audio: '' },
  bones: [
    { name: 'root' },
    { name: 'hip', parent: 'root', y: 70 },
    { name: 'torso', parent: 'hip', y: 55 },
    { name: 'head', parent: 'torso', y: 60 },
    { name: 'arm_l', parent: 'torso', x: -48, y: 35 },
    { name: 'arm_r', parent: 'torso', x: 48, y: 35 },
    { name: 'leg_l', parent: 'hip', x: -18, y: -5 },
    { name: 'leg_r', parent: 'hip', x: 18, y: -5 }
  ],
  slots: [
    { name: 'leg_l', bone: 'leg_l', attachment: 'leg_l' },
    { name: 'leg_r', bone: 'leg_r', attachment: 'leg_r' },
    { name: 'arm_r', bone: 'arm_r', attachment: 'arm_r' },
    { name: 'body', bone: 'torso', attachment: 'body' },
    { name: 'head', bone: 'head', attachment: 'head' },
    { name: 'arm_l', bone: 'arm_l', attachment: 'arm_l' }
  ],
  skins: [
    {
      name: 'default',
      attachments: {
        leg_l: { leg_l: { x: 0, y: -32, width: 32, height: 70 } },
        leg_r: { leg_r: { x: 0, y: -32, width: 32, height: 70 } },
        arm_r: { arm_r: { x: 0, y: -33, width: 30, height: 80 } },
        body: { body: { x: 0, y: 0, width: 96, height: 112 } },
        head: { head: { x: 0, y: 48, width: 100, height: 100 } },
        arm_l: { arm_l: { x: 0, y: -33, width: 30, height: 80 } }
      }
    }
  ],
  animations: {
    idle: {
      bones: {
        hip: { translate: [{ y: 0 }, { time: 0.6, y: -3 }, { time: 1.2, y: 0 }] },
        head: { rotate: [{ value: 0 }, { time: 0.6, value: 4 }, { time: 1.2, value: 0 }] },
        arm_l: { rotate: [{ value: 0 }, { time: 0.6, value: -5 }, { time: 1.2, value: 0 }] },
        arm_r: { rotate: [{ value: 0 }, { time: 0.6, value: 5 }, { time: 1.2, value: 0 }] }
      }
    },
    walk: {
      bones: {
        hip: { translate: [{ y: 0 }, { time: 0.25, y: 5 }, { time: 0.5, y: 0 }, { time: 0.75, y: 5 }, { time: 1, y: 0 }] },
        leg_l: { rotate: [{ value: 25 }, { time: 0.5, value: -25 }, { time: 1, value: 25 }] },
        leg_r: { rotate: [{ value: -25 }, { time: 0.5, value: 25 }, { time: 1, value: -25 }] },
        arm_l: { rotate: [{ value: -30 }, { time: 0.5, value: 30 }, { time: 1, value: -30 }] },
        arm_r: { rotate: [{ value: 30 }, { time: 0.5, value: -30 }, { time: 1, value: 30 }] },
        head: { rotate: [{ value: -3 }, { time: 0.5, value: 3 }, { time: 1, value: -3 }] }
      }
    }
  }
}
writeFileSync(join(out, 'hero.json'), JSON.stringify(skeleton, null, 2) + '\n')
console.log('spine sample written to', out)
