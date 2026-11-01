import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { codexCurrentDir, codexHome } from '../src/main/paths'
import { CodexService } from '../src/main/codex/service'
import type { CodexInstaller } from '../src/main/codex/installer'
import { StyleService } from '../src/main/style'
import type { StyleCodex } from '../src/main/style/common'
import type { SuggestProgress } from '../src/shared/style'

const root = resolve(__dirname, '..')
const project = process.env['GAS_STYLE_TEST_DIR'] || 'C:\\Users\\dauph\\AppData\\Local\\Temp\\gas-style-test'
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

async function main(): Promise<void> {
  mkdirSync(project, { recursive: true })
  const exe = join(codexCurrentDir, 'bin', 'codex.exe')
  if (templatesOnly || !existsSync(exe)) {
    if (!templatesOnly) log(`no codex.exe at ${exe}, templates only`)
    await checkTemplates(makeStyle({} as StyleCodex))
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
