import { tmpdir } from 'node:os'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { codexCurrentDir, codexHome } from '../src/main/paths'
import { CodexService } from '../src/main/codex/service'
import type { CodexInstaller } from '../src/main/codex/installer'
import { StyleService } from '../src/main/style'
import type { StyleCodex } from '../src/main/style/common'
import type { SuggestProgress } from '../src/shared/style'

const root = resolve(__dirname, '..')
const project = process.env['GAS_STYLE_TEST_DIR'] || join(tmpdir(), 'gas-style-test')
const skipPolish = process.argv.includes('--skip-polish')
const skipSuggest = process.argv.includes('--skip-suggest')
const templatesOnly = process.argv.includes('--templates-only')

const log = (m: string): void => console.log(`${new Date().toISOString().slice(11, 23)} ${m}`)

function makeStyle(codex: StyleCodex): StyleService {
  return new StyleService({
    codex,
    log: (m) => log(`[style] ${m}`),
    builtinTemplatesDir: join(root, 'resources', 'style-templates'),
    modelsFile: join(project, 'style-models.json'),
    userTemplatesDir: join(project, 'user-templates'),
    workDir: project,
    suggestConcurrency: 2,
    suggestRetries: 0
  })
}

async function checkTemplates(style: StyleService): Promise<void> {
  const tpls = await style.listTemplates()
  log(`templates: ${tpls.map((t) => `${t.id}${t.previewPath ? '' : '(no preview)'}`).join(', ')}`)
  if (tpls.length < 8) throw new Error('expected 8 built-in templates')
  const byCat = (cat: string): string[] => tpls.filter((t) => t.builtin && t.category === cat).map((t) => t.id)
  log(`categories: ui=${byCat('ui').join(',')} character=${byCat('character').join(',')}`)
  if (byCat('ui').length < 4 || byCat('character').length < 4) throw new Error('expected 4 ui and 4 character built-in templates')
  const missingPreview = tpls.filter((t) => t.builtin && (!t.previewPath || !t.previewSmPath)).map((t) => t.id)
  if (missingPreview.length) throw new Error(`built-in templates without preview: ${missingPreview.join(', ')}`)

  const legacyDir = join(project, 'user-templates', 'user-legacy')
  mkdirSync(legacyDir, { recursive: true })
  writeFileSync(join(legacyDir, 'template.json'), JSON.stringify({ id: 'user-legacy', name: 'Legacy', promptEn: 'legacy prompt', palette: [] }))
  const legacy = (await style.listTemplates()).find((t) => t.id === 'user-legacy')
  if (legacy?.category !== 'ui') throw new Error(`legacy user template category=${legacy?.category}`)
  rmSync(legacyDir, { recursive: true, force: true })
  const charSaved = await style.saveTemplate({
    group: { id: 'gc', name: 'Char', promptEn: 'pixel hero', notes: '', templateId: 'pixel-art', refImages: [], assetIds: [], nineSliceOverrides: {} },
    projectPath: project,
    name: { vi: 'Nhân vật thử', en: 'Char Test' }
  })
  const uiSaved = await style.saveTemplate({
    group: { id: 'gu', name: 'Ui', promptEn: 'ui prompt', notes: '', refImages: [], assetIds: [], nineSliceOverrides: {} },
    projectPath: project,
    name: { vi: 'UI thử', en: 'UI Test' }
  })
  log(`saved template categories: from pixel-art=${charSaved.category} plain=${uiSaved.category}`)
  await style.deleteTemplate(charSaved.id)
  await style.deleteTemplate(uiSaved.id)
  if (charSaved.category !== 'character' || uiSaved.category !== 'ui') throw new Error('saved template category not preserved')
}

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64')

function must(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`library: ${msg}`)
}

