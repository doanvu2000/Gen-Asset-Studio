import { promises as fs, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import type { Page } from 'playwright'
import { build, gotoWorkspace, launch, repo, shot, shotsDir, sleep, store, until, type Session } from './helpers'
import { assetSegments } from '../../src/main/workspace/project'
import type { ProjectView } from '../../src/shared/workspace'
import type { SpineProjectView } from '../../src/shared/spine'
import type { SpriteProjectView } from '../../src/shared/sprite'

type Status = 'PASS' | 'FAIL' | 'SKIP'
interface Result {
  name: string
  status: Status
  note: string
  shot: string
}

const results: Result[] = []
const ctx: { sampleRel: string; sampleName: string; approvedId: string } = { sampleRel: '', sampleName: '', approvedId: '' }

function ok(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg)
}

class Skip extends Error {}

async function scenario(s: Session, name: string, fn: (page: Page) => Promise<string | void>): Promise<void> {
  const before = s.errors.length
  let status: Status = 'PASS'
  let note = ''
  try {
    note = (await fn(s.page)) ?? ''
  } catch (e) {
    status = e instanceof Skip ? 'SKIP' : 'FAIL'
    note = (e as Error).message
  }
  const fresh = s.errors.slice(before)
  if (fresh.length && status === 'PASS') {
    status = 'FAIL'
    note = `console errors: ${fresh.slice(0, 3).join(' | ')}`
  } else if (fresh.length) note += ` | console errors: ${fresh.slice(0, 3).join(' | ')}`
  const file = await shot(s.page, name).catch(() => '')
  results.push({ name, status, note, shot: file })
  console.log(`${status}  ${name}  ${note}`)
}

const pageText = (page: Page): Promise<string> => page.evaluate(() => document.body.innerText)

async function openProject(page: Page, rel: string): Promise<void> {
  await store(page, 'workspace', `return m.useWs.getState().openProject(${JSON.stringify(rel)})`)
  await page.waitForSelector('.steps', { timeout: 15000 })
}

async function clickTab(page: Page, label: string): Promise<void> {
  await page.getByRole('tab', { name: new RegExp(label) }).first().click()
}

async function project(page: Page, rel: string): Promise<ProjectView> {
  return (await page.evaluate((r) => window.gas.project.open(r), rel)) as ProjectView
}

async function seedVersions(view: ProjectView, ids: string[], versions = 1): Promise<void> {
  for (const id of ids) {
    const input = view.inputs.find((i) => i.id === id)
    ok(input, `input ${id}`)
    const dir = join(view.dir, 'versions', ...assetSegments(input.outRel))
    await fs.mkdir(dir, { recursive: true })
    for (let v = 1; v <= versions; v++) {
      await sharp(input.abs).modulate({ hue: v * 40 }).png().toFile(join(dir, `v${v}.png`))
      await fs.writeFile(join(dir, `v${v}.json`), JSON.stringify({ createdAt: new Date().toISOString() }))
    }
  }
}

