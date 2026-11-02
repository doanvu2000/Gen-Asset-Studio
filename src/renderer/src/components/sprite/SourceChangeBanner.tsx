import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { SpriteProjectView, StripView } from '@shared/sprite'
import { Icon } from '@renderer/components/Icon'
import { genTargets } from '@renderer/lib/sprite'
import { useSprite } from '@renderer/store/sprite'

export function SourceChangeBanner({ v }: { v: SpriteProjectView }): ReactElement | null {
  const { t } = useTranslation()
  const regen = useSprite((s) => s.regenSource)
  const [busy, setBusy] = useState(false)
  const targets = genTargets(v)
  const changed = targets.filter((s) => s.source?.state === 'sourceChanged')
  const layout = targets.filter((s) => s.source?.state === 'layoutChanged')
  const missing = targets.filter((s) => s.source?.state === 'missing')
  if (!changed.length && !layout.length && !missing.length) return null
  const approved = changed.filter((s) => s.decision === 'approved').length
  const run = async (): Promise<void> => {
    setBusy(true)
    try {
      await regen()
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="src-banners">
      {changed.length > 0 && (
        <div className="note warn src-banner">
          <Icon name="alert" size={14} />
          <span>
            <b>{t('spriteSource.changedTitle', { count: changed.length })}</b> {t('spriteSource.changedHint')}
            {approved > 0 && <small>{t('spriteSource.approvedWarn', { count: approved })}</small>}
          </span>
          <button type="button" className="btn sm" disabled={busy} onClick={() => void run()}>
            {busy ? <span className="spin" /> : <Icon name="refresh" size={13} />}
            {t('spriteSource.regen')}
          </button>
        </div>
      )}
      {layout.length > 0 && (
        <div className="note warn src-banner">
          <Icon name="alert" size={14} />
          <span>
            <b>{t('spriteSource.layoutTitle', { count: layout.length })}</b> {t('spriteSource.layoutHint')}
          </span>
        </div>
      )}
      {missing.length > 0 && (
        <div className="note err src-banner">
          <Icon name="alert" size={14} />
          <span>
            <b>{t('spriteSource.missingTitle', { count: missing.length })}</b> {t('spriteSource.missingHint')}
          </span>
        </div>
      )}
    </div>
  )
}

export function StripSourceBadge({ strip }: { strip: StripView }): ReactElement | null {
  const { t } = useTranslation()
  const src = strip.source
  if (!src) return null
  const tip = t(`spriteSource.badgeTip.${src.state}`, { frames: src.frames.map((i) => i + 1).join(', ') })
  return (
    <span className={src.state === 'missing' ? 'src-badge err' : 'src-badge'} title={tip}>
      <Icon name="alert" size={11} />
      {t(`spriteSource.badge.${src.state}`)}
    </span>
  )
}
