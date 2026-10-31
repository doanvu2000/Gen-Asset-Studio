import { existsSync, promises as fs } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import sharp from 'sharp'
import { DEFAULT_SPRITE_SETTINGS, DIRECTIONS, type SpriteSettings } from '../src/shared/sprite'
import { atlasImageName, parseAtlas, parsePlistXml } from '../src/main/sprite/atlas'
import { detectGrid, emptyCells, gridFrames } from '../src/main/sprite/grid'
import { animsFromGrid, animsFromNames, animsFromTags, splitName } from '../src/main/sprite/anims'
import { SpriteService } from '../src/main/sprite/service'
import { emptyProject, readProject, writeProject } from '../src/main/workspace/project'

const repo = resolve(__dirname, '..')
const samples = join(repo, 'resources', 'sprite-samples')
let pass = 0
let fail = 0

function check(cond: unknown, msg: string): void {
  if (cond) {
    pass++
    console.log(`  ok   ${msg}`)
  } else {
    fail++
    console.log(`  FAIL ${msg}`)
  }
}

function eq<T>(a: T, b: T, msg: string): void {
  const ok = JSON.stringify(a) === JSON.stringify(b)
  check(ok, ok ? msg : `${msg} (got ${JSON.stringify(a)}, want ${JSON.stringify(b)})`)
}

async function testGrid(): Promise<void> {
  console.log('grid: hero_8dir_grid.png')
  const p = join(samples, 'hero_8dir_grid.png')
  const g = await detectGrid(p)
  eq(g && [g.cellW, g.cellH, g.cols, g.rows], [128, 128, 6, 8], 'detectGrid 128x128, 6 cols x 8 rows')
  if (!g) return
  const frames = gridFrames(g)
  eq(frames.length, 48, '48 frames')
  eq([frames[7].name, frames[7].x, frames[7].y], ['r1_c1', 128, 128], 'frame r1_c1 position')
  eq(await emptyCells(p, frames), [], 'no empty cells')
  const anims = animsFromGrid(g, [], DEFAULT_SPRITE_SETTINGS)
  eq(anims.map((a) => `${a.name}:${a.dir}`), DIRECTIONS[8].map((d) => `walk:${d}`), '8 walk anims in S SW W NW N NE E SE order')
  eq(anims[2].frames, [12, 13, 14, 15, 16, 17], 'walk W uses row 3')
  const four: SpriteSettings = { ...DEFAULT_SPRITE_SETTINGS, dirSet: 4, rowOrder: DIRECTIONS[4] }
  const a4 = animsFromGrid(g, [3, 4, 5], four)
  eq(a4.map((a) => `${a.name}:${a.dir}`), ['idle:S', 'idle:W', 'idle:E', 'idle:N', 'walk:S', 'walk:W', 'walk:E', 'walk:N'], '4 dirs x 8 rows = idle + walk')
  eq(a4[0].frames, [0, 1, 2], 'empty cells skipped')
  eq(a4[0].fps, 6, 'idle fps 6')
  const none = animsFromGrid(g, [], { ...DEFAULT_SPRITE_SETTINGS, dirSet: 0, rowOrder: [] })
  eq(none.map((a) => a.name).slice(0, 2), ['row_1', 'row_2'], 'dirSet 0 → row_N')
  const tmp = join(tmpdir(), 'gas-sprite-test')
  await fs.mkdir(tmp, { recursive: true })
  const holey = join(tmp, 'holey.png')
  const rawImg = await sharp(p).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  for (let y = 896; y < 1024; y++) for (let x = 512; x < 768; x++) rawImg.data[(y * rawImg.info.width + x) * 4 + 3] = 0
  await sharp(rawImg.data, { raw: { width: rawImg.info.width, height: rawImg.info.height, channels: 4 } }).png().toFile(holey)
  const gh = await detectGrid(holey)
  eq(gh && [gh.cellW, gh.cols, gh.rows], [128, 6, 8], 'detectGrid with 2 empty cells')
  if (gh) eq(await emptyCells(holey, gridFrames(gh)), [46, 47], 'emptyCells finds last 2 cells')
  const strip = join(tmp, 'strip.png')
  await sharp(p).extract({ left: 0, top: 0, width: 768, height: 128 }).png().toFile(strip)
  const gs = await detectGrid(strip)
  eq(gs && [gs.cellW, gs.cellH, gs.cols, gs.rows], [128, 128, 6, 1], 'single row strip')
  const opaque = join(tmp, 'opaque.png')
  await sharp({ create: { width: 512, height: 256, channels: 3, background: { r: 200, g: 50, b: 50 } } }).png().toFile(opaque)
  const go = await detectGrid(opaque)
  eq(go && [go.cellW, go.cellH, go.cols, go.rows], [256, 256, 2, 1], 'opaque fallback square cells')
  eq(await emptyCells(opaque, gridFrames(go!)), [], 'opaque has no empty cells')
}

