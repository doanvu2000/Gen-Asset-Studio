import { useEffect, useRef, type ReactElement, type ReactNode } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { fadeTransition, sheetTransition } from '@renderer/lib/motion'

interface ModalProps {
  open: boolean
  onClose?: () => void
  className?: string
  label: string
  role?: 'dialog' | 'alertdialog'
  children: ReactNode
}

export function Modal({ open, onClose, className, label, role = 'dialog', children }: ModalProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    ref.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' && onClose) onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open && (
        <div className="modal-root" key="modal">
          <motion.div
            className="scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={fadeTransition}
            onClick={onClose}
          />
          <motion.div
            ref={ref}
            tabIndex={-1}
            className={className ? `sheet dlg ${className}` : 'sheet dlg'}
            role={role}
            aria-modal="true"
            aria-label={label}
            initial={{ opacity: 0, y: 16, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98, transition: fadeTransition }}
            transition={sheetTransition}
          >
            {children}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )
}
