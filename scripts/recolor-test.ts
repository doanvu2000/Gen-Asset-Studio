import { existsSync, mkdirSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { decode, encodePng } from '../src/main/pipeline/image'
import { isRecolorIdentity, normalizeRecolor, recolor } from '../src/main/pipeline/recolor'
import type { RawImage } from '../src/main/pipeline/types'
import { readVersions, recolorVersion } from '../src/main/workspace/review'
import { listStripVersions, recolorStripVersion, stripVersions } from '../src/main/sprite/strips'
import { RECOLOR_DEFAULT } from '../src/shared/recolor'
import { writeFileSync } from 'node:fs'

let fails = 0
function check(cond: unknown, msg: string): void {
  if (!cond) fails++
  console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`)
}

function px(img: RawImage, i: number): number[] {
  return Array.from(img.data.slice(i * 4, i * 4 + 4))
}

function sample(): RawImage {
  const data = new Uint8Array([
    255, 0, 0, 255, // red
    0, 0, 255, 255, // blue
    128, 128, 128, 255, // gray
    255, 255, 255, 255, // white
    0, 0, 0, 255, // black
    255, 0, 0, 100, // semi-transparent red
    255, 0, 0, 0, // fully transparent
    0, 255, 0, 255 // green
  ])
  return { data, width: 4, height: 2 }
}

async function main(): Promise<void> {
  const base = sample()
  const flip = recolor(base, { ...RECOLOR_DEFAULT, hue: 180 })
  check(px(flip, 0).join() === '0,255,255,255', `hue 180 red -> cyan ${px(flip, 0)}`)
  check(px(flip, 2).slice(0, 3).join() === '128,128,128', 'gray untouched by hue')
  check(px(flip, 3).join() === '255,255,255,255' && px(flip, 4).join() === '0,0,0,255', 'white/black untouched by hue')
  check(px(flip, 5)[3] === 100 && px(flip, 6)[3] === 0, 'alpha preserved incl. semi/zero')
  check(px(flip, 6).slice(0, 3).join() === '255,0,0', 'zero-alpha pixel skipped')
  const neg = recolor(base, { ...RECOLOR_DEFAULT, hue: -180 })
  check(px(neg, 0).join() === px(flip, 0).join(), 'hue wrap +-180 equal')
  check(px(base, 0).join() === '255,0,0,255', 'input not mutated')

  const dark = recolor(base, { ...RECOLOR_DEFAULT, bright: 50 })
  check(px(dark, 0).join() === '128,0,0,255' && px(dark, 3).slice(0, 3).join() === '128,128,128', 'brightness 50%')
  const gray = recolor(base, { ...RECOLOR_DEFAULT, sat: 0 })
  check(px(gray, 0)[0] === px(gray, 0)[1] && px(gray, 0)[1] === px(gray, 0)[2], 'saturation 0 gives gray')

  const region = recolor(base, { hue: 180, sat: 100, bright: 100, region: { hue: 0, range: 30 } })
  check(px(region, 0).join() === '0,255,255,255', 'region: red inside range changes')
  check(px(region, 1).join() === '0,0,255,255' && px(region, 7).join() === '0,255,0,255', 'region: blue/green outside unchanged')
  check(px(region, 2).slice(0, 3).join() === '128,128,128', 'region: gray skipped')
  const wrap = recolor(base, { hue: 180, sat: 100, bright: 100, region: { hue: 350, range: 30 } })
  check(px(wrap, 0).join() === '0,255,255,255', 'region: circular distance (350 vs 0)')

  check(isRecolorIdentity(RECOLOR_DEFAULT) && !isRecolorIdentity({ ...RECOLOR_DEFAULT, hue: 1 }), 'identity detection')
  const n = normalizeRecolor({ hue: 999, sat: -5, bright: 'x', region: { hue: -10, range: 500 } })
  check(n.hue === 180 && n.sat === 0 && n.bright === 100 && n.region?.hue === 350 && n.region.range === 90, 'normalize clamps')

  const root = mkdtempSync(join(tmpdir(), 'gas-recolor-'))
  const vdir = join(root, 'versions', 'ui', 'btn')
  mkdirSync(vdir, { recursive: true })
  writeFileSync(join(vdir, 'v1.png'), await encodePng(base))
  writeFileSync(join(vdir, 'v1.json'), JSON.stringify({ version: 1, createdAt: new Date().toISOString() }))
  let threw = false
  try {
    await recolorVersion(vdir, 1, RECOLOR_DEFAULT)
  } catch {
    threw = true
  }
  check(threw, 'reskin: identity params rejected')
  threw = false
  try {
    await recolorVersion(vdir, 9, { ...RECOLOR_DEFAULT, hue: 90 })
  } catch {
    threw = true
  }
  check(threw, 'reskin: missing source rejected')
  const [a, b] = await Promise.all([recolorVersion(vdir, 1, { ...RECOLOR_DEFAULT, hue: 90 }), recolorVersion(vdir, 1, { ...RECOLOR_DEFAULT, hue: 180 })])
  check(a.version !== b.version && [a.version, b.version].sort().join() === '2,3', `reskin: parallel saves distinct (${a.version},${b.version})`)
  const meta = JSON.parse(readFileSync(join(vdir, `v${a.version}.json`), 'utf8'))
  check(meta.kind === 'recolor' && meta.from === 1 && meta.params.hue === 90, 'reskin: meta kind/from/params')
  const out = await decode(join(vdir, `v${b.version}.png`))
  check(out.width === 4 && out.height === 2 && out.data[5 * 4 + 3] === 100 && px(out, 0).join() === '0,255,255,255', 'reskin: size + alpha kept, pixels recolored')
  const infos = await readVersions(vdir, [1, 2, 3])
  check(infos[0].recolorOf === null && infos[1].recolorOf === 1, 'reskin: VersionInfo.recolorOf')
  check(!existsSync(join(vdir, 'v4.png')), 'reskin: no extra version')

  const sprite = join(root, 'versions', 'sprite', 'sheet', 'idle_s')
  mkdirSync(sprite, { recursive: true })
  const empty = { data: new Uint8Array(4 * 4 * 2), width: 4, height: 2 }
  writeFileSync(join(sprite, 'v1.png'), await encodePng({ data: Uint8Array.from([...base.data.slice(0, 16), ...empty.data.slice(0, 16)]), width: 8, height: 1 }))
  const v = await recolorStripVersion(root, 'sprite/sheet/idle_s.png', 1, { ...RECOLOR_DEFAULT, hue: 180 }).catch((e: Error) => e)
  check(typeof v === 'number' && v === 2, `sprite: new strip version ${String(v)}`)
  if (typeof v === 'number') {
    const s = await decode(join(sprite, 'v2.png'))
    check(s.width === 8 && s.height === 1 && px(s, 0).join() === '0,255,255,255' && px(s, 7).join() === '0,0,0,0', 'sprite: strip with empty frame keeps size/alpha')
    check((await listStripVersions(root, 'sprite/sheet/idle_s.png')).join() === '1,2', 'sprite: listStripVersions')
    const sv = await stripVersions(root, 'sprite/sheet/idle_s.png')
    check(sv[1].recolorOf === 1 && sv[0].recolorOf === null, 'sprite: StripVersion.recolorOf')
  }
  console.log(fails ? `${fails} FAIL` : 'ALL PASS')
  process.exitCode = fails ? 1 : 0
}

void main()