async function testTp(): Promise<void> {
  console.log('atlas: TexturePacker hash')
  const jsonPath = join(samples, 'hero_4dir_tp.json')
  const text = await fs.readFile(jsonPath, 'utf8')
  const meta = await sharp(join(samples, 'hero_4dir_tp.png')).metadata()
  const a = parseAtlas(jsonPath, text, meta.width, meta.height)
  eq(a.format, 'tp-hash', 'format tp-hash')
  eq(atlasImageName(jsonPath, text), 'hero_4dir_tp.png', 'meta.image')
  eq(a.frames.length, 16, '16 frames')
  eq(a.warnings, [], 'no warnings')
  const raw = JSON.parse(text).frames
  const up = a.frames.find((f) => f.name === 'walk_up_00.png')!
  const rawUp = raw['walk_up_00.png']
  check(up.rotated, 'up frame rotated')
  eq([up.w, up.h], [rawUp.frame.h, rawUp.frame.w], 'rotated frame w/h are on-sheet (swapped)')
  eq([up.srcW, up.srcH, up.srcX, up.srcY], [128, 128, rawUp.spriteSourceSize.x, rawUp.spriteSourceSize.y], 'rotated frame src box')
  const down = a.frames.find((f) => f.name === 'walk_down_01.png')!
  check(down.trimmed && !down.rotated, 'down frame trimmed, not rotated')
  check(down.w < 128 && down.h < 128, 'trimmed frame smaller than cell')
  const left = a.frames.find((f) => f.name === 'walk_left_00.png')!
  check(!left.trimmed && left.w === 128, 'left frame untrimmed')
  eq([down.pivotX, down.pivotY], [0.5, 1], 'pivot')
  const anims = animsFromNames(a.frames)
  eq(anims.map((x) => `${x.name}:${x.dir}:${x.frames.length}`).sort(), ['walk:E:4', 'walk:N:4', 'walk:S:4', 'walk:W:4'], 'anims by name + direction')
  const s = anims.find((x) => x.dir === 'S')!
  eq(s.frames.map((i) => a.frames[i].name), ['walk_down_00.png', 'walk_down_01.png', 'walk_down_02.png', 'walk_down_03.png'], 'frames ordered by index')
}

async function testAse(): Promise<void> {
  console.log('atlas: Aseprite array + frameTags')
  const p = join(samples, 'hero_idle_walk.json')
  const a = parseAtlas(p, await fs.readFile(p, 'utf8'), 1280, 128)
  eq(a.format, 'aseprite', 'format aseprite')
  eq(a.frames.length, 10, '10 frames')
  eq(a.tags.map((t) => `${t.name}:${t.from}-${t.to}:${t.direction}`), ['idle:0-3:forward', 'walk:4-9:pingpong'], 'frame tags')
  const anims = animsFromTags(a.tags, a.frames.length)
  eq(anims.map((x) => `${x.name}:${x.loop}:${x.frames.join(',')}`), ['idle:loop:0,1,2,3', 'walk:pingpong:4,5,6,7,8,9'], 'anims from tags')
}

const PLIST2 = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>frames</key>
  <dict>
    <key>run_left_01.png</key>
    <dict>
      <key>frame</key><string>{{2,2},{60,100}}</string>
      <key>offset</key><string>{4,-6}</string>
      <key>rotated</key><false/>
      <key>sourceColorRect</key><string>{{38,20},{60,100}}</string>
      <key>sourceSize</key><string>{128,128}</string>
    </dict>
    <key>run_left_02.png</key>
    <dict>
      <key>frame</key><string>{{64,2},{60,100}}</string>
      <key>offset</key><string>{0,0}</string>
      <key>rotated</key><true/>
      <key>sourceSize</key><string>{128,128}</string>
    </dict>
  </dict>
  <key>metadata</key>
  <dict>
    <key>format</key><integer>2</integer>
    <key>realTextureFileName</key><string>hero_run.png</string>
    <key>size</key><string>{256,128}</string>
    <key>textureFileName</key><string>hero_run.png</string>
  </dict>
