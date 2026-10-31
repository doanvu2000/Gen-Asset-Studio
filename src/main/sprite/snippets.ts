import type { FrameRect, GridSpec, SheetSnippets, SpriteAnim } from '@shared/sprite'

export interface SnippetSheet {
  image: string
  w: number
  h: number
  grid: GridSpec
  frames: FrameRect[]
  anims: SpriteAnim[]
}

function animKey(a: SpriteAnim): string {
  return a.dir ? `${a.name}_${a.dir}` : a.name
}

function frameName(a: SpriteAnim, i: number): string {
  return `${animKey(a)}_${String(i).padStart(2, '0')}`
}

export function atlasJson(s: SnippetSheet): string {
  const frames: unknown[] = []
  const animations: Record<string, string[]> = {}
  for (const a of s.anims) {
    animations[animKey(a)] = []
    a.frames.forEach((idx, i) => {
      const f = s.frames[idx]
      if (!f) return
      const name = frameName(a, i)
      animations[animKey(a)].push(name)
      frames.push({
        filename: name,
        frame: { x: f.x, y: f.y, w: f.w, h: f.h },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: f.w, h: f.h },
        sourceSize: { w: f.w, h: f.h },
        pivot: { x: 0.5, y: 1 }
      })
    })
  }
  return JSON.stringify(
    {
      frames,
      animations,
      meta: { app: 'Gen Asset Studio', version: '1.0', image: s.image, format: 'RGBA8888', size: { w: s.w, h: s.h }, scale: '1' }
    },
    null,
    2
  )
}

function rowOf(s: SnippetSheet, a: SpriteAnim): number {
  const f = s.frames[a.frames[0] ?? 0]
  return f ? Math.round((f.y - s.grid.offsetY) / (s.grid.cellH + s.grid.gapY)) : 0
}

function pascal(file: string): string {
  return file
    .replace(/.png$/i, '')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((p) => p[0].toUpperCase() + p.slice(1))
    .join('') || 'Sprite'
}

export function buildSnippets(s: SnippetSheet): SheetSnippets {
  const { cellW, cellH } = s.grid
  const json = s.image.replace(/\.png$/i, '.json')
  const flame = [
    "import 'package:flame/cache.dart';",
    "import 'package:flame/components.dart';",
    "import 'package:flame/sprite.dart';",
    '',
    `Future<Map<String, SpriteAnimation>> load${pascal(s.image)}Animations(Images images) async {`,
    `  final sheet = SpriteSheet(image: await images.load('${s.image}'), srcSize: Vector2(${cellW}.0, ${cellH}.0));`,
    '  return {',
    ...s.anims.map((a) => `    '${animKey(a)}': sheet.createAnimation(row: ${rowOf(s, a)}, stepTime: ${(1 / a.fps).toFixed(3)}, to: ${a.frames.length}${a.loop === 'once' ? ', loop: false' : ''}),`),
    '  };',
    '}'
  ].join('\n')
  const android = [
    'import android.graphics.Bitmap',
    '',
    `object ${pascal(s.image)}Sheet {`,
    `    const val CELL_W = ${cellW}`,
    `    const val CELL_H = ${cellH}`,
    `    val anims = mapOf(${s.anims.map((a) => `"${animKey(a)}" to Triple(${rowOf(s, a)}, ${a.frames.length}, ${a.fps})`).join(', ')})`,
    '',
    '    fun frames(sheet: Bitmap, anim: String): List<Bitmap> {',
    '        val (row, count, _) = anims.getValue(anim)',
    '        return (0 until count).map { c -> Bitmap.createBitmap(sheet, c * CELL_W, row * CELL_H, CELL_W, CELL_H) }',
    '    }',
    '}'
  ].join('\n')
  const ios = [
    'import SpriteKit',
    '',
    `enum ${pascal(s.image)}Sheet {`,
    `    static let texture = SKTexture(imageNamed: "${s.image.replace(/\.png$/i, '')}")`,
    `    static let size = CGSize(width: ${s.w}, height: ${s.h})`,
    `    static let cell = CGSize(width: ${cellW}, height: ${cellH})`,
    `    static let anims: [String: (row: Int, count: Int, fps: Double)] = [${s.anims.map((a) => `"${animKey(a)}": (${rowOf(s, a)}, ${a.frames.length}, ${a.fps})`).join(', ')}]`,
    '',
    '    static func frames(_ anim: String) -> [SKTexture] {',
    '        guard let a = anims[anim] else { return [] }',
    '        texture.filteringMode = .nearest',
    '        return (0..<a.count).map { c in',
    '            let x = CGFloat(c) * cell.width / size.width',
    '            let y = 1 - CGFloat(a.row + 1) * cell.height / size.height',
    '            return SKTexture(rect: CGRect(x: x, y: y, width: cell.width / size.width, height: cell.height / size.height), in: texture)',
    '        }',
    '    }',
    '',
    '    static func action(_ anim: String) -> SKAction {',
    '        let fps = anims[anim]?.fps ?? 10',
    '        return .repeatForever(.animate(with: frames(anim), timePerFrame: 1 / fps))',
    '    }',
    '}'
  ].join('\n')
  return { image: s.image, json, flame, android, ios }
}

export function snippetsMarkdown(sn: SheetSnippets, title: string): string {
  return [
    `# ${title}`,
    '',
    `- Sheet: \`${sn.image}\``,
    `- Atlas (TexturePacker JSON array, có \`animations\`): \`${sn.json}\``,
    '',
    '## Flutter · Flame',
    '',
    '```dart',
    sn.flame,
    '```',
    '',
    '## Android · Kotlin',
    '',
    '```kotlin',
    sn.android,
    '```',
    '',
    '## iOS · SpriteKit (Swift)',
    '',
    '```swift',
    sn.ios,
    '```',
    ''
  ].join('\n')
}
