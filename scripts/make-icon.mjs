import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'build')

const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="1024" height="1024">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#5AC8FA"/>
      <stop offset="1" stop-color="#007AFF"/>
    </linearGradient>
  </defs>
  <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#g)"/>
  <rect x="14" y="20" width="26" height="26" rx="7" fill="#fff" opacity=".35"/>
  <rect x="22" y="14" width="28" height="28" rx="7" fill="#fff"/>
  <path d="M36 20l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#007AFF"/>
</svg>`

const SIZES = [16, 24, 32, 48, 64, 128, 256]

async function png(size) {
  return sharp(Buffer.from(svg)).resize(size, size, { kernel: 'lanczos3' }).png({ compressionLevel: 9 }).toBuffer()
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
await writeFile(join(outDir, 'icon.png'), await png(512))
const images = []
for (const size of SIZES) images.push({ size, data: await png(size) })
await writeFile(join(outDir, 'icon.ico'), ico(images))
console.log(`icon.png 512 + icon.ico ${SIZES.join('/')} -> ${outDir}`)
