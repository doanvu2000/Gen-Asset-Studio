import { join } from 'node:path'
import sharp from 'sharp'
import { pickChroma } from '../../src/main/pipeline/chroma'
import { joinFrames, keyStrip, savePng, stripLayout } from '../../src/main/sprite/strip'
import { fitNewStrip } from '../../src/main/sprite/create'

const out = join(process.env['TEMP'] ?? '.', 'gas-s3-spike')

async function main(): Promise<void> {
  const rows: Buffer[] = []
  for (const id of ['walk_S', 'attack_S', 'walk_W']) {
    const layout = stripLayout(6, 128, 128)
    const chroma = await pickChroma(join(out, `${id}-guide.png`), [])
    const keyed = await keyStrip(join(out, `${id}-raw.png`), layout, chroma.rgb)
    const fit = await fitNewStrip(keyed, layout, 100, 122)
    console.log(id, fit.qa.checks.map((c) => `${c.id}:${c.status}=${c.value}`).join(' '))
    const p = join(out, `${id}-strip2.png`)
    await savePng(joinFrames(fit.frames), p)
    rows.push(await sharp(p).resize({ height: 192, kernel: 'nearest' }).toBuffer())
  }
  const comps = rows.map((r, i) => ({ input: r, left: 10, top: 10 + i * 202 }))
  const sheet = await sharp({ create: { width: 1200, height: 626, channels: 4, background: '#a8a8a8' } }).composite(comps).png().toBuffer()
  await sharp(sheet).toFile(join(out, 'contact2.png'))
}

void main()
