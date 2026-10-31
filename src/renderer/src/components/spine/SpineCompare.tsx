import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { SpinePlayer } from '@esotericsoftware/spine-player'
import type { SpineAssets } from '@shared/spine'
import { SpinePreview, ViewerControls, type ViewerState } from './SpinePreview'

interface Props {
  viewer: ViewerState
  orig: SpineAssets | null
  next: SpineAssets | null
  highlightSlots?: string[]
  height?: number
  single?: 'orig' | 'new'
  onNewPlayer?: (p: SpinePlayer | null) => void
}

export function SpineCompare({ viewer: v, orig, next, highlightSlots, height = 340, single, onNewPlayer }: Props): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="spc">
      <ViewerControls v={v} />
      <div className={single ? 'spc-stage one' : 'spc-stage'}>
        {single !== 'new' && (
          <SpinePreview
            assets={orig}
            animation={v.animation}
            skin={v.skin}
            time={v.time}
            showBones={v.bones}
            highlightSlots={highlightSlots}
            background={v.bg}
            height={height}
            label={single ? undefined : t('spineProject.preview.orig')}
            onReady={v.setInfo}
          />
        )}
        {single !== 'orig' && (
          <SpinePreview
            assets={next}
            animation={v.animation}
            skin={v.skin}
            time={v.time}
            showBones={v.bones}
            highlightSlots={highlightSlots}
            background={v.bg}
            height={height}
            label={single ? undefined : t('spineProject.preview.new')}
            onReady={single === 'new' ? v.setInfo : undefined}
            onPlayer={onNewPlayer}
          />
        )}
      </div>
    </div>
  )
}
