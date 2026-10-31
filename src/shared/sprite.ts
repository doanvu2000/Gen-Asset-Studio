export type ProjectKind = 'reskin' | 'sprite' | 'spine'
export const PROJECT_KINDS: readonly ProjectKind[] = ['reskin', 'sprite', 'spine']
export const READY_KINDS: readonly ProjectKind[] = ['reskin', 'sprite']

export type AtlasFormat = 'tp-hash' | 'tp-array' | 'aseprite' | 'plist' | 'unity' | 'grid'

export interface FrameRect {
  name: string
  x: number
  y: number
  w: number
  h: number
  rotated: boolean
  trimmed: boolean
  srcX: number
  srcY: number
  srcW: number
  srcH: number
  pivotX: number
  pivotY: number
}

export type TagDirection = 'forward' | 'reverse' | 'pingpong'

export interface AtlasTag {
  name: string
  from: number
  to: number
  direction: TagDirection
}

export interface ParsedAtlas {
  format: AtlasFormat
  image: string | null
  width: number
  height: number
  frames: FrameRect[]
  tags: AtlasTag[]
  warnings: string[]
}

export interface GridSpec {
  cellW: number
  cellH: number
  cols: number
  rows: number
  offsetX: number
  offsetY: number
  gapX: number
  gapY: number
}

export type Direction = 'S' | 'SW' | 'W' | 'NW' | 'N' | 'NE' | 'E' | 'SE'
export type DirSet = 0 | 4 | 6 | 8

export const DIRECTIONS: Record<4 | 6 | 8, Direction[]> = {
  4: ['S', 'W', 'E', 'N'],
  6: ['S', 'SW', 'NW', 'N', 'NE', 'SE'],
  8: ['S', 'SW', 'W', 'NW', 'N', 'NE', 'E', 'SE']
}

export const DIR_ANGLE: Record<Direction, number> = { E: 0, SE: 45, S: 90, SW: 135, W: 180, NW: 225, N: 270, NE: 315 }

export type RowPreset = 'flame' | 'rpgmaker' | 'custom'

export const ROW_PRESETS: Record<Exclude<RowPreset, 'custom'>, Record<4 | 6 | 8, Direction[]>> = {
  flame: DIRECTIONS,
  rpgmaker: {
    4: ['S', 'W', 'E', 'N'],
    6: ['S', 'SW', 'NW', 'N', 'NE', 'SE'],
    8: ['S', 'W', 'E', 'N', 'SW', 'SE', 'NW', 'NE']
  }
}

export type LoopMode = 'loop' | 'pingpong' | 'once'
export type ViewAngle = 'topdown' | 'iso' | 'side'

export interface SpriteAnim {
  id: string
  name: string
  dir: Direction | null
  frames: number[]
  fps: number
  loop: LoopMode
}

export interface SpriteSettings {
  dirSet: DirSet
  rowPreset: RowPreset
  rowOrder: Direction[]
  view: ViewAngle
  mirror: boolean
  cell: 64 | 128 | 256
}

export const DEFAULT_SPRITE_SETTINGS: SpriteSettings = {
  dirSet: 8,
  rowPreset: 'flame',
  rowOrder: DIRECTIONS[8],
  view: 'topdown',
  mirror: true,
  cell: 128
}

export type SheetStatus = 'ok' | 'missing' | 'changed'
export type SheetOrigin = 'import' | 'new'

export interface NewSheetAnim {
  name: string
  frames: number
}

export interface NewSheetSpec {
  name: string
  character: string
  description: string
  anims: NewSheetAnim[]
  cell: 64 | 128 | 256
}

export const NEW_ANIM_PRESETS: ReadonlyArray<{ name: string; frames: number; on: boolean }> = [
  { name: 'idle', frames: 4, on: true },
  { name: 'walk', frames: 6, on: true },
  { name: 'run', frames: 6, on: false },
  { name: 'attack', frames: 6, on: false },
  { name: 'hurt', frames: 3, on: false },
  { name: 'die', frames: 6, on: false }
]

export const NEW_MAX_FRAMES = 8

export interface PickedImage {
  path: string
  url: string
  w: number
  h: number
}

export interface SheetSnippets {
  image: string
  json: string
  flame: string
  android: string
  ios: string
}

export interface CreateSheetResult {
  view: SpriteProjectView | null
  sheetId: string | null
  error: string | null
}

export interface SheetView {
  id: string
  name: string
  path: string
  url: string
  thumb: string | null
  w: number
  h: number
  size: number
  status: SheetStatus
  atlasPath: string | null
  atlasName: string | null
  format: AtlasFormat
  grid: GridSpec | null
  frames: FrameRect[]
  empty: number[]
  anims: SpriteAnim[]
  warnings: string[]
  origin: SheetOrigin
  characterUrl: string | null
  description: string
}

export interface SpriteProjectView {
  rel: string
  name: string
  dir: string
  kind: 'sprite'
  settings: SpriteSettings
  sheets: SheetView[]
  style: SpriteStyle
  strips: StripView[]
  lockKey: string | null
  export: SpriteExportState
  updatedAt: number
}

export type SpriteSkipReason = 'notPng' | 'unreadable' | 'duplicate' | 'noImage' | 'badAtlas'

export interface SpriteSkipped {
  name: string
  reason: SpriteSkipReason
  detail?: string
}