async function main(): Promise<void> {
  if (!process.env['E2E_SKIP_BUILD']) build()
  ok(existsSync(join(repo, 'out/main/index.js')), 'out/main/index.js missing')
  const s = await launch('main')
  try {
    await scenario(s, '1-workspace-sample', async (page) => {
      await gotoWorkspace(page)
      await page.getByRole('button', { name: /Tạo project mẫu/ }).first().click()
      const snap = await until(async () => {
        const w = await page.evaluate(() => window.gas.workspace.get())
        return w.projects.length ? w : null
      }, 'sample project in snapshot', 30000)
      const p = snap.projects[0]
      ctx.sampleRel = p.rel
      ctx.sampleName = p.name
      await until(async () => (await pageText(page)).includes(p.name), 'project card text')
      return `project "${p.name}"`
    })

    await scenario(s, '2a-reskin-review', async (page) => {
      ok(ctx.sampleRel, 'needs scenario 1')
      let view = await project(page, ctx.sampleRel)
      await seedVersions(view, view.inputs.slice(0, 3).map((i) => i.id))
      await openProject(page, ctx.sampleRel)
      await store(page, 'workspace', `return m.useWs.getState().reloadProject()`)
      const steps = await page.getByRole('tab').count()
      ok(steps >= 5, `expected 5 steps, got ${steps}`)
      await clickTab(page, 'Duyệt')
      await page.waitForSelector('.rv-grid .rv-tile, .rv-grid > *', { timeout: 10000 })
      await sleep(500)
      await shot(page, '2a-review-grid')
      await page.locator('.rv-grid > *').first().click()
      await sleep(600)
      await page.keyboard.press('?')
      await page.waitForSelector('.shortcuts', { timeout: 5000 })
      await shot(page, '2a-shortcuts-open')
      await page.keyboard.press('Escape')
      await page.waitForSelector('.shortcuts', { state: 'detached', timeout: 5000 })
      view = await project(page, ctx.sampleRel)
      const before = view.inputs.filter((i) => i.decision === 'approved').length
      await page.keyboard.press('a')
      await until(async () => (await project(page, ctx.sampleRel)).inputs.filter((i) => i.decision === 'approved').length === before + 1, 'approve with A')
      view = await project(page, ctx.sampleRel)
      ctx.approvedId = view.inputs.find((i) => i.decision === 'approved')?.id ?? ''
      await page.keyboard.press('Escape')
      return 'shortcuts dialog opens/closes, A approves'
    })

    await scenario(s, '2b-reskin-recolor', async (page) => {
      ok(ctx.sampleRel, 'needs scenario 1')
      await page.waitForSelector('.rv-grid > *')
      const view = await project(page, ctx.sampleRel)
      const withV = view.inputs.filter((i) => i.versions.length > 0)
      const target = withV.find((i) => i.decision !== 'approved')
      ok(target, 'no asset with versions to recolor')
      await page.locator('.rv-grid > *').nth(withV.indexOf(target)).click()
      await sleep(600)
      await page.getByRole('button', { name: /^Đổi màu/ }).first().click()
      await page.waitForSelector('.rc', { timeout: 5000 })
      await page.locator('.rc input[type=range]').first().fill('90')
      await shot(page, '2b-recolor-panel')
      await page.getByRole('button', { name: 'Lưu thành phiên bản mới' }).click()
      await until(async () => (await project(page, ctx.sampleRel)).inputs.find((i) => i.id === target.id)?.versions.length === 2, 'new version after recolor')
      return `${target.name}: v1 -> v2`
    })

    const spriteSamples = join(repo, 'resources/sprite-samples')
    const out = join(s.root, 'out')
    let spriteRel = ''
    await scenario(s, '3a-sprite-import-ui', async (page) => {
      await page.evaluate(() => window.gas.workspace.createProject('', 'Sprite E2E', 'sprite'))
      const snap = await page.evaluate(() => window.gas.workspace.get())
      spriteRel = snap.projects.find((p) => p.name === 'Sprite E2E')?.rel ?? ''
      ok(spriteRel, 'sprite project not created')
      const add = (await page.evaluate(([r, a, b]) => window.gas.sprite.addPaths(r, [a, b]), [spriteRel, join(spriteSamples, 'hero_4dir_tp.png'), join(spriteSamples, 'hero_4dir_tp.json')])) as { added: number; view: SpriteProjectView | null }
      ok(add.added >= 1 && add.view?.sheets.length, `import failed: ${JSON.stringify(add).slice(0, 200)}`)
      await openProject(page, spriteRel)
      await clickTab(page, 'Nhập')
      const toggle = page.getByRole('button', { name: /Chỉnh lưới & hướng|Thu gọn/ }).first()
      await toggle.waitFor()
      const was = await toggle.getAttribute('aria-expanded')
      await toggle.click()
      await until(async () => (await toggle.getAttribute('aria-expanded')) !== was, 'grid editor toggles')
      if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click()
      const adv = page.locator('.adv-head').first()
      await adv.waitFor({ timeout: 5000 })
      const a0 = await adv.getAttribute('aria-expanded')
      await adv.click()
      await until(async () => (await adv.getAttribute('aria-expanded')) !== a0, 'Advanced toggles')
      await adv.click()
      await until(async () => (await adv.getAttribute('aria-expanded')) === a0, 'Advanced toggles back')
      await shot(page, '3a-sprite-grid')
      return `format ${add.view?.sheets[0].format}`
    })

    await scenario(s, '3b-sprite-export', async (page) => {
      ok(spriteRel, 'needs 3a')
      await page.evaluate((r) => window.gas.sprite.setSettings(r, { dirSet: 4, rowPreset: 'flame' }), spriteRel)
      const created = (await page.evaluate(
        ([r, ch]) => window.gas.spriteGen.createSheet(r, { name: 'Hero E2E', character: ch, description: 'e2e', anims: [{ name: 'idle', frames: 4 }, { name: 'walk', frames: 6 }], cell: 128 }),
        [spriteRel, join(spriteSamples, 'hero_idle_walk.png')]
      )) as { view: SpriteProjectView | null; sheetId: string | null; error: string | null }
      ok(created.view && created.sheetId, `createSheet: ${created.error}`)
      const v = created.view
      const patch: Record<string, { decision: 'approved' }> = {}
      for (const st of v.strips.filter((x) => x.sheetId === created.sheetId && !x.mirrorOf)) {
        const dir = join(v.dir, 'versions', ...assetSegments(st.assetRel))
        await fs.mkdir(dir, { recursive: true })
        await sharp({ create: { width: st.frameCount * 128, height: 128, channels: 4, background: { r: 200, g: 60, b: 60, alpha: 1 } } }).png().toFile(join(dir, 'v1.png'))
        patch[st.key] = { decision: 'approved' }
      }
      await page.evaluate(([r, p]) => window.gas.spriteGen.review(r, p as never), [spriteRel, patch] as const)
      await page.evaluate((r) => window.gas.sprite.setSettings(r, { exportFormats: { godot: true, unity: true, cocos: true } }), spriteRel)
      const res = (await page.evaluate(([r, o]) => window.gas.spriteGen.exportRun(r, o), [spriteRel, join(out, 'sprite')])) as { ok: boolean; error: string | null }
      ok(res.ok, `exportRun: ${res.error}`)
      const files = readdirSync(join(out, 'sprite'))
      for (const ext of ['.json', '.png', '.tres', '.png.meta', '.plist']) ok(files.some((f) => f.endsWith(ext)), `missing ${ext} in ${files.join(',')}`)
      const anims = (await page.evaluate(([r, id, o]) => window.gas.spriteGen.exportAnims(r, { sheetId: id, format: 'gif', scale: 1, source: 'new', outDir: o }), [spriteRel, created.sheetId, join(out, 'anims')])) as { ok: boolean; files: Array<{ file: string }> }
      ok(anims.ok && anims.files.length > 0 && anims.files.every((f) => existsSync(f.file)), `exportAnims: ${JSON.stringify(anims).slice(0, 200)}`)
      await openProject(page, spriteRel)
      await clickTab(page, 'Xuất')
      await sleep(800)
      return `files: ${files.join(', ')}; ${anims.files.length} gif`
    })

    let spineRel = ''
    await scenario(s, '4-spine-import-skin-export', async (page) => {
      await page.evaluate(() => window.gas.workspace.createProject('', 'Spine E2E', 'spine'))
      const snap = await page.evaluate(() => window.gas.workspace.get())
      spineRel = snap.projects.find((p) => p.name === 'Spine E2E')?.rel ?? ''
      ok(spineRel, 'spine project not created')
      const dir = join(repo, 'resources/spine-samples/hero')
      const imp = (await page.evaluate(([r, d]) => window.gas.spine.importPaths(r, [`${d}/hero.json`, `${d}/hero.atlas`, `${d}/hero.png`]), [spineRel, dir])) as { view: SpineProjectView | null; error: string | null }
      ok(imp.view?.loaded, `import: ${imp.error}`)
      await openProject(page, spineRel)
      await clickTab(page, 'Nhập')
      await page.waitForSelector('canvas', { timeout: 15000 })
      await sleep(1500)
      ok(!(await pageText(page)).includes('Không hiển thị được skeleton'), 'spine preview error shown')
      await shot(page, '4-spine-preview')
      const added = (await page.evaluate((r) => window.gas.spine.addVariant(r, 'Red'), spineRel)) as { view: SpineProjectView | null; error: string | null }
      ok(added.view && !added.error, `addVariant: ${added.error}`)
      const v = added.view
      const patch: Record<string, { decision: 'approved' }> = {}
      for (const r of v.regions) {
        const d = join(v.dir, 'versions', ...assetSegments(r.assetRel))
        await fs.mkdir(d, { recursive: true })
        await sharp({ create: { width: r.w, height: r.h, channels: 4, background: { r: 220, g: 40, b: 40, alpha: 1 } } }).png().toFile(join(d, 'v1.png'))
        patch[r.key] = { decision: 'approved' }
      }
      await page.evaluate(([r, p]) => window.gas.spine.review(r, p as never), [spineRel, patch] as const)
      const res = (await page.evaluate(([r, o, id]) => window.gas.spine.exportRun(r, o, [id]), [spineRel, join(out, 'spine'), v.variant])) as { ok: boolean; error: string | null }
      ok(res.ok, `exportRun: ${res.error}`)
      const files = readdirSync(join(out, 'spine'))
      ok(files.some((f) => f.endsWith('-skins.atlas')), `no -skins.atlas in ${files.join(',')}`)
      return `files: ${files.join(', ')}`
    })

    await scenario(s, '5-todo', async (page) => {
      ok(ctx.sampleRel, 'needs scenario 1')
      const items = (await page.evaluate(() => window.gas.workspace.todo())) as Array<{ projectRel: string; area: string; count: number }>
      const rv = items.find((i) => i.projectRel === ctx.sampleRel && i.area === 'review')
      ok(rv && rv.count >= 1, `no review todo for sample: ${JSON.stringify(items.map((i) => [i.projectRel, i.area, i.count]))}`)
      await store(page, 'app', `m.useApp.getState().navigate('todo')`)
      await page.waitForSelector('.todo-row', { timeout: 10000 })
      const row = page.locator('.todo-row', { hasText: 'chờ duyệt' }).first()
      const label = (await row.innerText()).replace(/\s+/g, ' ')
      await shot(page, '5-todo-list')
      await row.click()
      await page.waitForSelector('.steps', { timeout: 10000 })
      await until(async () => (await page.locator('.stp.cur').innerText()).includes('Duyệt'), 'jumped to review step')
      return `row "${label}" -> review step (${rv.count} pending)`
    })

    await scenario(s, '6-settings', async (page) => {
      await store(page, 'app', `m.useApp.getState().openSettings('stats')`)
      await page.waitForSelector('[role=dialog]')
      await page.getByRole('tab', { name: 'Thống kê' }).click()
      await page.waitForSelector('text=Chưa có lượt gen nào', { timeout: 10000 })
      await shot(page, '6-settings-stats')
      await page.getByRole('tab', { name: 'Gen & QA' }).click()
      await page.locator('[role=tabpanel] .adv-head').click()
      const auto = page.getByRole('radiogroup', { name: 'Tự gen lại khi QA lỗi nặng' }).locator('[aria-checked=true]')
      ok((await auto.innerText()) === 'Tắt', `autoRegen default should be off, got ${await auto.innerText()}`)
      await shot(page, '6-settings-gen')
      await page.getByRole('tab', { name: 'Chung' }).click()
      const notify = page.getByRole('radiogroup', { name: 'Báo khi gen xong' }).locator('[aria-checked=true]')
      ok((await notify.innerText()) === 'Bật', `notify default should be on, got ${await notify.innerText()}`)
      return 'stats empty; autoRegen off; notifyDone on (notifyDone lives in Chung tab)'
    })
  } finally {
    await s.close()
  }
  console.log(`
screenshots: ${shotsDir}`)
  for (const r of results) console.log(`${r.status}  ${r.name}  ${r.shot}`)
  if (results.some((r) => r.status === "FAIL")) process.exitCode = 1
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
