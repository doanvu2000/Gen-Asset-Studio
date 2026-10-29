import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { FixSource } from '@shared/types'
import { useEnv } from '@renderer/store/env'
import { retryTarget } from '@renderer/lib/env'
import { Icon } from './Icon'

interface ErrorActionsProps {
  source: FixSource
  target: string
  error: string
  compact?: boolean
}

export function ErrorActions({ source, target, error, compact }: ErrorActionsProps): ReactElement {
  const { t } = useTranslation()
  const fixAvailable = useEnv((s) => s.fixAvailable)
  const openFix = useEnv((s) => s.openFix)
  const size = compact ? 12 : 13

  return (
    <div className="st-extra">
      <button type="button" className="btn sm" onClick={() => void retryTarget(target)}>
        <Icon name="refresh" size={size} />
        {compact ? t('env.act.retry') : t('setup.retry')}
      </button>
      {fixAvailable && (
        <button type="button" className="btn sm primary" onClick={() => void openFix({ source, target, error })}>
          <Icon name="sparkles" size={size} />
          {compact ? t('env.act.sendFix') : t('setup.sendFix')}
        </button>
      )}
      {!compact && (
        <button type="button" className="btn sm ghost" onClick={() => void window.gas.app.exportLog()}>
          <Icon name="download" size={size} />
          {t('setup.exportLog')}
        </button>
      )}
    </div>
  )
}
