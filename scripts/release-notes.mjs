import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const fileArg = args.indexOf('--file')
const file = fileArg >= 0 ? args[fileArg + 1] : join(root, 'CHANGELOG.md')
const positional = args.filter((a, i) => !a.startsWith('--') && (fileArg < 0 || i !== fileArg + 1))
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const wanted = (positional[0] ?? pkg.version).replace(/^v/, '')
const unreleased = /^(unreleased|chưa phát hành|chua-phat-hanh)$/i.test(wanted)

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const lines = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n')
const headingRe = unreleased
  ? /^##\s+Chưa phát hành\b/i
  : new RegExp(`^##\\s+v?${escapeRe(wanted)}(?![0-9A-Za-z.-])`)

const start = lines.findIndex((l) => headingRe.test(l))
if (start < 0) {
  process.stderr.write(`Không thấy mục "${wanted}" trong ${file}\n`)
  process.exit(1)
}
let end = lines.length
for (let i = start + 1; i < lines.length; i++) {
  if (/^##\s/.test(lines[i])) {
    end = i
    break
  }
}
const body = lines.slice(start + 1, end).join('\n').trim()
if (!body) {
  process.stderr.write(`Mục "${wanted}" trống\n`)
  process.exit(1)
}
process.stdout.write(`${body}\n`)
