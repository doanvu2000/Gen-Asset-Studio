import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { StyleTask } from '@shared/style'
import { useApp } from '@renderer/store/app'
import { useStyle } from '@renderer/store/style'
import { modelLabel } from '@renderer/lib/files'
import { Icon } from './Icon'

export function ModelChip({ task }: { task: StyleTask }): ReactElement {
  const { t } = useTranslation()
  const m = useStyle((s) => s.models[task])
  const list = useStyle((s) => s.modelList)
  const openSettings = useApp((s) => s.openSettings)
  return (
    <button type="button" className="mchip" title={t('gen.modelHint')} onClick={() => openSettings('gen')}>
      <Icon name="gear" size={11} />
      {modelLabel(m.model, list)} · {m.effort}
    </button>
  )
}
