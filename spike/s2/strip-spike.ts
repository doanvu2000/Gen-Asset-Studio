import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { codexCurrentDir, codexHome } from '../../src/main/paths'
import { CodexService } from '../../src/main/codex/service'
import type { CodexInstaller } from '../../src/main/codex/installer'
import { pickChroma } from '../../src/main/pipeline/chroma'
import { parseAtlas } from '../../src/main/sprite/atlas'
import { gridFrames } from '../../src/main/sprite/grid'
import { buildStripPrompt, composeSource, fitStrip, joinFrames, keyStrip, loadSheet, savePng, stripLayout, uprightFrame } from '../../src/main/sprite/strip'
import type { Direction, FrameRect } from '../../src/shared/sprite'

const root = resolve(__dirname, '../..')
const out = process.env['GAS_S2_OUT'] || join(process.env['TEMP'] ?? '.', 'gas-s2-spike')
const samples = join(root, 'resources/sprite-samples')
const tplDir = join(root, 'resources/style-templates/candy-pop')
const tpl = JSON.parse(readFileSync(join(tplDir, 'template.json'), 'utf8')) as { promptEn: string }
const log = (m: string): void => console.log(`${new Date().toISOString().slice(11, 19)} ${m}`)

interface Case {
  id: string
  sheet: string
  frames: FrameRect[]
  dir: Direction
  anim: string
}

async function cases(): Promise<Case[]> {
  const grid = gridFrames({ cellW: 128, cellH: 128, cols: 6, rows: 8, offsetX: 0, offsetY: 0, gapX: 0, gapY: 0 })
  const tpPath = join(samples, 'hero_4dir_tp.json')
  const tp = parseAtlas(tpPath, readFileSync(tpPath, 'utf8'))
  return [
    { id: 'grid_S', sheet: join(samples, 'hero_8dir_grid.png'), frames: grid.slice(0, 6), dir: 'S', anim: 'walk' },
    { id: 'grid_W', sheet: join(samples, 'hero_8dir_grid.png'), frames: grid.slice(12, 18), dir: 'W', anim: 'walk' },
    { id: 'tp_N', sheet: join(samples, 'hero_4dir_tp.png'), frames: tp.frames.filter((f) => /up/.test(f.name)), dir: 'N', anim: 'walk' }
  ]
}

async function prepare(c: Case): Promise<{ originals: Awaited<ReturnType<typeof uprightFrame>>[]; layout: ReturnType<typeof stripLayout>; srcPath: string }> {
  const sheet = await loadSheet(c.sheet)
  const originals = await Promise.all(c.frames.map((f) => uprightFrame(sheet, f)))
  const cellW = Math.max(...originals.map((o) => o.width))
  const cellH = Math.max(...originals.map((o) => o.height))
  const layout = stripLayout(originals.length, cellW, cellH)
  const src = composeSource(originals, layout)
  const srcPath = join(out, `${c.id}-src.png`)
  await savePng(src, srcPath)
  await savePng(joinFrames(originals), join(out, `${c.id}-orig-strip.png`))
  return { originals, layout, srcPath }
}

async function offline(): Promise<void> {
  for (const c of await cases()) {
    const { originals, layout } = await prepare(c)
    const fake = composeSource(originals, layout, [255, 0, 255])
    const big = await sharp(Buffer.from(fake.data), { raw: { width: fake.width, height: fake.height, channels: 4 } })
      .resize(fake.width * 3, fake.height * 3, { kernel: 'lanczos3' })
      .png()
      .toBuffer()
    const keyed = await keyStrip(new Uint8Array(big), layout, [255, 0, 255])
    const fit = await fitStrip(keyed, layout, originals)
    log(`offline ${c.id}: layout ${layout.cols}x${layout.rows} ${layout.width}x${layout.height} ${layout.aspect} scale=${fit.scale.toFixed(3)} off=${fit.offsetX.toFixed(1)},${fit.offsetY.toFixed(1)} ${fit.qa.checks.map((k) => `${k.id}:${k.status}=${k.value}`).join(' ')}`)
    await savePng(joinFrames(fit.frames), join(out, `${c.id}-offline.png`))
  }
}

async function real(only: string[]): Promise<void> {
  const exe = join(codexCurrentDir, 'bin', 'codex.exe')
  if (!existsSync(exe)) throw new Error(`codex missing ${exe}`)
  log(`CODEX_HOME=${codexHome}`)
  const codex = new CodexService({ exePath: () => exe } as unknown as CodexInstaller, (m) => log(`[codex] ${m}`))
  await codex.ensureStarted()
  const style = join(tplDir, 'preview-sm.png')
  const list = (await cases()).filter((c) => !only.length || only.includes(c.id))
  await Promise.all(
    list.map(async (c, k) => {
      await new Promise((r) => setTimeout(r, k * 2500))
      const { originals, layout, srcPath } = await prepare(c)
      const chroma = await pickChroma(srcPath, [style])
      const prompt = buildStripPrompt({
        stylePrompt: tpl.promptEn,
        anim: c.anim,
        dir: c.dir,
        view: 'topdown',
        layout,
        chromaName: chroma.promptName,
        chromaHex: chroma.hex,
        lockCount: 0,
        styleImageCount: 1,
        refImageCount: 0
      })
      writeFileSync(join(out, `${c.id}-prompt.txt`), prompt)
      const t0 = Date.now()
      const turn = await codex.generateImage({ cwd: out, model: 'gpt-6-luna' }, prompt, [srcPath, style], { model: 'gpt-6-luna', effort: 'medium', timeoutMs: 300000 })
      const img = turn.images.find((i) => (i.savedPath && existsSync(i.savedPath)) || i.base64)
      if (!img) {
        log(`${c.id}: no image ${turn.status} ${turn.error ?? ''} ${turn.agentText}`)
        return
      }
      const rawPath = join(out, `${c.id}-raw.png`)
      if (img.savedPath) writeFileSync(rawPath, readFileSync(img.savedPath))
      else writeFileSync(rawPath, Buffer.from(img.base64 ?? '', 'base64'))
      const meta = await sharp(rawPath).metadata()
      const keyed = await keyStrip(rawPath, layout, chroma.rgb)
      await savePng(keyed, join(out, `${c.id}-keyed.png`))
      const fit = await fitStrip(keyed, layout, originals)
      await savePng(joinFrames(fit.frames), join(out, `${c.id}-new-strip.png`))
      log(`${c.id}: ${Math.round((Date.now() - t0) / 1000)}s raw ${meta.width}x${meta.height} chroma ${chroma.hex} layout ${layout.cols}x${layout.rows} ${layout.aspect} scale=${fit.scale.toFixed(3)} ${fit.qa.checks.map((x) => `${x.id}:${x.status}=${x.value}`).join(' ')}`)
    })
  )
  await codex.stop()
}

async function main(): Promise<void> {
  mkdirSync(out, { recursive: true })
  await offline()
  if (process.argv.includes('--real')) await real(process.argv.slice(2).filter((a) => !a.startsWith('--')))
  log(`out: ${out}`)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
