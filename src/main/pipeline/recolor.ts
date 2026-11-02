import { recolorPixels, type RecolorParams } from '@shared/recolor'
import { decode, encodePng } from './image'
import type { RawImage } from './types'

export { isRecolorIdentity, normalizeRecolor, type RecolorParams } from '@shared/recolor'

export function recolor(img: RawImage, params: RecolorParams): RawImage {
  const data = img.data.slice()
  recolorPixels(data, params)
  return { data, width: img.width, height: img.height }
}

export async function recolorPng(srcPath: string, params: RecolorParams): Promise<Uint8Array> {
  return encodePng(recolor(await decode(srcPath), params))
}
