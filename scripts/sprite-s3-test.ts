import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import sharp from 'sharp'
import type { JobSpec, QueueJob } from '../src/shared/queue'
import type { TurnResult } from '../src/main/codex/service'
import { SpriteService } from '../src/main/sprite/service'
import { runStripJob } from '../src/main/sprite/stripJob'
import { cocosPlist, godotTres, unityMeta } from '../src/main/sprite/formats'
import type { SnippetSheet } from '../src/main/sprite/snippets'
import { parseAtlas } from '../src/main/sprite/atlas'
import { loadSheet, savePng, uprightFrame } from '../src/main/sprite/strip'
import { readProject, writeProject, emptyProject } from '../src/main/workspace/project'
import { decode } from '../src/main/pipeline/image'
import type { CodexLike, PipelineLike } from '../src/main/queue/GenJob'

const root = resolve(__dirname, '..')
const base = join(process.env['TEMP'] ?? '.', 'gas-s3-test')
const proj = join(base, 'Hero New')
const samples = join(root, 'resources/sprite-samples')
let passed = 0
let failed = 0
function check(cond: unknown, msg: string): void {
  if (cond) {
    passed++
    console.log(`  ok   ${msg}`)
  } else {
    failed++
    console.log(`  FAIL ${msg}`)
  }
}

const codex = {
  rateLimits: null,
  on: () => codex,
  off: () => codex,
  interrupt: async () => undefined,
  readRateLimits: async () => null,
  generateImage: async (_t: unknown, prompt: string, images: string[]): Promise<TurnResult> => {
    check(/Create a game sprite animation sheet/.test(prompt) && /LAYOUT GUIDE/.test(prompt), 'create prompt used')
    const src = images[0]
    const meta = await sharp(src).metadata()
    const out = src.replace(/-src\.png$/, '-fake.png')
    const flat = await sharp({ create: { width: meta.width ?? 1, height: meta.height ?? 1, channels: 3, background: { r: 255, g: 0, b: 255 } } })
      .composite([{ input: src }])
      .png()
      .toBuffer()
    await sharp(flat).resize((meta.width ?? 1) * 2, (meta.height ?? 1) * 2).png().toFile(out)
    return { threadId: 't', turnId: 'u', status: 'completed', error: null, errorInfo: null, agentText: '', durationMs: 1, images: [{ itemId: 'i', status: 'completed', savedPath: out, base64: null, revisedPrompt: null, failure: null }] } as unknown as TurnResult
  }
} as unknown as CodexLike

const pipeline = { pickChroma: async () => ({ name: 'magenta', hex: '#FF00FF', promptName: 'pure magenta', rgb: [255, 0, 255] }) } as unknown as PipelineLike

