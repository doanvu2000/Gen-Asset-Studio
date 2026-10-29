import type { ReactElement } from 'react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { Icon } from '@renderer/components/Icon'
import { Logo } from '@renderer/components/Logo'
import { useApp } from '@renderer/store/app'
import { EASE } from '@renderer/lib/motion'

const STEPS = ['perm', 'codex', 'path', 'longPath', 'login', 'quota', 'workspace'] as const

export function SetupScreen(): ReactElement {
  const { t } = useTranslation()
  const navigate = useApp((s) => s.navigate)
  const done = 0

  return (
    <main className="setup">
      <div className="setup-card">
        <div className="setup-hero">
          <Logo />
          <div>
            <h1>{t('setup.title')}</h1>
            <p>{t('setup.intro')}</p>
          </div>
        </div>
        <div className="setup-prog">
          <div className="bar big">
            <i style={{ width: `${(done / STEPS.length) * 100}%` }} />
          </div>
          <span>
            {done}/{STEPS.length}
          </span>
        </div>
        <ol className="steps-v">
          {STEPS.map((key, i) => (
            <motion.li
              key={key}
              className="srow"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE, delay: 0.04 + i * 0.03 }}
            >
              <div className="sic">{i + 1}</div>
              <div>
                <div className="st-title">
                  {t(`setup.steps.${key}.title`)}
                  {key === 'longPath' && (
                    <span className="chip c-gray">
                      <Icon name="shield" size={11} />
                      {t('setup.admin')}
                    </span>
                  )}
                </div>
                <div className="st-desc">{t(`setup.steps.${key}.desc`)}</div>
              </div>
            </motion.li>
          ))}
        </ol>
        <div className="setup-foot">
          <div className="grow" />
          <button type="button" className="btn lg" disabled>
            {t('setup.start')}
          </button>
          <button type="button" className="btn primary lg" onClick={() => navigate('workspace')}>
            {t('setup.enter')}
            <Icon name="right" size={14} />
          </button>
        </div>
      </div>
    </main>
  )
}
