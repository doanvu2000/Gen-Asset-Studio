import type { QaSummary } from './queue'
import type { SpriteStyle } from './sprite'

export interface SpineAtlasPage {
  name: string
  w: number
  h: number
  pma: boolean
}

export interface SpineRegion {
  name: string
  page: string
  x: number
  y: number
  w: number
  h: number
  degrees: 0 | 90
  offsetX: number
  offsetY: number
  origW: number
  origH: number
}

export interface SpineAtlasData {
  pages: SpineAtlasPage[]
  regions: SpineRegion[]
}

export type SpineAttachmentKind = 'region' | 'mesh' | 'linkedmesh' | 'other'

export interface SpineAttachmentRef {
  skin: string
  slot: string
  name: string
  region: string
  kind: SpineAttachmentKind
}

export interface SpineSkeletonInfo {
  version: string
  bones: Array<{ name: string; parent: string | null }>
  slots: Array<{ name: string; bone: string; attachment: string | null }>
  skins: string[]
  animations: string[]
  attachments: SpineAttachmentRef[]
  width: number
  height: number
}

export type SpineDecision = 'approved' | 'rejected'

export interface SpineRegionView extends SpineRegion {
  key: string
  assetRel: string
  sourceUrl: string | null
  slots: string[]
  skins: string[]
  kinds: SpineAttachmentKind[]
  versions: number[]
  selected: number
  url: string | null
  decision: SpineDecision | null
  qa: QaSummary | null
  used: boolean
}

export interface SpineBoneEdit {
  x?: number
  y?: number
  rotation?: number
  scaleX?: number
  scaleY?: number
}

export interface SpineAttachmentEdit {
  x?: number
  y?: number
  rotation?: number
  scaleX?: number
  scaleY?: number
}

export interface SpineRig {
  bones: Record<string, SpineBoneEdit>
  attachments: Record<string, SpineAttachmentEdit>
}

export const EMPTY_RIG: SpineRig = { bones: {}, attachments: {} }

export function attachmentKey(skin: string, slot: string, name: string): string {
  return `${skin}/${slot}/${name}`
}

export interface SpineExportState {
  outDir: string
  lastAt: number
  lastPages: number
  lastRegions: number
}

export interface SpineProjectView {
  rel: string
  name: string
  dir: string
  kind: 'spine'
  loaded: boolean
  skeletonPath: string | null
  atlasPath: string | null
  skeletonName: string | null
  status: 'ok' | 'missing' | 'changed' | 'none'
  error: string | null
  skeleton: SpineSkeletonInfo | null
  pages: Array<SpineAtlasPage & { url: string | null; path: string | null }>
  regions: SpineRegionView[]
  style: SpriteStyle
  rig: SpineRig
  export: SpineExportState
  updatedAt: number
}

export interface SpineAssets {
  skeletonName: string
  atlasName: string
  json: string
  atlas: string
  pages: Record<string, string>
}

export interface SpineImportResult {
  view: SpineProjectView | null
  error: string | null
  canceled: boolean
}

export interface SpineExportResult {
  ok: boolean
  outDir: string
  pages: Array<{ name: string; regions: number; kept: number }>
  skeleton: string | null
  rigChanged: boolean
  backupDir: string | null
  error: string | null
}

export interface SpineRegionPatch {
  decision?: SpineDecision | null
  selected?: number | null
}

export const SPINE_IPC = {
  open: 'spine:open',
  importDialog: 'spine:import-dialog',
  importPaths: 'spine:import-paths',
  clear: 'spine:clear',
  assets: 'spine:assets',
  setStyle: 'spine:set-style',
  addRefs: 'spine:add-refs',
  enqueue: 'spine:enqueue',
  review: 'spine:review',
  setRig: 'spine:set-rig',
  exportRun: 'spine:export-run',
  exportDir: 'spine:export-dir'
} as const

export interface SpineApi {
  open: (rel: string) => Promise<SpineProjectView | null>
  importDialog: (rel: string) => Promise<SpineImportResult>
  importPaths: (rel: string, paths: string[]) => Promise<SpineImportResult>
  clear: (rel: string) => Promise<SpineProjectView | null>
  assets: (rel: string, which: 'orig' | 'new') => Promise<SpineAssets | null>
  setStyle: (rel: string, style: Partial<SpriteStyle>) => Promise<SpineProjectView | null>
  addRefs: (rel: string) => Promise<SpineProjectView | null>
  enqueue: (rel: string, keys: string[], note?: string) => Promise<number>
  review: (rel: string, patch: Record<string, SpineRegionPatch>) => Promise<SpineProjectView | null>
  setRig: (rel: string, rig: SpineRig) => Promise<SpineProjectView | null>
  exportRun: (rel: string, outDir: string) => Promise<SpineExportResult>
  exportDir: (rel: string) => Promise<string | null>
}
