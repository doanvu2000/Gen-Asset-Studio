import { useEffect, useRef, type ReactElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import type { Lang, ThemePref } from '@shared/types'
import { useApp } from '@renderer/store/app'
import { fadeTransition, sheetTransition } from '@renderer/lib/motion'
import { Icon } from './Icon'
import { Segmented } from './Segmented'

function GeneralTab(): ReactElement {
  const { t } = useTranslation()
  const theme = useApp((s) => s.settings.theme)
  const lang = useApp((s) => s.settings.lang)
  const setTheme = useApp((s) => s.setTheme)
  const setLang = useApp((s) => s.setLang)

  const themeOptions = [
    { value: 'light', label: t('settings.theme.light') },
    { value: 'dark', label: t('settings.theme.dark') },
    { value: 'system', label: t('settings.theme.system') }
  ] as const satisfies readonly { value: ThemePref; label: string }[]

  const langOptions = [
    { value: 'vi', label: t('settings.langs.vi') },
    { value: 'en', label: t('settings.langs.en') }
  ] as const satisfies readonly { value: Lang; label: string }[]

  return (
    <div className="group">
      <div className="row">
        <div className="rl">{t('settings.appearance')}</div>
        <Segmented value={theme} options={themeOptions} onChange={(v) => void setTheme(v)} ariaLabel={t('settings.appearance')} />
      </div>
      <div className="row">
        <div className="rl">{t('settings.language')}</div>
        <Segmented value={lang} options={langOptions} onChange={(v) => void setLang(v)} ariaLabel={t('settings.language')} />
      </div>
    </div>
  )
}

export function SettingsDialog(): ReactElement {
  const { t } = useTranslation()
  const open = useApp((s) => s.settingsOpen)
  const close = useApp((s) => s.closeSettings)
  const sheetRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    sheetRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, close])

  return (
    <AnimatePresence>
      {open && (
        <div className="modal-root" key="settings">
          <motion.div
            className="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fadeTransition}
            onClick={close}
          />
          <motion.div
            ref={sheetRef}
            tabIndex={-1}
            className="sheet settings"
            role="dialog"
            aria-modal="true"
            aria-label={t('settings.title')}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: fadeTransition }}
            transition={sheetTransition}
          >
            <header role="tablist">
              <button type="button" className="stab on" role="tab" aria-selected="true">
                <Icon name="gear" size={20} />
                {t('settings.tabs.general')}
              </button>
              <button type="button" className="icon-btn set-close" aria-label={t('settings.close')} onClick={close}>
                <Icon name="x" />
              </button>
            </header>
            <div className="set-b" role="tabpanel">
              <GeneralTab />
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
