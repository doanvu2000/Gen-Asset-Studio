import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'build')

const src = join(root, 'spike', 'logo', 'out', '1-chibi-flat.png')
const master = join(outDir, 'logo-master.png')
const R = 330

async function makeMaster() {
  const meta = await sharp(src).metadata()
  const n = meta.width
  const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${n}" height="${n}"><rect x="1" y="1" width="${n - 2}" height="${n - 2}" rx="${R}" fill="#fff"/></svg>`)
  await sharp(src).ensureAlpha().composite([{ input: mask, blend: 'dest-in' }]).png({ compressionLevel: 9 }).toFile(master)
}

const SIZES = [16, 24, 32, 48, 64, 128, 256]

async function png(size) {
  return sharp(master).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer()
}

function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const dir = Buffer.alloc(16 * images.length)
  let offset = 6 + dir.length
  images.forEach(({ size, data }, i) => {
    const o = i * 16
    dir.writeUInt8(size >= 256 ? 0 : size, o)
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1)
    dir.writeUInt8(0, o + 2)
    dir.writeUInt8(0, o + 3)
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(data.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += data.length
  })
  return Buffer.concat([header, dir, ...images.map((i) => i.data)])
}

await mkdir(outDir, { recursive: true })
if (existsSync(src)) await makeMaster()
await writeFile(join(root, 'src', 'renderer', 'src', 'assets', 'logo.png'), await png(256))
await writeFile(join(outDir, 'icon.png'), await png(512))
const images = []
for (const size of SIZES) images.push({ size, data: await png(size) })
await writeFile(join(outDir, 'icon.ico'), ico(images))
console.log(`icon.png 512 + icon.ico ${SIZES.join('/')} -> ${outDir}`)
