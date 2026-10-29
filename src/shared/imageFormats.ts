export const IMAGE_EXTS = ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.tif', '.tiff'] as const

export const IMAGE_EXT_NAMES: string[] = IMAGE_EXTS.map((e) => e.slice(1))

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.tif': 'image/tiff',
  '.tiff': 'image/tiff'
}

function extOf(file: string): string {
  const dot = file.lastIndexOf('.')
  const slash = Math.max(file.lastIndexOf('/'), file.lastIndexOf('\\'))
  return dot > slash ? file.slice(dot).toLowerCase() : ''
}

export function isImageFile(file: string): boolean {
  return extOf(file) in MIME
}

export function imageMime(file: string): string | null {
  return MIME[extOf(file)] ?? null
}

export type OutFormat = 'png' | 'jpeg' | 'webp' | 'avif' | 'tiff'

export function outFormatOf(file: string): OutFormat {
  const ext = extOf(file)
  if (ext === '.jpg' || ext === '.jpeg') return 'jpeg'
  if (ext === '.webp') return 'webp'
  if (ext === '.avif') return 'avif'
  if (ext === '.tif' || ext === '.tiff') return 'tiff'
  return 'png'
}
