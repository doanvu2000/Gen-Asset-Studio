import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import sharp from 'sharp'
import { PipelineClient } from '../src/main/pipeline/client'
import { pickChroma } from '../src/main/pipeline/chroma'
import { processAsset } from '../src/main/pipeline/process'
import type { ProcessOptions, ProcessResult } from '../src/main/pipeline/types'

const root = resolve(__dirname, '..')
const inDir = join(root, 'spike/m0/in')
const aiDir = join(root, 'spike/m0/out')
const outDir = join(root, 'spike/m0/pipe')
const synthDir = join(outDir, 'synth')
mkdirSync(synthDir, { recursive: true })

const ZOOM = 2
const CORNER = 40
const CORNER_ZOOM = 5

interface Case {
  name: string
  ai: Buffer
  original: Buffer
  options: ProcessOptions
}

function noise(buf: Buffer, amount: number, seed: number): Buffer {
  let s = seed
  const rnd = (): number => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 4294967296
  }
  const out = Buffer.from(buf)
  for (let i = 0; i < out.length; i += 3) {
    for (let c = 0; c < 3; c++) out[i + c] = Math.max(0, Math.min(255, out[i + c] + Math.round((rnd() - 0.5) * 2 * amount)))
  }
  return out
}

async function svgToNoisyPng(svg: string, seed: number): Promise<Buffer> {
  const { data, info } = await sharp(Buffer.from(svg)).removeAlpha().raw().toBuffer({ resolveWithObject: true })
  return sharp(noise(data, 6, seed), { raw: { width: info.width, height: info.height, channels: 3 } }).png().toBuffer()
}

async function synthCases(original: Buffer): Promise<Case[]> {
  const pinkGlow = `<svg xmlns="http://www.w3.org/2000/svg" width="2048" height="768">
  <defs>
    <filter id="g" x="-20%" y="-50%" width="140%" height="200%"><feGaussianBlur stdDeviation="22"/></filter>
    <linearGradient id="b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ff7ad9"/><stop offset="1" stop-color="#e0309a"/></linearGradient>
  </defs>
  <rect width="2048" height="768" fill="#06f40a"/>
  <rect x="70" y="110" width="1908" height="540" rx="270" fill="#ff30ff" opacity="0.85" filter="url(#g)"/>
  <rect x="110" y="140" width="1828" height="480" rx="240" fill="#6a1680"/>
  <rect x="140" y="168" width="1768" height="424" rx="212" fill="url(#b)"/>
  <rect x="240" y="196" width="1568" height="130" rx="65" fill="#ffc6f0"/>
  <path d="M1960 90 l14 36 l36 14 l-36 14 l-14 36 l-14 -36 l-36 -14 l36 -14z" fill="#fff6a0"/>
  <path d="M60 640 l10 26 l26 10 l-26 10 l-10 26 l-10 -26 l-26 -10 l26 -10z" fill="#fff6a0"/>
  <circle cx="1030" cy="740" r="6" fill="#ff80e0"/>
</svg>`
  const frame = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024">
  <rect width="1024" height="1024" fill="#fb06f9"/>
  <rect x="90" y="90" width="844" height="844" rx="120" fill="#2d7be0"/>
  <rect x="150" y="150" width="724" height="724" rx="80" fill="#fb06f9"/>
  <rect x="120" y="100" width="784" height="30" rx="15" fill="#9fd0ff"/>
  <circle cx="512" cy="20" r="8" fill="#ffffff"/>
</svg>`
  const frameOrig = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128">
  <rect x="4" y="4" width="120" height="120" rx="16" fill="#3a9b3a"/>
  <rect x="12" y="12" width="104" height="104" rx="10" fill="#000" fill-opacity="0"/>
</svg>`
  const frameOrigPng = await sharp(Buffer.from(frameOrig)).png().toBuffer()
  const frameOrigCut = await sharp(frameOrigPng)
    .composite([
      {
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128"><rect x="12" y="12" width="104" height="104" rx="10" fill="#000"/></svg>`
        ),
        blend: 'dest-out'
      }
    ])
    .png()
    .toBuffer()
  const pinkAi = await svgToNoisyPng(pinkGlow, 7)
  const frameAi = await svgToNoisyPng(frame, 11)
  writeFileSync(join(synthDir, 'pink_glow_on_green.png'), pinkAi)
  writeFileSync(join(synthDir, 'frame_on_magenta.png'), frameAi)
  writeFileSync(join(synthDir, 'frame_original.png'), frameOrigCut)
  return [
    { name: 'synth-pink-glow-green', ai: pinkAi, original, options: { chroma: 'green' } },
    { name: 'synth-frame-hole-magenta', ai: frameAi, original: frameOrigCut, options: { chroma: 'magenta', fit: { nineSlice: false } } }
  ]
}

