import { existsSync, promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import { REPORT_FILE, type ExportProgress } from '../src/shared/export'
import { longPath, planExport, reviewOf, runExport, exportRels, versionPath, type ExportSource } from '../src/main/export'
import { readProject, type ProjectFile } from '../src/main/workspace/project'

const repo = resolve(__dirname, '..')
const base = process.env['GAS_EXPORT_TEST_DIR'] || 'C:\\Users\\dauph\\AppData\\Local\\Temp\\gas-export-test'
const srcGame = join(base, 'src', 'game')
const srcExtra = join(base, 'src', 'extra')
const proj = join(base, 'proj')
const LONG = ['a_very_long_folder_name_for_long_path_testing_01', 'a_very_long_folder_name_for_long_path_testing_02', 'a_very_long_folder_name_for_long_path_testing_03', 'a_very_long_folder_name_for_long_path_testing_04']

const log = (m: string): void => console.log(`${new Date().toISOString().slice(11, 23)} ${m}`)
let fails = 0
function check(cond: unknown, msg: string): void {
  if (cond) log(`ok   ${msg}`)
  else {
    fails++
    log(`FAIL ${msg}`)
  }
}

interface Spec {
  id: string
  root: 0 | 1
  rel: string
  from: 'btn_green' | 'style_ref'
  group: boolean
  approved: boolean
  versions: number
  selected?: number
  type?: 'sprite'
  badSize?: boolean
}

const SPECS: Spec[] = [
  { id: 'i_btn', root: 0, rel: 'ui/buttons/btn_green.png', from: 'btn_green', group: true, approved: true, versions: 3, selected: 2 },
  { id: 'i_btn2', root: 0, rel: 'ui/buttons/btn_blue.png', from: 'btn_green', group: true, approved: true, versions: 1 },
  { id: 'i_pop', root: 0, rel: 'ui/popup/panel_main.png', from: 'style_ref', group: true, approved: true, versions: 2 },
  { id: 'i_root', root: 0, rel: 'logo.png', from: 'style_ref', group: true, approved: true, versions: 1 },
  { id: 'i_long', root: 1, rel: `${LONG.join('/')}/icon_long_name_asset.png`, from: 'btn_green', group: true, approved: true, versions: 1 },
  { id: 'i_unap', root: 0, rel: 'ui/buttons/btn_red.png', from: 'btn_green', group: true, approved: false, versions: 1 },
  { id: 'i_nog', root: 0, rel: 'ui/misc/loose.png', from: 'btn_green', group: false, approved: true, versions: 1 },
  { id: 'i_nov', root: 1, rel: 'fx/spark.png', from: 'style_ref', group: true, approved: true, versions: 0 },
  { id: 'i_bad', root: 1, rel: 'fx/bad_size.png', from: 'style_ref', group: true, approved: true, versions: 1, badSize: true },
  { id: 'i_spr', root: 0, rel: 'ui/sheet.png', from: 'style_ref', group: true, approved: true, versions: 1, type: 'sprite' }
]

const EXPECTED_OK = ['i_btn', 'i_btn2', 'i_pop', 'i_root', 'i_long']

async function writeFileLong(p: string, buf: Buffer): Promise<void> {
  await fs.mkdir(longPath(join(p, '..')), { recursive: true })
  await fs.writeFile(longPath(p), buf)
}

async function makeVersion(srcPng: string, w: number, h: number, n: number): Promise<Buffer> {
  return sharp(srcPng)
    .resize(Math.max(8, Math.round(w * 0.7)), Math.max(8, Math.round(h * 0.7)), { kernel: 'lanczos3' })
    .modulate({ hue: n * 70, saturation: 1.3 })
    .resize(w, h, { fit: 'fill', kernel: 'lanczos3' })
    .ensureAlpha()
    .png()
    .toBuffer()
}

async function setup(): Promise<void> {
  await fs.rm(longPath(base), { recursive: true, force: true })
  const inputs: Record<string, unknown>[] = []
  const review: Record<string, unknown> = {}
  for (const s of SPECS) {
    const from = join(repo, 'spike/m0/in', `${s.from}.png`)
    const meta = await sharp(from).metadata()
    const w = meta.width ?? 0
    const h = meta.height ?? 0
    const root = s.root === 0 ? srcGame : srcExtra
    const abs = join(root, ...s.rel.split('/'))
    const buf = await fs.readFile(from)
    await writeFileLong(abs, buf)
    inputs.push({ id: s.id, root: s.root, rel: s.rel, w, h, alpha: true, size: buf.length, mtime: 0, hash: '', type: s.type ?? 'normal', typeAuto: true, kind: 'button' })
    if (s.approved || s.selected) review[s.id] = { decision: s.approved ? 'approved' : null, selected: s.selected ?? null, updatedAt: Date.now() }
  }
  await fs.mkdir(proj, { recursive: true })
  const data = {
    version: 1,
    name: 'export-test',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    roots: [srcGame, srcExtra],
    inputs,
    review,
    groups: [{ id: 'g1', name: 'Candy', promptEn: '', notes: '', refImages: [], assetIds: SPECS.filter((s) => s.group).map((s) => s.id), nineSliceOverrides: {} }]
  }
  await fs.writeFile(join(proj, 'project.json'), JSON.stringify(data, null, 2), 'utf8')
  const loaded = await load()
  const rels = exportRels(loaded.data)
  for (const [i, s] of SPECS.entries()) {
    const rec = loaded.data.inputs.find((x) => x.id === s.id)
    if (!rec) throw new Error(`missing input ${s.id}`)
    const idx = loaded.data.inputs.indexOf(rec)
    for (let v = 1; v <= s.versions; v++) {
      const vw = s.badSize ? rec.w + 3 : rec.w
      const png = await makeVersion(join(repo, 'spike/m0/in', `${s.from}.png`), vw, rec.h, i + v)
      await writeFileLong(versionPath(proj, rels[idx], v), png)
    }
  }
}

async function load(): Promise<ExportSource> {
  const data: ProjectFile = await readProject(proj)
  return { rel: 'export-test', dir: proj, data }
}

async function pngInfo(p: string): Promise<{ w: number; h: number; alpha: boolean; buf: Buffer }> {
  const buf = await fs.readFile(longPath(p))
  const m = await sharp(buf).metadata()
  return { w: m.width ?? 0, h: m.height ?? 0, alpha: m.hasAlpha === true && m.channels === 4, buf }
}

async function main(): Promise<void> {
  log(`setup ${base}`)
  await setup()
  const src = await load()
  const opts = { scales: [1, 2] as (1 | 2)[] }

  const fb = reviewOf({ ...src.data, review: undefined }, { ...src.data.inputs[0], approved: true, selectedVersion: 3 } as typeof src.data.inputs[0])
  check(fb.approved && fb.selected === 3, 'fallback approved/selectedVersion trên input')
  const plan = await planExport(src, opts)
  check(plan.error === null, `plan không lỗi (${plan.error})`)
  check(plan.items.map((i) => i.id).sort().join(',') === [...EXPECTED_OK].sort().join(','), `plan xuất đúng 5 ảnh: ${plan.items.map((i) => i.rel).join(' | ')}`)
  const reasons = Object.fromEntries(plan.skipped.map((s) => [s.id, s.reason]))
  check(reasons.i_unap === 'notApproved', 'bỏ qua chưa duyệt')
  check(reasons.i_nog === 'notGrouped', 'bỏ qua không thuộc nhóm')
  check(reasons.i_nov === 'noVersion', 'bỏ qua chưa có version')
  check(reasons.i_bad === 'sizeMismatch', `bỏ qua sai W×H (${plan.skipped.find((s) => s.id === 'i_bad')?.detail})`)
  check(reasons.i_spr === 'sprite', 'bỏ qua sprite sheet')
  check(plan.items.find((i) => i.id === 'i_btn')?.version === 2, 'dùng selectedVersion=2 thay vì mới nhất v3')
  check(plan.items.find((i) => i.id === 'i_pop')?.version === 2, 'không chọn → dùng version mới nhất')
  check(plan.totalFiles === 10 && plan.conflicts === 0, `10 file, 0 xung đột (got ${plan.totalFiles}/${plan.conflicts})`)
  const longT = plan.items.find((i) => i.id === 'i_long')?.targets.find((t) => t.scale === 2)
  check(!!longT && longT.abs.length > 240, `có đường dẫn dài ${longT?.abs.length} ký tự`)
  check(plan.items.every((i) => i.rel.startsWith('game/') || i.rel.startsWith('extra/')), 'nhiều root → cây theo tên folder root')

  const progress: ExportProgress[] = []
  const r1 = await runExport(src, opts, (p) => progress.push(p))
  check(r1.ok && r1.written === 10 && r1.backedUp === 0 && r1.errors.length === 0, `lần 1: ghi ${r1.written}, backup ${r1.backedUp}, lỗi ${JSON.stringify(r1.errors)}`)
  check(progress.length > 0 && progress[progress.length - 1].phase === 'done' && progress[progress.length - 1].done === 10, 'progress kết thúc done 10/10')

  for (const item of plan.items) {
    const ver = await pngInfo(item.versionPath)
    for (const t of item.targets) {
      const got = await pngInfo(t.abs)
      check(got.w === t.w && got.h === t.h && got.alpha, `${t.rel} = ${got.w}×${got.h} alpha=${got.alpha}`)
      if (t.scale === 1) check(got.buf.equals(ver.buf), `${t.rel} ×1 trùng byte với v${item.version}`)
      check(t.rel.split('/').pop() === item.name, `${t.rel} giữ tên ${item.name}`)
    }
  }
  check(existsSync(join(plan.outDir, '@2x', 'game', 'ui', 'buttons', 'btn_green.png')), '×2 nằm trong output/@2x/<cây gốc>')
  check(existsSync(join(plan.outDir, 'game', 'logo.png')), '×1 nằm ngay output/<cây gốc>')
  const report = JSON.parse(await fs.readFile(join(plan.outDir, REPORT_FILE), 'utf8')) as { counts: { written: number; skipped: number } }
  check(report.counts.written === 10 && report.counts.skipped === 5, 'export-report.json đúng số')

  const plan2 = await planExport(src, opts)
  check(plan2.conflicts === 10, `lần 2 thấy 10 file đã tồn tại (got ${plan2.conflicts})`)
  await new Promise((r) => setTimeout(r, 1100))
  const r2 = await runExport(src, opts)
  check(r2.ok && r2.written === 10 && r2.backedUp === 10 && !!r2.backupDir, `lần 2: ghi ${r2.written}, backup ${r2.backedUp} → ${r2.backupDir}`)
  if (r2.backupDir) {
    check(/[\\/]_backup[\\/]\d{8}-\d{6}$/.test(r2.backupDir), 'backup dir dạng _backup/yyyyMMdd-HHmmss')
    for (const item of plan.items) {
      for (const t of item.targets) {
        const b = join(r2.backupDir, ...t.rel.split('/'))
        check(existsSync(longPath(b)), `backup giữ cây: ${t.rel}`)
      }
    }
  }

  const r3 = await runExport(src, { ...opts, conflict: 'skip' })
  check(r3.ok && r3.written === 0 && r3.keptExisting === 10, `policy skip: giữ ${r3.keptExisting}, ghi ${r3.written}`)

  const ac = new AbortController()
  ac.abort()
  const r4 = await runExport(src, { ...opts, outDir: join(base, 'out-cancel') }, undefined, { signal: ac.signal })
  check(r4.canceled && !r4.ok && r4.written === 0, 'huỷ trước khi chạy → không ghi gì')

  const bad = await planExport(src, { ...opts, outDir: join(srcGame, 'out') })
  check(bad.error === 'outInsideSource', 'chặn output nằm trong folder gốc')

  const suffix = await planExport(src, { scales: [1, 2, 4], scaleLayout: 'suffix', outDir: join(base, 'out-suffix') })
  check(suffix.items.find((i) => i.id === 'i_btn2')!.targets.map((t) => t.rel.split('/').pop()).join(',') === 'btn_blue.png,btn_blue@2x.png,btn_blue@4x.png', `layout suffix: ${suffix.items.find((i) => i.id === 'i_btn2')!.targets.map((t) => t.rel).join(', ')}`)
  const r5 = await runExport(src, { scales: [4], outDir: join(base, 'out-x4') })
  const x4 = await pngInfo(join(base, 'out-x4', '@4x', 'game', 'ui', 'popup', 'panel_main.png'))
  check(r5.ok && x4.w === 1280 && x4.h === 640 && x4.alpha, `×4 Lanczos 1280×640 alpha (got ${x4.w}×${x4.h})`)

  console.log('')
  console.log(fails ? `EXPORT TEST: ${fails} FAIL` : 'EXPORT TEST: ALL PASS')
  console.log(`output: ${plan.outDir}`)
  process.exit(fails ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
