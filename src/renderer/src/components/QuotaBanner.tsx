import type { ReactElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { useQueue } from '@renderer/store/queue'
import { clock } from '@renderer/lib/files'
import { fadeTransition } from '@renderer/lib/motion'
import { useNow } from '@renderer/lib/useNow'
import { Icon } from './Icon'

export function quotaRemaining(quota: { resumeAt: number | null; remainingMs: number | null } | null, at: number, now: number): number | null {
  if (!quota) return null
  if (quota.resumeAt) return Math.max(0, quota.resumeAt - now)
  if (quota.remainingMs !== null) return Math.max(0, quota.remainingMs - (now - at))
  return null
}

export function QuotaBanner({ compact }: { compact?: boolean }): ReactElement {
  const { t } = useTranslation()
  const snap = useQueue((s) => s.snap)
  const quota = useQueue((s) => s.quota)
  const at = useQueue((s) => s.quotaAt)
  const quotaPaused = snap?.pauseReason === 'quota'
  const userPaused = !!snap?.paused && snap.pauseReason === 'user'
  const now = useNow(quotaPaused)
  const left = quotaRemaining(quota, at, now)

  return (
    <AnimatePresence initial={false}>
      {quotaPaused && (
        <motion.div key="q" className={compact ? 'quota-banner compact' : 'quota-banner'} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={fadeTransition}>
          <Icon name="clock" size={compact ? 16 : 20} />
          <div className="qb-t">
            <b>{t('queue.quotaTitle')}</b>
            {!compact && <span className="muted">{t('queue.quotaDesc')}</span>}
          </div>
          <span className="cd" title={t('queue.resumeIn')}>
            {left !== null ? clock(left) : '--:--:--'}
          </span>
          <button type="button" className="btn sm" onClick={() => void window.gas.queue.resume()}>
            <Icon name="play" size={12} />
            {t('queue.tryNow')}
          </button>
        </motion.div>
      )}
      {userPaused && (
        <motion.div key="u" className={compact ? 'pause-banner compact' : 'pause-banner'} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={fadeTransition}>
          <Icon name="pause" size={compact ? 16 : 18} />
          <div className="qb-t">
            <b>{t('queue.pausedTitle')}</b>
            {!compact && <span className="muted">{t('queue.pausedDesc')}</span>}
          </div>
          <button type="button" className="btn sm primary" onClick={() => void window.gas.queue.resume()}>
            <Icon name="play" size={12} />
            {t('queue.resumeAll')}
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  )
}
