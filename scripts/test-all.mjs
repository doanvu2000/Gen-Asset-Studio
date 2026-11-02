import { spawnSync } from 'node:child_process'

const SUITES = ['format', 'export', 'sample', 'pipeline', 'queue', 'style', 'sprite', 'sprite-gen', 'sprite-new', 'spine', 'workspace-card', 'todo', 'recolor', 'stats']
const only = process.argv.slice(2)
const rows = []
for (const name of only.length ? only : SUITES) {
  const t0 = Date.now()
  const r = spawnSync('npm', ['run', '-s', `test:${name}`], { shell: true, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  const out = `${r.stdout ?? ''}${r.stderr ?? ''}`.trim().split(/\r?\n/)
  const ok = r.status === 0
  rows.push({ name, ok, s: ((Date.now() - t0) / 1000).toFixed(1), last: out.filter((l) => l.trim()).slice(-1)[0]?.trim() ?? '' })
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name.padEnd(15)} ${rows.at(-1).s}s  ${rows.at(-1).last.slice(0, 100)}`)
  if (!ok) console.log(out.slice(-15).map((l) => `    ${l}`).join('\n'))
}
const failed = rows.filter((r) => !r.ok)
console.log(`\n${rows.length - failed.length}/${rows.length} suites passed${failed.length ? `, failed: ${failed.map((r) => r.name).join(', ')}` : ''}`)
process.exit(failed.length ? 1 : 0)