function checker(w: number, h: number): Buffer {
  const buf = Buffer.alloc(w * h * 4)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = ((x >> 3) + (y >> 3)) & 1 ? 255 : 205
      const i = (y * w + x) * 4
      buf[i] = v
      buf[i + 1] = v
      buf[i + 2] = v
      buf[i + 3] = 255
    }
  }
  return buf
}

async function framed(png: Buffer, zoom: number): Promise<{ buf: Buffer; w: number; h: number }> {
  const meta = await sharp(png).metadata()
  const w = (meta.width ?? 1) * zoom
  const h = (meta.height ?? 1) * zoom
  const scaled = await sharp(png).resize(w, h, { kernel: 'nearest' }).png().toBuffer()
  const W = w + 2
  const H = h + 2
  const base = checker(W, H)
  for (let x = 0; x < W; x++) {
    for (const y of [0, H - 1]) base.set([255, 0, 0, 255], (y * W + x) * 4)
  }
  for (let y = 0; y < H; y++) {
    for (const x of [0, W - 1]) base.set([255, 0, 0, 255], (y * W + x) * 4)
  }
  const buf = await sharp(base, { raw: { width: W, height: H, channels: 4 } })
    .composite([{ input: scaled, left: 1, top: 1 }])
    .png()
    .toBuffer()
  return { buf, w: W, h: H }
}