</dict>
</plist>`

const PLIST3 = `<?xml version="1.0"?><plist version="1.0"><dict><key>frames</key><dict>
<key>idle_up_0</key><dict><key>aliases</key><array/><key>spriteOffset</key><string>{0,0}</string><key>spriteSize</key><string>{50,80}</string><key>spriteSourceSize</key><string>{64,96}</string><key>textureRect</key><string>{{10,20},{50,80}}</string><key>textureRotated</key><false/></dict>
</dict><key>metadata</key><dict><key>format</key><integer>3</integer><key>textureFileName</key><string>sheet3.png</string><key>size</key><string>{128,128}</string></dict></dict></plist>`

const UNITY = `fileFormatVersion: 2
guid: 0123456789abcdef
TextureImporter:
  internalIDToNameTable: []
  serializedVersion: 12
  spriteMode: 2
  spriteSheet:
    serializedVersion: 2
    sprites:
    - serializedVersion: 2
      name: hero_walk_south_0
      rect:
        serializedVersion: 2
        x: 0
        y: 128
        width: 64
        height: 64
      alignment: 9
      pivot: {x: 0.5, y: 0}
      border: {x: 0, y: 0, z: 0, w: 0}
      outline: []
    - serializedVersion: 2
      name: hero_walk_south_1
      rect:
        serializedVersion: 2
        x: 64
        y: 128
        width: 64
        height: 64
      alignment: 0
      pivot: {x: 0.5, y: 0.5}
    outline: []
    physicsShape: []
  spritePackingTag:
