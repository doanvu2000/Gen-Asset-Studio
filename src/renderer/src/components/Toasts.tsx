import type { ReactElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useToast } from '@renderer/store/toast'
import { sheetTransition } from '@renderer/lib/motion'
import { Icon, type IconName } from './Icon'

const ICONS: Record<string, IconName> = { ok: 'check', info: 'help', warn: 'alert', err: 'alert' }

export function Toasts(): ReactElement {
  const items = useToast((s) => s.items)
  const dismiss = useToast((s) => s.dismiss)
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence initial={false}>
        {items.map((t) => (
          <motion.button
            type="button"
            layout
            key={t.id}
            className={`toast ${t.kind}`}
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.18 } }}
            transition={sheetTransition}
            onClick={() => dismiss(t.id)}
          >
            <Icon name={ICONS[t.kind]} size={15} />
            <span>{t.text}</span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
}
