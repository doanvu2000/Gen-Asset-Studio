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
}

export interface SpriteProjectView {
  rel: string
  name: string
  dir: string
  kind: 'sprite'
  settings: SpriteSettings
  sheets: SheetView[]
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
