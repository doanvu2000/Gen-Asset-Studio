import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { codexCurrentDir } from '../../src/main/paths'
import { CodexService } from '../../src/main/codex/service'
import type { CodexInstaller } from '../../src/main/codex/installer'
import { pickChroma } from '../../src/main/pipeline/chroma'
import { decode } from '../../src/main/pipeline/image'
import { parseAtlas } from '../../src/main/sprite/atlas'
import { joinFrames, keyStrip, loadSheet, savePng, stripLayout, uprightFrame } from '../../src/main/sprite/strip'
import { buildNewStripPrompt, composeGuide, fitNewStrip } from '../../src/main/sprite/create'
import type { Direction } from '../../src/shared/sprite'

const root = resolve(__dirname, '../..')
const out = join(process.env['TEMP'] ?? '.', 'gas-s3-spike')
const samples = join(root, 'resources/sprite-samples')
const tplDir = join(root, 'resources/style-templates/candy-pop')
const tpl = JSON.parse(readFileSync(join(tplDir, 'template.json'), 'utf8')) as { promptEn: string }
const log = (m: string): void => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`)
const CELL = 128

async function character(): Promise<string> {
  const p = join(out, 'character.png')
  const tpPath = join(samples, 'hero_4dir_tp.json')
  const tp = parseAtlas(tpPath, readFileSync(tpPath, 'utf8'))
  const sheet = await loadSheet(join(samples, 'hero_4dir_tp.png'))
  const f = await uprightFrame(sheet, tp.frames.find((x) => /down/.test(x.name)) ?? tp.frames[0])
  await savePng(f, p)
  return p
}

async function run(codex: CodexService, id: string, anim: string, dir: Direction, count: number, ref: string, lock: string[]): Promise<string | null> {
  const layout = stripLayout(count, CELL, CELL)
  const guide = await composeGuide(await decode(ref), layout)
  const guidePath = join(out, `${id}-guide.png`)
  await savePng(guide, guidePath)
  const style = join(tplDir, 'preview-sm.png')
  const chroma = await pickChroma(guidePath, [style, ...lock])
  const prompt = buildNewStripPrompt({
    stylePrompt: tpl.promptEn,
    description: 'a cheerful kid hero with purple hair and a blue tunic',
    anim,
    dir,
    view: 'topdown',
    layout,
    chromaName: chroma.promptName,
    chromaHex: chroma.hex,
    lockCount: lock.length,
    styleImageCount: 1,
    refImageCount: 0
  })
  writeFileSync(join(out, `${id}-prompt.txt`), prompt)
  const t0 = Date.now()
  const turn = await codex.generateImage({ cwd: out, model: 'gpt-6-luna' }, prompt, [guidePath, ...lock, style], { model: 'gpt-6-luna', effort: 'medium', timeoutMs: 300000 })
  const img = turn.images.find((i) => (i.savedPath && existsSync(i.savedPath)) || i.base64)
  if (!img) {
    log(`${id}: no image ${turn.status} ${turn.error ?? ''}`)
    return null
  }
  const rawPath = join(out, `${id}-raw.png`)
  if (img.savedPath) writeFileSync(rawPath, readFileSync(img.savedPath))
  else writeFileSync(rawPath, Buffer.from(img.base64 ?? '', 'base64'))
  const keyed = await keyStrip(rawPath, layout, chroma.rgb)
  const fit = await fitNewStrip(keyed, layout, Math.round(CELL * 0.78), CELL - 6)
  const strip = join(out, `${id}-strip.png`)
  await savePng(joinFrames(fit.frames), strip)
  log(`${id}: ${Math.round((Date.now() - t0) / 1000)}s layout ${layout.cols}x${layout.rows} scale=${fit.scale.toFixed(2)} ${fit.qa.checks.map((c) => `${c.id}:${c.status}=${c.value}`).join(' ')}`)
  return strip
}

async function main(): Promise<void> {
  mkdirSync(out, { recursive: true })
  const ref = await character()
  const exe = join(codexCurrentDir, 'bin', 'codex.exe')
  const codex = new CodexService({ exePath: () => exe } as unknown as CodexInstaller, () => undefined)
  await codex.ensureStarted()
  const [walkS] = await Promise.all([
    run(codex, 'walk_S', 'walk', 'S', 6, ref, []),
    new Promise((r) => setTimeout(r, 2500)).then(() => run(codex, 'attack_S', 'attack', 'S', 6, ref, []))
  ])
  if (walkS) await run(codex, 'walk_W', 'walk', 'W', 6, ref, [walkS])
  await codex.stop()
  const rows: Buffer[] = []
  for (const id of ['walk_S', 'attack_S', 'walk_W']) {
    const p = join(out, `${id}-strip.png`)
    if (existsSync(p)) rows.push(await sharp(p).resize({ height: 192, kernel: 'nearest' }).toBuffer())
  }
  let y = 0
  const comps = []
  for (const r of rows) {
    comps.push({ input: r, left: 10, top: y + 10 })
    y += 202
  }
  const sheet = await sharp({ create: { width: 1200, height: y + 20, channels: 4, background: '#a8a8a8' } }).composite(comps).png().toBuffer()
  await sharp(sheet).toFile(join(out, 'contact.png'))
  log(`out ${out}`)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
