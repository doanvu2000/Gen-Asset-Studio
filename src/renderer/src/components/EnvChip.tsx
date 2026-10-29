import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { EnvItemId, EnvState } from '@shared/types'
import { CHIP_COLOR, ENV_KIND } from '@renderer/lib/env'
import { Icon, type IconName } from './Icon'

const ICON: Record<EnvState, IconName> = {
  installed: 'check',
  installing: 'refresh',
  missing: 'clock',
  error: 'alert'
}

export function EnvChip({ id, state }: { id: EnvItemId; state: EnvState }): ReactElement {
  const { t } = useTranslation()
  return (
    <span className={`chip ${CHIP_COLOR[state]}`}>
      <Icon name={ICON[state]} size={11} className={state === 'installing' ? 'spinning' : undefined} />
      {t(`env.chip.${ENV_KIND[id]}.${state}`)}
    </span>
  )
}