async function checkLibrary(style: StyleService): Promise<void> {
  const proj = join(project, 'lib-proj')
  rmSync(proj, { recursive: true, force: true })
  mkdirSync(join(proj, 'styles', 'sprite', 'refs'), { recursive: true })
  writeFileSync(join(proj, 'styles', 'sprite', 'refs', 'a.png'), PNG)
  writeFileSync(join(proj, 'styles', 'sprite', 'refs', 'b.png'), PNG)
  writeFileSync(join(proj, 'styles', 'sprite', 'refs', 'fake.png'), 'not an image')
  const saved = await style.saveStyle({
    projectPath: proj,
    name: 'Team Hero',
    category: 'character',
    promptEn: 'chunky hero',
    notes: 'keep outlines thick',
    refImages: ['styles/sprite/refs/a.png', 'styles/sprite/refs/b.png', 'styles/sprite/refs/fake.png', '../outside.png', 'styles/sprite/refs/missing.png'],
    sourceName: 'Hero Sprite'
  })
  must(saved.refPaths.length === 2 && saved.previewPath && saved.notes === 'keep outlines thick' && saved.source?.project === 'Hero Sprite', 'saved fields')
  const dup = await style.saveStyle({ projectPath: proj, name: 'Team Hero', category: 'ui', promptEn: 'dup', refImages: [], sourceName: 'x' })
  must(dup.id !== saved.id, 'duplicate name gets a distinct id')

  rmSync(join(proj, 'styles', 'sprite', 'refs', 'a.png'))
  const spriteStyle = { promptEn: '', templateId: null as string | null, refImages: [] as string[], notes: '' }
  const listed = (await style.listTemplates()).find((t) => t.id === saved.id)
  must(listed && !listed.builtin && listed.refPaths.length === 2, 'listed with refs after project ref deleted')
  const spineProj = join(project, 'lib-spine')
  mkdirSync(spineProj, { recursive: true })
  const applied = await style.applyTemplateRefs({ templateId: saved.id, projectPath: spineProj, refDir: 'styles/spine/refs', max: 8 })
  Object.assign(spriteStyle, { promptEn: listed!.promptEn, templateId: listed!.id, refImages: applied, notes: listed!.notes })
  must(applied.length === 2 && applied.every((r) => existsSync(join(spineProj, r))) && spriteStyle.notes === 'keep outlines thick', 'applied refs copied into project')
  const again = await style.applyTemplateRefs({ templateId: saved.id, projectPath: spineProj, refDir: 'styles/spine/refs', max: 1 })
  must(again.length === 1 && !applied.includes(again[0]), 'second apply does not overwrite')
  let escaped = false
  await style.applyTemplateRefs({ templateId: saved.id, projectPath: spineProj, refDir: '../escape', max: 8 }).catch(() => (escaped = true))
  must(escaped, 'refDir traversal rejected')

  const renamed = await style.renameTemplate(saved.id, 'Renamed Hero')
  must(renamed?.name.en === 'Renamed Hero', 'rename')

  const file = join(project, `hero.gasstyle`)
  await style.templates.exportPack(saved.id, file)
  const imported = await style.templates.importPack(file)
  must(imported.id !== saved.id && imported.name.en === 'Renamed Hero' && imported.refPaths.length === 2 && imported.notes === saved.notes && imported.category === 'character', 'round trip')

  const pack = JSON.parse(readFileSync(file, 'utf8')) as { refs: Array<{ name?: string; b64: string }>; version: number; template: { promptEn: string } }
  pack.refs[0].name = '../../../evil.png'
  pack.refs.push({ b64: Buffer.from('MZ-not-image').toString('base64') })
  const evil = join(project, 'evil.gasstyle')
  writeFileSync(evil, JSON.stringify(pack))
  const sane = await style.templates.importPack(evil)
  must(sane.refPaths.length === 2 && sane.refPaths.every((p) => /ref-\d\.png$/.test(p)), 'traversal names and non-image payload ignored')
  must(!existsSync(join(project, 'evil.png')) && !existsSync(join(project, '..', 'evil.png')), 'nothing written outside')
  must(readdirSync(join(project, 'user-templates', sane.id)).sort().join() === 'preview-sm.png,preview.png,refs,template.json', 'template dir contents')

  const bad = join(project, 'bad.gasstyle')
  writeFileSync(bad, '{not json')
  await style.templates.importPack(bad).then(() => must(false, 'corrupted file accepted'), (e: Error) => must(/corrupted/.test(e.message), 'corrupted message'))
  writeFileSync(bad, JSON.stringify({ ...pack, version: 99 }))
  await style.templates.importPack(bad).then(() => must(false, 'newer version accepted'), (e: Error) => must(/newer/.test(e.message), 'version message'))
  writeFileSync(bad, JSON.stringify({ format: 'other' }))
  await style.templates.importPack(bad).then(() => must(false, 'foreign file accepted'), () => undefined)

  must((await style.deleteTemplate(saved.id)) && (await style.deleteTemplate(dup.id)) && (await style.deleteTemplate(imported.id)) && (await style.deleteTemplate(sane.id)), 'delete')
  let badId = false
  await style.deleteTemplate('..').catch(() => (badId = true))
  must(badId, 'delete rejects traversal id')
  for (const f of [file, evil, bad]) rmSync(f, { force: true })
  log('library: save / apply / rename / export-import / traversal ok')
}

