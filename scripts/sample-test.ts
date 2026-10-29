import { existsSync, promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { createSampleProject, readSampleManifest, resolveSampleDir } from '../src/main/sample'
import { absOf, readProject, sanitizeGroups, thumbPath } from '../src/main/workspace/project'

const repo = resolve(__dirname, '..')
const base = process.env['GAS_SAMPLE_TEST_DIR'] || 'C:\\Users\\dauph\\AppData\\Local\\Temp\\gas-sample-test'
let fails = 0

function check(cond: unknown, msg: string): void {
  if (cond) console.log(`ok   ${msg}`)
  else {
    fails++
    console.log(`FAIL ${msg}`)
  }
}

async function main(): Promise<void> {
  await fs.rm(base, { recursive: true, force: true })
  await fs.mkdir(base, { recursive: true })
  const sampleDir = resolveSampleDir(join(repo, 'resources', 'sample-project'))
  check(sampleDir, 'sample dir resolves')
  const manifest = await readSampleManifest(sampleDir as string)
  check(manifest.assets.length >= 12 && manifest.assets.length <= 16, `manifest has ${manifest.assets.length} assets`)

  const r1 = await createSampleProject(base, 'vi', { sampleDir: sampleDir as string, log: (m) => console.log(`     ${m}`) })
  check(r1.name === 'Project mẫu', `vi name ${r1.name}`)
  check(r1.added === manifest.assets.length, `added ${r1.added}`)
  check(r1.templateFound, 'candy-pop template found')

  const data = await readProject(r1.dir)
  check(data.version === 1 && data.name === r1.name, 'project.json readable by readProject')
  check(data.roots.length === 1 && resolve(data.roots[0]) === resolve(join(r1.dir, 'source')), `single root ${data.roots[0]}`)
  check(data.inputs.length === manifest.assets.length, `inputs ${data.inputs.length}`)
  check(data.inputs.every((i) => existsSync(absOf(data, i))), 'every input file exists')
  check(data.inputs.every((i) => i.hash && i.w > 0 && i.h > 0 && i.alpha), 'inputs analyzed with alpha')
  check(data.inputs.every((i) => existsSync(thumbPath(r1.dir, i.hash))), 'thumbs generated')
  const rels = new Set(data.inputs.map((i) => i.rel))
  check(manifest.assets.every((a) => rels.has(a.path)), 'nested rel paths preserved')
  for (const a of manifest.assets.filter((x) => x.type)) {
    const i = data.inputs.find((x) => x.rel === a.path)
    check(i?.type === a.type, `${a.path} type ${i?.type}`)
  }
  const groups = sanitizeGroups(data.groups, new Set(data.inputs.map((i) => i.id)))
  check(groups.length === 1, 'one group after sanitize')
  const g = groups[0]
  check(g && g.templateId === 'candy-pop' && g.promptEn.length > 50 && (g.palette?.length ?? 0) > 0, 'group pre-filled from candy-pop')
  check(g && !g.lockImage && !g.lockedAt, 'group not locked')
  check(g && g.assetIds.length === data.inputs.length, 'group owns every asset')
  check(JSON.stringify(data.groups) === JSON.stringify(groups), 'stored groups already sanitized')

  const r2 = await createSampleProject(base, 'vi', { sampleDir: sampleDir as string })
  check(r2.name === 'Project mẫu 2', `unique name ${r2.name}`)
  const r3 = await createSampleProject(base, 'en', { sampleDir: sampleDir as string })
  check(r3.name === 'Sample project', `en name ${r3.name}`)
  const g3 = sanitizeGroups((await readProject(r3.dir)).groups, new Set((await readProject(r3.dir)).inputs.map((i) => i.id)))[0]
  check(g3?.name === 'Candy Pop', `en group name ${g3?.name}`)

  console.log(fails ? `\n${fails} check(s) failed` : '\nall checks passed')
  process.exit(fails ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
