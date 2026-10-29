export type Rgb = readonly [number, number, number]

export interface RawImage {
  data: Uint8Array
  width: number
  height: number
}

export type ImageInput = Uint8Array | string

export type ChromaName = 'magenta' | 'green' | 'blue' | 'cyan' | 'yellow'

export interface ChromaColor {
  name: ChromaName
  hex: string
  rgb: Rgb
}

export interface ChromaScore {
  name: ChromaName
  hex: string
  p1Distance: number
  nearFraction: number
  score: number
}

export interface ChromaPick extends ChromaColor {
  promptName: string
  scores: ChromaScore[]
  hueHistogram: number[]
  sampledPixels: number
}

export interface PickChromaOptions {
  candidates?: ChromaName[]
  nearDistance?: number
}

export type HoleMode = 'outside-only' | 'auto' | 'all'

export interface RemoveBackgroundOptions {
  holes?: HoleMode
  hardTolerance?: number
  bandWidth?: number
  minHoleArea?: number
  softGlow?: boolean
  glowSlope?: number
  glowMaxAlpha?: number
  glowColorStep?: number
}

export interface RemoveBackgroundInfo {
  bg: Rgb
  bgNoiseP99: number
  hardTolerance: number
  outsidePixels: number
  holesKeyed: number
  holesKept: number
  bandPixels: number
  unmixedPixels: number
  glowPixels: number
}

export interface Box {
  x: number
  y: number
  w: number
  h: number
}

export interface ExtractOptions {
  alphaThreshold?: number
  nearDistance?: number
  minArea?: number
  padding?: number
}

export interface ExtractInfo {
  components: number
  kept: number
  dropped: number
  mainArea: number
  bbox: Box
}

export type Side = 'left' | 'right' | 'top' | 'bottom'

export interface FitOptions {
  margin?: number
  nineSlice?: boolean | 'auto'
  edgeAnchored?: Side[] | 'auto'
  name?: string
}

export interface SliceInfo {
  axis: 'x' | 'y'
  start: number
  end: number
  uniform: boolean
}

export interface FitInfo {
  mode: 'uniform' | 'nine-slice'
  nineSliceGuess: boolean
  scale: number
  target: Box
  placed: Box
  edgeAnchored: Side[]
  slice: SliceInfo | null
}

export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface QaCheck {
  id: 'size' | 'alpha' | 'edges' | 'fill' | 'chroma' | 'coverage'
  status: CheckStatus
  value: number
  threshold: number
  message: string
}

export interface QaReport {
  pass: boolean
  checks: QaCheck[]
}

export interface QaOptions {
  edgeAlphaMax?: number
  edgeAnchored?: Side[]
  minFill?: number
  chroma?: Rgb
  chromaDistance?: number
  chromaMaxRatio?: number
  minCoverage?: number
}

export type ScaleFactor = 1 | 2 | 4

export interface ProcessOptions {
  chroma?: ChromaColor | string
  removeBackground?: RemoveBackgroundOptions
  extract?: ExtractOptions
  fit?: FitOptions
  qa?: QaOptions
  scale?: ScaleFactor
  debugImages?: boolean
}

export interface ProcessInput {
  ai: ImageInput
  original: ImageInput
  options?: ProcessOptions
}

export interface ProcessDebug {
  background: RemoveBackgroundInfo
  extract: ExtractInfo
  fit: FitInfo
  timingsMs: Record<string, number>
  images?: {
    keyed: Uint8Array
    block: Uint8Array
  }
}

export interface ProcessResult {
  png: Uint8Array
  png1x: Uint8Array
  width: number
  height: number
  qa: QaReport
  debug: ProcessDebug
}