async function main(): Promise<void> {
  mkdirSync(project, { recursive: true })
  const exe = join(codexCurrentDir, 'bin', 'codex.exe')
  if (templatesOnly || !existsSync(exe)) {
    if (!templatesOnly) log(`no codex.exe at ${exe}, templates only`)
    const offline = makeStyle({} as StyleCodex)
    await checkTemplates(offline)
    await checkLibrary(offline)
    return
  }
  log(`CODEX_HOME=${codexHome}`)
  const installer = { exePath: () => exe } as unknown as CodexInstaller
  const codex = new CodexService(installer, (m) => log(`[codex] ${m}`))
  await codex.ensureStarted()
  const acc = await codex.readAccount()
  if (!acc.loggedIn) throw new Error('Codex is not logged in for this CODEX_HOME')
  log(`account ${acc.email ?? '?'} plan=${acc.planType ?? '?'}`)

  const style = makeStyle(codex)
  await checkTemplates(style)
  await checkLibrary(style)

  try {
    if (!skipPolish) {
      for (const prompt of ['nút kẹo ngọt màu hồng tím bóng bẩy, viền đậm, vui nhộn', 'make it like wooden pirate style, gold coins, kinda old but colorful']) {
        const t0 = Date.now()
        const r = await style.polish({ prompt, context: 'group' })
        log(`polish ${Date.now() - t0} ms\n  IN : ${prompt}\n  OUT: ${r.promptEn}\n  CHANGES: ${r.changes.join(' | ')}`)
      }
    }
    if (!skipSuggest) {
      rmSync(join(project, 'styles'), { recursive: true, force: true })
      style.suggest.on('progress', (p: SuggestProgress) => {
        if (p.type === 'phase') log(`[progress] phase ${p.phase}${p.error ? ` error=${p.error}` : ''}`)
        if (p.type === 'directions') log(`[progress] directions: ${p.suggestions.map((s) => s.name).join(' / ')}`)
        if (p.type === 'direction') log(`[progress] ${p.suggestion.id} ${p.suggestion.status}${p.suggestion.error ? ` ${p.suggestion.error}` : ''}`)
      })
      const t0 = Date.now()
      let run = await style.runSuggest({
        projectPath: project,
        samples: [
          { path: join(root, 'spike/m0/in/btn_green.png'), kind: 'button', name: 'btn_green' },
          { path: join(root, 'resources/style-templates/jelly-cartoon/preview-sm.png'), kind: 'panel', name: 'ui sheet' }
        ],
        refImages: [join(root, 'spike/m0/in/style_ref.png')],
        prompt: 'game giải đố vui nhộn, màu rực rỡ',
        count: 2
      })
      const failed = run.suggestions.filter((s) => s.status === 'error')
      if (failed.length > 0) {
        log(`retrying 1 failed preview: ${failed[0].id} (${failed[0].error})`)
        run = await style.suggest.regen(project, run.runId, failed[0].id)
      }
      log(`suggest finished in ${Date.now() - t0} ms phase=${run.phase} dir=${run.dir}`)
      for (const s of run.suggestions) {
        log(`  ${s.id} [${s.status}] ${s.name} ${s.palette.join(',')}\n    vi: ${s.summary.vi}\n    en: ${s.summary.en}\n    prompt: ${s.promptEn}\n    preview: ${s.previewPath ?? s.error}`)
      }
      const ok = run.suggestions.find((s) => s.status === 'done')
      if (ok) {
        const group = await style.lock({
          projectPath: project,
          group: { id: 'g1', name: 'Test', promptEn: '', notes: '', refImages: [], assetIds: [], nineSliceOverrides: {} },
          source: { kind: 'suggestion', projectPath: project, runId: run.runId, suggestionId: ok.id }
        })
        log(`locked suggestion -> ${group.lockImage} exists=${existsSync(join(project, 'styles', 'g1', 'lock.png'))}`)
        const saved = await style.saveTemplate({ group, projectPath: project, name: { vi: 'Kiểu thử', en: 'Test Style' }, palette: ok.palette })
        log(`saved user template ${saved.id} preview=${saved.previewPath !== null} listed=${(await style.listTemplates()).some((t) => t.id === saved.id)}`)
        log(`deleted user template: ${await style.deleteTemplate(saved.id)}`)
        const g2 = await style.lock({
          projectPath: project,
          group: { id: 'g2', name: 'Tpl', promptEn: '', notes: '', refImages: [], assetIds: [], nineSliceOverrides: {} },
          source: { kind: 'template', templateId: 'candy-pop' }
        })
        log(`locked template -> ${g2.lockImage} templateId=${g2.templateId}`)
      }
    }
  } finally {
    await codex.stop()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
