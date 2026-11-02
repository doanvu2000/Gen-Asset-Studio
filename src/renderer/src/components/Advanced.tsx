import { useId, useState, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { AnimatePresence, motion } from 'motion/react'
import { Icon } from './Icon'
import { fadeTransition } from '@renderer/lib/motion'

const KEY = 'gas.advanced.'

function readOpen(id: string): boolean {
  try {
    return localStorage.getItem(KEY + id) === '1'
  } catch {
    return false
  }
}

function writeOpen(id: string, open: boolean): void {
  try {
    localStorage.setItem(KEY + id, open ? '1' : '0')
  } catch {
    /* storage unavailable: state stays in memory only */
  }
}

export function Advanced({ id, summary, children }: { id: string; summary?: string; children: ReactNode }): ReactElement {
  const { t } = useTranslation()
  const [open, setOpen] = useState(() => readOpen(id))
  const bodyId = useId()
  const toggle = (): void => {
    const next = !open
    setOpen(next)
    writeOpen(id, next)
  }
  return (
    <div className={open ? 'adv open' : 'adv'}>
      <button type="button" className="adv-head" aria-expanded={open} aria-controls={bodyId} onClick={toggle}>
        <Icon name="chev" size={12} className="adv-chev" />
        <b>{t('advanced.title')}</b>
        {!open && summary && <span className="adv-sum muted">{summary}</span>}
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div id={bodyId} className="adv-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={fadeTransition}>
            <div className="adv-in">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}