export interface SpriteAddResult {
  view: SpriteProjectView | null
  added: number
  skipped: SpriteSkipped[]
  canceled: boolean
}

export interface SheetPatch {
  grid?: GridSpec
  anims?: SpriteAnim[]
  autoAnims?: boolean
}

export const SPRITE_IPC = {
  open: 'sprite:open',
  addDialog: 'sprite:add-dialog',
  addPaths: 'sprite:add-paths',
  remove: 'sprite:remove',
  updateSheet: 'sprite:update-sheet',
  detectGrid: 'sprite:detect-grid',
  setSettings: 'sprite:set-settings'
} as const

export interface SpriteApi {
  open: (rel: string) => Promise<SpriteProjectView | null>
  addDialog: (rel: string) => Promise<SpriteAddResult>
  addPaths: (rel: string, paths: string[]) => Promise<SpriteAddResult>
  remove: (rel: string, sheetId: string) => Promise<SpriteProjectView | null>
  updateSheet: (rel: string, sheetId: string, patch: SheetPatch) => Promise<SpriteProjectView | null>
  detectGrid: (rel: string, sheetId: string) => Promise<GridSpec | null>
  setSettings: (rel: string, patch: Partial<SpriteSettings>) => Promise<SpriteProjectView | null>
}

export interface SpriteJobSpec {
  sheetId: string
  animId: string
  anim: string
  dir: Direction | null
  view: ViewAngle
  frames: FrameRect[]
  lockImages: string[]
  create?: { character: string; description: string; cell: number }
}

export interface SpriteStyle {
  promptEn: string
  templateId: string | null
  refImages: string[]
  notes: string
  locked: boolean
  lockedAt: number
}

export const EMPTY_SPRITE_STYLE: SpriteStyle = { promptEn: '', templateId: null, refImages: [], notes: '', locked: false, lockedAt: 0 }

export type StripDecision = 'approved' | 'rejected'

export interface StripQaCheck {
  id: 'anchor' | 'height' | 'clipped' | 'missing' | 'duplicate' | 'cut'
  status: 'pass' | 'warn' | 'fail'
  value: number
  threshold: number
  frames: number[]
  message: string
}

export interface StripQa {
  pass: boolean
  checks: StripQaCheck[]
}

export interface FrameSize {
  w: number
  h: number
}

export interface StripVersion {
  version: number
  url: string
  createdAt: number
  note: string | null
  qa: StripQa | null
}

export interface StripView {
  key: string
  assetRel: string
  sheetId: string
  sheetName: string
  animId: string
  anim: string
  dir: Direction | null
  frameCount: number
  frameSizes: FrameSize[]
  origUrl: string | null
  mirrorOf: string | null
  versions: number[]
  selected: number
  url: string | null
  decision: StripDecision | null
  qa: StripQa | null
  created: boolean
  refUrl: string | null
}

export interface SpriteExportState {
  outDir: string
  lastAt: number
  lastSheets: number
  lastFrames: number
}

export interface SpriteStripPatch {
  decision?: StripDecision | null
  selected?: number | null
}

export interface SpriteExportResult {
  ok: boolean
  outDir: string
  sheets: Array<{ name: string; file: string; frames: number; kept: number; atlas: string | null; snippets: string | null }>
  backupDir: string | null
  error: string | null
}

export const SPRITE_GEN_IPC = {
  setStyle: 'sprite:set-style',
  addRefs: 'sprite:add-refs',
  setLock: 'sprite:set-lock',
  enqueue: 'sprite:enqueue',
  review: 'sprite:review',
  versions: 'sprite:versions',
  exportRun: 'sprite:export-run',
  exportDir: 'sprite:export-dir',
  reveal: 'sprite:reveal',
  pickCharacter: 'sprite:pick-character',
  createSheet: 'sprite:create-sheet',
  snippets: 'sprite:snippets'
} as const

export interface SpriteGenApi {
  setStyle: (rel: string, style: Partial<SpriteStyle>) => Promise<SpriteProjectView | null>
  addRefs: (rel: string) => Promise<SpriteProjectView | null>
  setLock: (rel: string, key: string | null) => Promise<SpriteProjectView | null>
  enqueue: (rel: string, keys: string[], note?: string) => Promise<number>
  review: (rel: string, patch: Record<string, SpriteStripPatch>) => Promise<SpriteProjectView | null>
  versions: (rel: string, key: string) => Promise<StripVersion[]>
  exportRun: (rel: string, outDir: string) => Promise<SpriteExportResult>
  exportDir: (rel: string) => Promise<string | null>
  reveal: (path: string) => Promise<void>
  pickCharacter: () => Promise<PickedImage | null>
  createSheet: (rel: string, spec: NewSheetSpec) => Promise<CreateSheetResult>
  snippets: (rel: string, sheetId: string) => Promise<SheetSnippets | null>
}

export function stripFrames(sizes: FrameSize[]): FrameRect[] {
  let x = 0
  return sizes.map((s, i) => {
    const f: FrameRect = { name: `f${i}`, x, y: 0, w: s.w, h: s.h, rotated: false, trimmed: false, srcX: 0, srcY: 0, srcW: s.w, srcH: s.h, pivotX: 0.5, pivotY: 1 }
    x += s.w
    return f
  })
}
