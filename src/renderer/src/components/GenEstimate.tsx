import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useEnv } from '@renderer/store/env'
import { Icon } from './Icon'

// Ước lượng thô, app không lưu usedPercent trước/sau mỗi lượt để học số thật.
const PCT_5H_PER_TURN = 1.5

const left = (used: number): number => Math.max(0, Math.min(100, Math.round(100 - used)))

export function GenEstimate({ turns, hideTurns }: { turns: number; hideTurns?: boolean }): ReactElement | null {
  const { t } = useTranslation()
  const rl = useEnv((s) => s.rateLimits)
  if (turns <= 0) return null
  const five = rl?.primary ? left(rl.primary.usedPercent) : null
  const week = rl?.secondary ? left(rl.secondary.usedPercent) : null
  const exhausted = five === 0 || week === 0
  const over = five !== null && turns * PCT_5H_PER_TURN > five
  const quota = [five !== null && t('genEstimate.left5h', { left: five }), week !== null && t('genEstimate.leftWeek', { left: week })].filter(Boolean).join(' · ')

  return (
    <span className="gen-est">
      {!hideTurns && <b>{t('genEstimate.turns', { count: turns })}</b>}
      {quota && <span className="muted">{hideTurns ? quota : ` · ${quota}`}</span>}
      {(exhausted || over) && (
        <span className="gen-est-warn">
          <Icon name="alert" size={11} />
          {t(exhausted ? 'genEstimate.exhausted' : 'genEstimate.mayHit')}
        </span>
      )}
    </span>
  )
}