function label(text: string, w: number): Buffer {
  const safe = text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="22"><rect width="100%" height="100%" fill="#1c1c1e"/><text x="6" y="16" font-family="Consolas, monospace" font-size="13" fill="#f5f5f7">${safe}</text></svg>`
  )
}

async function contactSheet(rows: { name: string; original: Buffer; result: ProcessResult }[]): Promise<Buffer> {
  const tiles: { input: Buffer; left: number; top: number }[] = []
  let y = 8
  let width = 0
  for (const r of rows) {
    const o = await framed(r.original, ZOOM)
    const n = await framed(Buffer.from(r.result.png1x), ZOOM)
    const meta = await sharp(Buffer.from(r.result.png1x)).metadata()
    const cw = Math.min(CORNER, meta.width ?? CORNER)
    const ch = Math.min(CORNER, meta.height ?? CORNER)
    const corner = await sharp(Buffer.from(r.result.png1x)).extract({ left: 0, top: 0, width: cw, height: ch }).png().toBuffer()
    const c = await framed(corner, CORNER_ZOOM)
    const qa = r.result.qa.checks.map((k) => `${k.id}:${k.status}=${k.value}`).join(' ')
    const text = `${r.name} | ${r.result.qa.pass ? 'PASS' : 'FAIL'} | ${r.result.debug.fit.mode} | ${qa}`
    const rowW = o.w + n.w + c.w + 32
    width = Math.max(width, rowW, 1100)
    tiles.push({ input: label(text, Math.max(rowW, 1100)), left: 8, top: y })
    y += 26
    tiles.push({ input: o.buf, left: 8, top: y })
    tiles.push({ input: n.buf, left: 8 + o.w + 8, top: y })
    tiles.push({ input: c.buf, left: 8 + o.w + 8 + n.w + 8, top: y })
    y += Math.max(o.h, c.h) + 14
  }
  return sharp({ create: { width: width + 16, height: y + 4, channels: 4, background: { r: 44, g: 44, b: 46, alpha: 1 } } })
    .composite(tiles)
    .png()
    .toBuffer()
}

async function main(): Promise<void> {
  const original = await sharp(join(inDir, 'btn_green.png')).png().toBuffer()
  const styleRef = await sharp(join(inDir, 'style_ref.png')).png().toBuffer()
  const cases: Case[] = readdirSync(aiDir)
    .filter((f) => f.endsWith('.png'))
    .map((f) => ({ name: basename(f, '.png').replace(/-2026-10-29T[\d-]+Z/, ''), ai: readFileSync(join(aiDir, f)), original, options: { chroma: 'magenta' } }))
  cases.push(...(await synthCases(original)))

  const chromaSrc = await pickChroma(original, [styleRef])
  const pinkKeyed = await processAsset({ ai: cases[0].ai, original, options: { chroma: 'magenta' } })
  const pinkOnly = await pickChroma(pinkKeyed.png1x, [styleRef])
  console.log(`pickChroma(btn_green + style_ref) -> ${chromaSrc.name} ${chromaSrc.hex}`, chromaSrc.scores.map((s) => `${s.name}:${s.p1Distance}/${s.nearFraction.toFixed(3)}`).join(' '))
  console.log(`pickChroma(pink AI result + style_ref) -> ${pinkOnly.name}`, pinkOnly.scores.map((s) => `${s.name}:${s.p1Distance}/${s.nearFraction.toFixed(3)}`).join(' '))
  const greenOnly = await pickChroma(original)
  console.log(`pickChroma(btn_green only) -> ${greenOnly.name}`)

  const rows: { name: string; original: Buffer; result: ProcessResult }[] = []
  const summary: Record<string, unknown> = {}
  for (const c of cases) {
    const result = await processAsset({ ai: c.ai, original: c.original, options: { ...c.options, debugImages: true } })
    writeFileSync(join(outDir, `${c.name}.png`), result.png1x)
    if (result.debug.images) {
      writeFileSync(join(outDir, `${c.name}.keyed.png`), result.debug.images.keyed)
      writeFileSync(join(outDir, `${c.name}.block.png`), result.debug.images.block)
    }
    rows.push({ name: c.name, original: c.original, result })
    const { images, ...debug } = result.debug
    void images
    summary[c.name] = { qa: result.qa, debug }
    console.log(
      `${c.name.padEnd(28)} ${result.qa.pass ? 'PASS' : 'FAIL'} ${result.debug.fit.mode.padEnd(10)} ` +
        result.qa.checks.map((k) => `${k.id}:${k.status}=${k.value}`).join(' ') +
        ` bg=${result.debug.background.bg.join(',')} tol=${result.debug.background.hardTolerance} holes=${result.debug.background.holesKeyed}/${result.debug.background.holesKept} comps=${result.debug.extract.kept}/${result.debug.extract.components} ms=${JSON.stringify(result.debug.timingsMs)}`
    )
  }

  const client = new PipelineClient(resolve(root, 'src/main/pipeline/worker.ts'), { execArgv: ['--import', 'tsx'], size: 2 })
  const t0 = performance.now()
  const viaWorker = await Promise.all(cases.slice(0, 2).map((c) => client.processAsset({ ai: c.ai, original: c.original, options: c.options })))
  const x2 = await client.scale({ png: viaWorker[0].png1x, factor: 2 })
  await client.close()
  const x2meta = await sharp(Buffer.from(x2)).metadata()
  console.log(`worker: ${viaWorker.length} assets in ${Math.round(performance.now() - t0)} ms, qa=${viaWorker.map((r) => r.qa.pass).join(',')}, x2=${x2meta.width}x${x2meta.height}`)

  writeFileSync(join(outDir, 'qa-summary.json'), JSON.stringify({ chroma: { chromaSrc, pinkOnly, greenOnly }, summary }, null, 2))
  writeFileSync(join(outDir, 'contact-sheet.png'), await contactSheet(rows))
  console.log(`contact sheet: ${join(outDir, 'contact-sheet.png')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
