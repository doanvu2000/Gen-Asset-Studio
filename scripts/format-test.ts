import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { collect } from '../src/main/workspace/project'
import { analyzeImage } from '../src/main/workspace/analyze'
import { imageMime, outFormatOf } from '../src/shared/imageFormats'

let fails = 0
function check(cond: unknown, msg: string): void {
  if (!cond) fails++
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`)
}

async function main(): Promise<void> {
  const dir = mkdtempSync(join(tmpdir(), 'gas-fmt-'))
  const base = sharp({ create: { width: 120, height: 60, channels: 4, background: { r: 30, g: 200, b: 90, alpha: 0.6 } } })
  const files: Array<[string, keyof sharp.FormatEnum]> = [
    ['a.png', 'png'],
    ['b.jpg', 'jpeg'],
    ['c.jpeg', 'jpeg'],
    ['d.webp', 'webp'],
    ['e.avif', 'avif'],
    ['f.tif', 'tiff'],
    ['g.tiff', 'tiff']
  ]
  for (const [name, fmt] of files) await base.clone().toFormat(fmt).toFile(join(dir, name))
  writeFileSync(join(dir, 'note.txt'), 'x')
  const r = await collect([dir])
  const got = r.folders[0].files.map((p) => p.split(/[\\/]/).pop())
  check(got.length === files.length, `collect nhận ${got.length}/${files.length} ảnh: ${got.join(', ')}`)
  check(r.skipped.length === 1 && r.skipped[0].name.endsWith('note.txt'), `bỏ qua note.txt (${r.skipped.map((s) => s.name).join(', ')})`)
  for (const p of r.folders[0].files) {
    const name = p.split(/[\\/]/).pop()
    try {
      const a = await analyzeImage(p)
      check(a.w === 120 && a.h === 60, `analyze ${name} ${a.w}×${a.h}`)
    } catch (e) {
      check(false, `analyze ${name}: ${(e as Error).message}`)
    }
  }
  check(imageMime('x/y.JPG') === 'image/jpeg' && imageMime('a.txt') === null, 'imageMime')
  check(outFormatOf('ui/btn.jpeg') === 'jpeg' && outFormatOf('a.TIF') === 'tiff' && outFormatOf('a.png') === 'png', 'outFormatOf')
  console.log(fails ? `${fails} FAIL` : 'ALL PASS')
  process.exitCode = fails ? 1 : 0
}

void main()