`

function testPlistUnity(): void {
  console.log('atlas: plist + Unity meta')
  const pl = parsePlistXml('<plist><dict><key>a</key><array><integer>3</integer><real>1.5</real><true/><string>x &amp; y</string></array></dict></plist>')
  eq(pl, { a: [3, 1.5, true, 'x & y'] }, 'plist xml parser')
  const a = parseAtlas('hero_run.plist', PLIST2, 256, 128)
  eq(a.format, 'plist', 'plist format')
  eq(atlasImageName('hero_run.plist', PLIST2), 'hero_run.png', 'plist image name')
  eq(a.frames.length, 2, 'plist 2 frames')
  const [f1, f2] = a.frames
  eq([f1.x, f1.y, f1.w, f1.h, f1.srcX, f1.srcY, f1.trimmed], [2, 2, 60, 100, 38, 20, true], 'plist frame 1 with sourceColorRect')
  eq([f2.rotated, f2.w, f2.h, f2.srcX, f2.srcY], [true, 100, 60, 34, 14], 'plist frame 2 rotated + centered offset')
  eq(animsFromNames(a.frames).map((x) => `${x.name}:${x.dir}:${x.frames.length}`), ['run:W:2'], 'plist anims')
  const a3 = parseAtlas('sheet3.plist', PLIST3, 128, 128)
  eq([a3.frames[0].x, a3.frames[0].y, a3.frames[0].w, a3.frames[0].h, a3.frames[0].srcX, a3.frames[0].srcY], [10, 20, 50, 80, 7, 8], 'plist format 3')
  const u = parseAtlas('hero.png.meta', UNITY, 256, 192)
  eq(u.format, 'unity', 'unity format')
  eq(atlasImageName('C:/x/hero.png.meta', UNITY), 'hero.png', 'unity image name')
  eq(u.frames.map((f) => [f.name, f.x, f.y, f.w, f.h]), [
    ['hero_walk_south_0', 0, 0, 64, 64],
    ['hero_walk_south_1', 64, 0, 64, 64]
  ], 'unity rects flipped to top-left')
  eq([u.frames[0].pivotX, u.frames[0].pivotY], [0.5, 1], 'unity pivot flipped')
  eq(animsFromNames(u.frames).map((x) => `${x.name}:${x.dir}:${x.frames.join(',')}`), ['hero_walk:S:0,1'], 'unity anims')
  let threw = ''
  try {
    parseAtlas('x.json', '{"skeleton":{}}')
  } catch (e) {
    threw = (e as Error).message
  }
  check(threw.includes('frames'), 'non-atlas json throws clear error')
  eq(splitName('Walk-NorthEast_003').dir, 'NE', 'split NorthEast')
  eq(splitName('attack_down_left_2'), { base: 'attack', dir: 'SW', index: 2 }, 'split down_left')
  eq(splitName('idle0'), { base: 'idle', dir: null, index: 0 }, 'split idle0')
}

async function testService(): Promise<void> {
  console.log('service: add / update / settings')
  const base = join(tmpdir(), 'gas-sprite-test', 'proj')
  await fs.rm(base, { recursive: true, force: true })
  await fs.mkdir(base, { recursive: true })
  await writeProject(base, emptyProject('proj'))
  const allowed = new Set<string>()
  let chain: Promise<unknown> = Promise.resolve()
  const svc = new SpriteService({
    projectDir: () => base,
    run: <T>(fn: () => Promise<T>) => {
      const next = chain.then(fn, fn)
      chain = next.catch(() => undefined)
      return next
    },
    allow: (p) => allowed.add(p),
    log: () => undefined,
    readProject,
    writeProject
  })
  const r = await svc.addPaths('proj', [samples])
  eq(r.added, 3, 'folder add → 3 sheets')
  eq(r.skipped, [], 'nothing skipped')
  const v = r.view!
  const byName = Object.fromEntries(v.sheets.map((s) => [s.name, s]))
  eq(byName['hero_4dir_tp.png']?.format, 'tp-hash', 'tp sheet paired with json')
  eq(byName['hero_idle_walk.png']?.format, 'aseprite', 'aseprite sheet paired')
  eq(byName['hero_8dir_grid.png']?.format, 'grid', 'grid sheet')
  eq(byName['hero_8dir_grid.png']?.anims.length, 8, 'grid sheet 8 anims')
  check(v.sheets.every((s) => s.thumb && s.url.startsWith('gas-file://') && allowed.has(s.path)), 'urls + thumbs + allowed')
  const again = await svc.addPaths('proj', [join(samples, 'hero_4dir_tp.json')])
  eq(again.skipped.map((s) => s.reason), ['duplicate'], 'atlas of existing sheet → duplicate')
  const tmp = join(tmpdir(), 'gas-sprite-test')
  await fs.writeFile(join(tmp, 'char.atlas'), 'char.png\nsize: 64,64\n')
  const sp = await svc.addPaths('proj', [join(tmp, 'char.atlas')])
  eq(sp.skipped.map((s) => `${s.reason}:${s.detail}`), ['badAtlas:spine'], 'spine .atlas rejected')
  const grid = byName['hero_8dir_grid.png']!
  const four = await svc.setSettings('proj', { dirSet: 4 })
  const g4 = four!.sheets.find((s) => s.id === grid.id)!
  eq(g4.anims.map((a) => `${a.name}:${a.dir}`), ['idle:S', 'idle:W', 'idle:E', 'idle:N', 'walk:S', 'walk:W', 'walk:E', 'walk:N'], 'dirSet 4 recomputes auto anims')
  const upd = await svc.updateSheet('proj', grid.id, { grid: { ...grid.grid!, cellW: 256, cols: 3 } })
  const gu = upd!.sheets.find((s) => s.id === grid.id)!
  eq([gu.frames.length, gu.grid?.cellW, gu.grid?.cols], [24, 256, 3], 'grid update recomputes frames')
  const edited = gu.anims.slice(0, 2).map((a) => ({ ...a, name: 'run', fps: 12 }))
  const ue = await svc.updateSheet('proj', grid.id, { anims: [...edited, { id: 'bad id!', name: '', dir: 'X', frames: [0, 999, -1], fps: 500, loop: 'zz' } as never] })
  const ge = ue!.sheets.find((s) => s.id === grid.id)!
  eq(ge.anims.length, 3, 'manual anims saved')
  eq([ge.anims[2].name, ge.anims[2].dir, ge.anims[2].frames, ge.anims[2].fps, ge.anims[2].loop], ['anim', null, [0], 60, 'loop'], 'manual anims sanitized')
  await svc.setSettings('proj', { dirSet: 8 })
  const kept = (await svc.open('proj'))!.sheets.find((s) => s.id === grid.id)!
  eq(kept.anims.length, 3, 'manual anims kept on settings change')
  const det = await svc.detectGrid('proj', grid.id)
  eq(det && [det.cellW, det.cols, det.rows], [128, 6, 8], 'service detectGrid')
  const back = await svc.updateSheet('proj', grid.id, { grid: det!, autoAnims: true })
  eq(back!.sheets.find((s) => s.id === grid.id)!.anims.length, 8, 'autoAnims restores')
  const disk = await readProject(base)
  check(disk.sprite && typeof disk.sprite === 'object', 'project.json has sprite key')
  const rm = await svc.remove('proj', grid.id)
  eq(rm!.sheets.length, 2, 'remove sheet')
  check(existsSync(join(base, '.cache', 'thumbs')), 'thumbs cached')
}

async function main(): Promise<void> {
  if (!existsSync(join(samples, 'hero_8dir_grid.png'))) throw new Error('run node scripts/make-sprite-samples.mjs first')
  await testGrid()
  await testTp()
  await testAse()
  testPlistUnity()
  await testService()
  console.log(`\n${pass} passed, ${fail} failed`)
  if (fail) process.exit(1)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
