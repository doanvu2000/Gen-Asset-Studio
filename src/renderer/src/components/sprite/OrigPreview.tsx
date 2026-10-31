import type { ReactElement } from 'react'
import type { StripView } from '@shared/sprite'
import { StripPreview } from './StripPreview'

export interface OrigPreviewProps {
  strip: StripView
  pos: number
  size?: number
  zoom?: number
  guides?: boolean
  className?: string
}

export function OrigPreview({ strip, pos, size = 96, zoom, guides, className }: OrigPreviewProps): ReactElement {
  if (strip.created) {
    const bw = Math.max(1, ...strip.frameSizes.map((f) => f.w))
    const bh = Math.max(1, ...strip.frameSizes.map((f) => f.h))
    const scale = zoom ?? Math.min(size / bw, size / bh)
    const w = Math.round(bw * scale)
    const h = Math.round(bh * scale)
    return (
      <span className={className ? `strip-ref ${className}` : 'strip-ref'} style={{ width: w, height: h }}>
        {strip.refUrl && <img src={strip.refUrl} alt="" draggable={false} />}
      </span>
    )
  }
  return <StripPreview url={strip.origUrl} sizes={strip.frameSizes} pos={pos} size={size} zoom={zoom} guides={guides} className={className} />
}
