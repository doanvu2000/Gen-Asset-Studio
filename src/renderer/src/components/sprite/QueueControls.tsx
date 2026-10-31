import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon } from '../Icon'

export function QueueControls({ count, paused, dir }: { count: number; paused: boolean; dir: string }): ReactElement | null {
  const { t } = useTranslation()
  if (!count) return null
  return (
    <span className="q-ctl">
      {paused ? (
        <span className="chip c-orange">
          <Icon name="pause" size={10} />
          {t('spriteProject.gen.activePaused', { count })}
        </span>
      ) : (
        <span className="chip c-blue">
          <span className="spin sm" />
          {t('spriteProject.gen.active', { count })}
        </span>
      )}
      <button
        type="button"
        className="icon-btn"
        aria-label={paused ? t('spriteProject.gen.resume') : t('spriteProject.gen.pause')}
        title={paused ? t('spriteProject.gen.resume') : t('spriteProject.gen.pause')}
        onClick={() => void (paused ? window.gas.queue.resume() : window.gas.queue.pause())}
      >
        <Icon name={paused ? 'play' : 'pause'} size={14} />
      </button>
      <button type="button" className="icon-btn danger" aria-label={t('spriteProject.gen.cancel')} title={t('spriteProject.gen.cancel')} onClick={() => void window.gas.queue.cancelAll(dir)}>
        <Icon name="x" size={14} />
      </button>
    </span>
  )
}