async function main(): Promise<void> {
  rmSync(base, { recursive: true, force: true })
  mkdirSync(proj, { recursive: true })
  await writeProject(proj, emptyProject('Hero New', 'sprite'))
  const tpPath = join(samples, 'hero_4dir_tp.json')
  const tp = parseAtlas(tpPath, readFileSync(tpPath, 'utf8'))
  const ch = join(base, 'character.png')
  await savePng(await uprightFrame(await loadSheet(join(samples, 'hero_4dir_tp.png')), tp.frames.find((f) => /down/.test(f.name)) ?? tp.frames[0]), ch)

  const queued: JobSpec[] = []
  const svc = new SpriteService({
    projectDir: () => proj,
    run: (fn) => fn(),
    allow: () => undefined,
    log: () => undefined,
    readProject,
    writeProject,
    enqueue: () => (specs) => {
      queued.push(...specs)
      return specs.map(() => 'j')
    },
    template: async () => null
  })
  await svc.setSettings('Hero New', { dirSet: 4, rowPreset: 'flame' })
  const bad = await svc.createSheet('Hero New', { name: 'x', character: join(base, 'nope.png'), description: '', anims: [{ name: 'idle', frames: 4 }], cell: 128 })
  check(bad.error === 'noCharacter', 'missing character refused')
  const r = await svc.createSheet('Hero New', { name: 'Hero Kid!', character: ch, description: 'kid hero', anims: [{ name: 'idle', frames: 4 }, { name: 'Walk', frames: 6 }, { name: 'walk', frames: 3 }], cell: 128 })
  check(!r.error && r.sheetId, `sheet created ${r.error ?? ''}`)
  const sheet = r.view?.sheets.find((s) => s.id === r.sheetId)
  check(sheet?.origin === 'new' && sheet.name === 'Hero_Kid.png' && sheet.w === 768 && sheet.h === 1024, `sheet ${sheet?.name} ${sheet?.w}x${sheet?.h} (2 anims x 4 dirs x 6 cols)`)
  check(sheet?.anims.length === 8 && sheet.empty.length === 8, `8 anims, 8 empty cells (${sheet?.anims.length}, ${sheet?.empty.length})`)
  check(!!sheet?.characterUrl, 'character url')
  const strips = r.view?.strips ?? []
  check(strips.length === 8 && strips.every((s) => s.created && !!s.refUrl && s.origUrl === null), 'strips created with refUrl')
  check(strips.filter((s) => s.mirrorOf).length === 2, 'E idle/walk mirrored from W')
  check(r.view?.strips.find((s) => s.key === r.view?.lockKey)?.anim === 'idle', `lock is idle S (${r.view?.lockKey})`)

  await svc.setStyle('Hero New', { promptEn: 'candy', locked: true })
  const lockKey = r.view?.lockKey as string
  const runQueued = async (): Promise<void> => {
    while (queued.length) {
      const spec = queued.shift() as JobSpec
      const job = { ...spec, id: 'x', attempt: 1, status: 'running', step: 'waiting', progress: '', error: null, result: null, createdAt: 0, startedAt: 0, finishedAt: null, notBefore: null } as QueueJob
      const res = await runStripJob(job, { codex, pipeline, log: () => undefined, model: 'm', effort: 'e', timeoutMs: 1000, signal: new AbortController().signal, onStep: () => undefined })
      const m = await sharp(res.versionPath).metadata()
      const n = spec.sprite?.frames.length ?? 0
      const st = res.qa.checks.find((c) => c.id === 'static')
      check(st?.status === 'warn' && res.qa.pass && !res.qa.checks.some((c) => c.id === 'overflow'), `fake copies the guide into every cell -> static warn ${st?.value}%, qa still pass`)
      check(m.width === n * 128 && m.height === 128, `${spec.assetRelPath} v${res.version} ${m.width}x${m.height}, qa missing=${res.qa.checks.find((c) => c.id === 'missing')?.value}`)
    }
  }
  check((await svc.enqueueAll('Hero New', r.sheetId as string)) === 1 && queued[0].assetRelPath === strips.find((s) => s.key === lockKey)?.assetRel, 'enqueueAll on new sheet queues lock strip first')
  await runQueued()
  let view = await svc.review('Hero New', { [lockKey]: { decision: 'approved' } })
  check(view?.chained === 5 && queued.length === 5, `approve lock auto-chains the other 5 strips (${view?.chained})`)
  check(queued.every((q) => !!q.sprite?.create && existsSync(q.sprite.create.character) && q.sprite.create.cell === 128 && q.sprite.lockImages.length === 1), 'create spec + lock image on chained jobs')
  await runQueued()
  view = await svc.open('Hero New')
  const patch: Record<string, { decision: 'approved' }> = {}
  for (const s of view?.strips ?? []) if (!s.mirrorOf) patch[s.key] = { decision: 'approved' }
  view = await svc.review('Hero New', patch)
  const off = await svc.exportRun('Hero New', join(base, 'out-default'))
  check(off.ok && !existsSync(join(base, 'out-default', 'Hero_Kid.tres')) && off.sheets[0]?.formats.length === 0, 'engine formats off by default')
  await svc.setSettings('Hero New', { exportFormats: { godot: true, unity: true, cocos: true } })
  const res = await svc.exportRun('Hero New', join(base, 'out'))
  check(res.sheets[0]?.formats.join() === 'Hero_Kid.tres,Hero_Kid.png.meta,Hero_Kid.plist', `formats written (${res.sheets[0]?.formats.join()})`)
  check(res.ok && res.sheets[0]?.frames === 40, `exported ${res.sheets[0]?.frames} frames`)
  const json = JSON.parse(readFileSync(join(base, 'out', 'Hero_Kid.json'), 'utf8')) as { frames: Array<{ filename: string }>; animations: Record<string, string[]>; meta: { image: string; size: { w: number } } }
  check(json.frames.length === 40 && json.meta.image === 'Hero_Kid.png' && json.animations['walk_S']?.length === 6, `atlas json frames ${json.frames.length}, walk_S ${json.animations['walk_S']?.length}`)
  const parsed = parseAtlas(join(base, 'out', 'Hero_Kid.json'), readFileSync(join(base, 'out', 'Hero_Kid.json'), 'utf8'), 768, 1024)
  check(parsed.frames.length === 40 && parsed.format === 'tp-array', `own parser reads exported atlas (${parsed.format})`)
  const tpFrames = parsed.frames
  const unity = parseAtlas(join(base, 'out', 'Hero_Kid.png.meta'), readFileSync(join(base, 'out', 'Hero_Kid.png.meta'), 'utf8'), 768, 1024)
  const cocos = parseAtlas(join(base, 'out', 'Hero_Kid.plist'), readFileSync(join(base, 'out', 'Hero_Kid.plist'), 'utf8'), 768, 1024)
  const same = (a: typeof tpFrames, strip: boolean): boolean => {
    const m = new Map(a.map((f) => [strip ? f.name.replace(/\.png$/, '') : f.name, f]))
    return tpFrames.every((f) => {
      const o = m.get(f.name)
      return !!o && o.x === f.x && o.y === f.y && o.w === f.w && o.h === f.h
    })
  }
  check(unity.format === 'unity' && unity.frames.length === 40 && same(unity.frames, false), 'unity .png.meta round-trips to the TexturePacker rects (y flipped)')
  check(unity.frames.every((f) => f.pivotX === 0.5 && f.pivotY === 1), 'unity pivot bottom-centre')
  check(cocos.format === 'plist' && cocos.frames.length === 40 && same(cocos.frames, true) && cocos.image === 'Hero_Kid.png', 'cocos plist round-trips to the TexturePacker rects')
  const tres = readFileSync(join(base, 'out', 'Hero_Kid.tres'), 'utf8')
  check((tres.match(/\[sub_resource type="AtlasTexture"/g) ?? []).length === 40 && (tres.match(/"name": &"/g) ?? []).length === 8 && /"name": &"walk_S"/.test(tres), 'tres has 40 atlas textures and 8 animations')
  check(/Rect2\(0, 0, 128, 128\)/.test(tres) && /"speed": \d+\.0/.test(tres), 'tres regions and speed')
  const edge: SnippetSheet = {
    image: 'we"ird & <x>.png',
    w: 256,
    h: 128,
    grid: { cellW: 128, cellH: 128, cols: 2, rows: 1, offsetX: 0, offsetY: 0, gapX: 0, gapY: 0 } as SnippetSheet['grid'],
    frames: [
      { name: 'a', x: 0, y: 0, w: 128, h: 128, rotated: false, trimmed: false, srcX: 0, srcY: 0, srcW: 128, srcH: 128, pivotX: 0.5, pivotY: 1 },
      { name: 'b', x: 128, y: 0, w: 128, h: 128, rotated: false, trimmed: false, srcX: 0, srcY: 0, srcW: 128, srcH: 128, pivotX: 0.5, pivotY: 1 }
    ],
    anims: [
      { id: 'a1', name: 'đi "bộ" & <1>', dir: null, frames: [0, 1, 9], fps: 0, loop: 'once' },
      { id: 'a2', name: 'empty', dir: null, frames: [], fps: 8, loop: 'loop' }
    ] as SnippetSheet['anims']
  }
  const eT = godotTres(edge)
  check(eT.includes('path="we\\"ird & <x>.png"') && eT.includes('&"đi \\"bộ\\" & <1>"') && /"speed": 1\.0/.test(eT) && /"loop": false/.test(eT) && (eT.match(/AtlasTexture_/g) ?? []).length === 4 && /"frames": \[],/.test(eT), 'godot escapes, fps 0 -> 1, unknown frame skipped, empty anim kept')
  const eP = parseAtlas('x.plist', cocosPlist(edge), 256, 128)
  check(eP.frames.length === 2 && eP.frames[0].name === 'đi "bộ" & <1>_00.png' && eP.image === 'we"ird & <x>.png', 'plist escapes xml round-trip')
  const eU = parseAtlas('x.png.meta', unityMeta(edge), 256, 128)
  check(eU.frames.length === 2 && eU.frames[1].x === 128 && eU.frames[1].y === 0, 'unity meta with unicode names parses')
  const md = readFileSync(res.sheets[0]?.snippets ?? '', 'utf8')
  check(/SpriteSheet\(/.test(md) && /createAnimation\(row: 4/.test(md) && /Bitmap\.createBitmap/.test(md) && /SKTexture\(rect:/.test(md), 'snippets md has Flame/Android/iOS')
  check(md.includes('## Godot 4') && md.includes('## Cocos Creator') && md.includes('## Unity (C#)'), 'snippets md has Godot/Unity/Cocos')
  const out = await decode(join(base, 'out', 'Hero_Kid.png'))
  let filledE = 0
  const row = 2
  for (let y = row * 128; y < row * 128 + 128; y++) for (let x = 0; x < 4 * 128; x++) if (out.data[(y * out.width + x) * 4 + 3] > 20) filledE++
  check(filledE > 2000, `mirrored E idle row has pixels (${filledE})`)
  const sn = await svc.snippets('Hero New', r.sheetId as string)
  check(!!sn && sn.json === 'Hero_Kid.json' && sn.flame.includes("images.load('Hero_Kid.png')") && sn.godot.includes('Hero_Kid.tres') && sn.unity.includes('.meta') && sn.cocos.includes('.plist'), 'snippets api')
  console.log(`\n${passed} passed, ${failed} failed  (out: ${join(base, 'out')})`)
  if (failed) process.exit(1)
}

void main().catch((e) => {
  console.error(e)
  process.exit(1)
})
