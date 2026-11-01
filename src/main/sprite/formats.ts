import { createHash } from 'node:crypto'
import { animKey, frameName, type SnippetSheet } from './snippets'

interface UsedFrame {
  name: string
  x: number
  y: number
  w: number
  h: number
}

interface UsedAnim {
  key: string
  fps: number
  loop: boolean
  frames: UsedFrame[]
}

function used(s: SnippetSheet): UsedAnim[] {
  return s.anims.map((a) => ({
    key: animKey(a),
    fps: a.fps > 0 ? a.fps : 1,
    loop: a.loop !== 'once',
    frames: a.frames.flatMap((idx, i) => {
      const f = s.frames[idx]
      return f ? [{ name: frameName(a, i), x: f.x, y: f.y, w: f.w, h: f.h }] : []
    })
  }))
}

function xmlEsc(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;')
}

function godotStr(v: string): string {
  return `"${v.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
}

export function godotTres(s: SnippetSheet): string {
  const anims = used(s)
  const total = anims.reduce((n, a) => n + a.frames.length, 0)
  const subs: string[] = []
  const entries = anims.map((a) => {
    const frames = a.frames.map((f) => {
      const id = `AtlasTexture_${subs.length}`
      subs.push(`[sub_resource type="AtlasTexture" id="${id}"]\natlas = ExtResource("1")\nregion = Rect2(${f.x}, ${f.y}, ${f.w}, ${f.h})\n`)
      return `{\n"duration": 1.0,\n"texture": SubResource("${id}")\n}`
    })
    return `{\n"frames": [${frames.join(', ')}],\n"loop": ${a.loop},\n"name": &${godotStr(a.key)},\n"speed": ${a.fps.toFixed(1)}\n}`
  })
  return [
    `[gd_resource type="SpriteFrames" load_steps=${total + 2} format=3]`,
    '',
    `[ext_resource type="Texture2D" path=${godotStr(s.image)} id="1"]`,
    '',
    ...subs,
    '[resource]',
    `animations = [${entries.join(', ')}]`,
    ''
  ].join('\n')
}

function hex(seed: string, len: number): string {
  return createHash('md5').update(seed).digest('hex').slice(0, len)
}

function yamlName(v: string): string {
  return /^[A-Za-z0-9_.-]+$/.test(v) ? v : `'${v.replace(/'/g, "''")}'`
}

// Unity rect.y counts from the bottom of the texture, atlas JSON from the top.
export function unityMeta(s: SnippetSheet): string {
  const sprites = used(s).flatMap((a) => a.frames)
  const sheet = sprites.flatMap((f, i) => [
    '    - serializedVersion: 2',
    `      name: ${yamlName(f.name)}`,
    '      rect:',
    '        serializedVersion: 2',
    `        x: ${f.x}`,
    `        y: ${s.h - f.y - f.h}`,
    `        width: ${f.w}`,
    `        height: ${f.h}`,
    '      alignment: 9',
    '      pivot: {x: 0.5, y: 0}',
    '      border: {x: 0, y: 0, z: 0, w: 0}',
    '      customData: ',
    '      outline: []',
    '      physicsShape: []',
    '      tessellationDetail: 0',
    '      bones: []',
    `      spriteID: ${hex(`${s.image}/${f.name}`, 32)}`,
    `      internalID: ${21300000 + i * 2}`,
    '      vertices: []',
    '      indices: ',
    '      edges: []',
    '      weights: []'
  ])
  return [
    'fileFormatVersion: 2',
    `guid: ${hex(s.image, 32)}`,
    'TextureImporter:',
    '  serializedVersion: 12',
    '  mipmaps:',
    '    enableMipMap: 0',
    '  alphaIsTransparency: 1',
    '  textureType: 8',
    '  spriteMode: 2',
    '  spritePixelsToUnits: 100',
    '  spriteSheet:',
    '    serializedVersion: 2',
    ...(sheet.length ? ['    sprites:', ...sheet] : ['    sprites: []']),
    '    outline: []',
    '    physicsShape: []',
    '    bones: []',
    '    spriteID: ',
    '    internalID: 0',
    '    vertices: []',
    '    indices: ',
    '    edges: []',
    '    weights: []',
    '  nameFileIdTable:',
    ...sprites.map((f, i) => `    ${yamlName(f.name)}: ${21300000 + i * 2}`),
    ''
  ].join('\n')
}

export function cocosPlist(s: SnippetSheet): string {
  const frames = used(s)
    .flatMap((a) => a.frames)
    .map((f) =>
      [
        `\t\t<key>${xmlEsc(f.name)}.png</key>`,
        '\t\t<dict>',
        '\t\t\t<key>aliases</key>',
        '\t\t\t<array/>',
        '\t\t\t<key>spriteOffset</key>',
        '\t\t\t<string>{0,0}</string>',
        '\t\t\t<key>spriteSize</key>',
        `\t\t\t<string>{${f.w},${f.h}}</string>`,
        '\t\t\t<key>spriteSourceSize</key>',
        `\t\t\t<string>{${f.w},${f.h}}</string>`,
        '\t\t\t<key>textureRect</key>',
        `\t\t\t<string>{{${f.x},${f.y}},{${f.w},${f.h}}}</string>`,
        '\t\t\t<key>textureRotated</key>',
        '\t\t\t<false/>',
        '\t\t</dict>'
      ].join('\n')
    )
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    '\t<dict>',
    '\t\t<key>frames</key>',
    '\t\t<dict>',
    ...frames,
    '\t\t</dict>',
    '\t\t<key>metadata</key>',
    '\t\t<dict>',
    '\t\t\t<key>format</key>',
    '\t\t\t<integer>3</integer>',
    '\t\t\t<key>pixelFormat</key>',
    '\t\t\t<string>RGBA8888</string>',
    '\t\t\t<key>premultiplyAlpha</key>',
    '\t\t\t<false/>',
    '\t\t\t<key>realTextureFileName</key>',
    `\t\t\t<string>${xmlEsc(s.image)}</string>`,
    '\t\t\t<key>size</key>',
    `\t\t\t<string>{${s.w},${s.h}}</string>`,
    '\t\t\t<key>textureFileName</key>',
    `\t\t\t<string>${xmlEsc(s.image)}</string>`,
    '\t\t</dict>',
    '\t</dict>',
    '</plist>',
    ''
  ].join('\n')
}
