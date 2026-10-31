import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { useApp } from '@renderer/store/app'
import { useQueue } from '@renderer/store/queue'
import { tDyn } from '@renderer/lib/env'
import orreryIcon from '@renderer/assets/promo/orrery-icon.png'
import orreryShot from '@renderer/assets/promo/orrery-shot.webp'
import aiasIcon from '@renderer/assets/promo/aias-icon.png'
import aiasShot from '@renderer/assets/promo/aias-shot.webp'
import hfIcon from '@renderer/assets/promo/hf-icon.png'
import hfShot from '@renderer/assets/promo/hf-shot.webp'
import { Icon } from './Icon'

export type PromoAppId = 'aias' | 'hyperframes' | 'orrery'

interface PromoApp {
  id: PromoAppId
  name: string
  url: string
  icon: string
  shot: string
  platforms: string
}

export const PROMO_APPS: PromoApp[] = [
  { id: 'aias', name: 'AI Asset Studio', url: 'https://github.com/doanvu2000/AI-Asset-Studio', icon: aiasIcon, shot: aiasShot, platforms: 'Windows' },
  { id: 'hyperframes', name: 'HyperFrames Studio', url: 'https://github.com/doanvu2000/hyper-frames', icon: hfIcon, shot: hfShot, platforms: 'Windows · macOS' },
  { id: 'orrery', name: 'Orrery', url: 'https://github.com/JLSoft-Together/Claude-Code-Monitor', icon: orreryIcon, shot: orreryShot, platforms: 'Windows · macOS' }
]

const appOf = (id: PromoAppId): PromoApp => PROMO_APPS.find((a) => a.id === id) as PromoApp

function openApp(app: PromoApp): void {
  window.open(app.url, '_blank', 'noopener')
}

function useQueueBusy(): boolean {
  return useQueue((s) => (s.snap ? s.snap.running + s.snap.queued > 0 : false))
}

export function AboutTab(): ReactElement {
  const { t } = useTranslation()
  return (
    <>
      <p className="promo-lead muted">{t('promo.lead')}</p>
      <div className="promo-cards">
        {PROMO_APPS.map((app) => (
          <article key={app.id} className="promo-card">
            <button type="button" className="promo-shot" onClick={() => openApp(app)} aria-label={app.name}>
              <img src={app.shot} alt="" draggable={false} />
            </button>
            <div className="promo-body">
              <div className="promo-h">
                <img className="promo-icon" src={app.icon} alt="" draggable={false} />
                <div>
                  <b>{app.name}</b>
                  <span className="muted">{app.platforms}</span>
                </div>
              </div>
              <p>{tDyn(t, `promo.apps.${app.id}.desc`)}</p>
              <button type="button" className="btn sm" onClick={() => openApp(app)}>
                <Icon name="external" size={13} />
                {t('promo.github')}
              </button>
            </div>
          </article>
        ))}
      </div>
    </>
  )
}

export function PromoHint({ hintId, appId }: { hintId: string; appId: PromoAppId }): ReactElement | null {
  const { t } = useTranslation()
  const hints = useApp((s) => s.settings.promo.hints)
  const dismissed = useApp((s) => s.settings.promo.dismissed)
  const dismiss = useApp((s) => s.dismissPromo)
  const busy = useQueueBusy()
  const [eligible] = useState(() => hints && !dismissed.includes(hintId) && !busy)
  const [closed, setClosed] = useState(false)

  useEffect(() => {
    if (!eligible) return
    const timer = window.setTimeout(() => void dismiss(hintId), 1500)
    return () => window.clearTimeout(timer)
  }, [eligible, dismiss, hintId])

  if (!eligible || closed || !hints) return null
  const app = appOf(appId)
  return (
    <div className="promo-hint" role="note">
      <img className="promo-icon sm" src={app.icon} alt="" draggable={false} />
      <div className="promo-hint-t">
        <span>{tDyn(t, `promo.hint.${hintId}`)}</span>
        <button type="button" className="link-btn" onClick={() => openApp(app)}>
          {app.name}
          <Icon name="external" size={11} />
        </button>
      </div>
      <button type="button" className="icon-btn" aria-label={t('promo.close')} title={t('promo.close')} onClick={() => setClosed(true)}>
        <Icon name="x" size={12} />
      </button>
    </div>
  )
}

export function PromoFooter(): ReactElement | null {
  const { t } = useTranslation()
  const hints = useApp((s) => s.settings.promo.hints)
  const openSettings = useApp((s) => s.openSettings)
  if (!hints) return null
  return (
    <button type="button" className="promo-footer" onClick={() => openSettings('about')}>
      <span className="muted">{t('promo.footer')}</span>
      {PROMO_APPS.map((app) => (
        <span key={app.id} className="promo-footer-app">
          <img className="promo-icon xs" src={app.icon} alt="" draggable={false} />
          {app.name}
        </span>
      ))}
    </button>
  )
}

export function SplashPromo(): ReactElement | null {
  const { t } = useTranslation()
  const hints = useApp((s) => s.settings.promo.hints)
  if (!hints) return null
  return (
    <div className="splash-promo" aria-label={t('promo.footer')}>
      <span>{t('promo.footer')}</span>
      {PROMO_APPS.map((app) => (
        <img key={app.id} src={app.icon} alt={app.name} title={app.name} draggable={false} />
      ))}
    </div>
  )
}
