import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'motion/react'
import { fadeTransition } from '@renderer/lib/motion'
import { Icon, type IconName } from './Icon'

export interface MenuItem {
  label?: string
  icon?: IconName
  danger?: boolean
  disabled?: boolean
  sep?: boolean
  onSelect?: () => void
}

interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ left: x, top: y })

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    setPos({
      left: Math.max(6, Math.min(x, window.innerWidth - r.width - 6)),
      top: Math.max(6, Math.min(y, window.innerHeight - r.height - 6))
    })
    el.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus()
  }, [x, y])

  useEffect(() => {
    const down = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const btns = [...(ref.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
        const i = btns.indexOf(document.activeElement as HTMLButtonElement)
        const next = btns[(i + (e.key === 'ArrowDown' ? 1 : -1) + btns.length) % btns.length]
        next?.focus()
      }
    }
    window.addEventListener('mousedown', down, true)
    window.addEventListener('keydown', key)
    window.addEventListener('blur', onClose)
    window.addEventListener('resize', onClose)
    return () => {
      window.removeEventListener('mousedown', down, true)
      window.removeEventListener('keydown', key)
      window.removeEventListener('blur', onClose)
      window.removeEventListener('resize', onClose)
    }
  }, [onClose])

  return createPortal(
    <motion.div
      ref={ref}
      className="menu"
      role="menu"
      style={pos}
      initial={{ opacity: 0, scale: 0.96, y: -4 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={fadeTransition}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        it.sep ? (
          <hr key={`s${i}`} />
        ) : (
          <button
            key={`${i}-${it.label}`}
            type="button"
            role="menuitem"
            className={it.danger ? 'danger' : undefined}
            disabled={it.disabled}
            onClick={() => {
              onClose()
              it.onSelect?.()
            }}
          >
            {it.icon ? <Icon name={it.icon} size={14} /> : <span className="mi-pad" />}
            {it.label}
          </button>
        )
      )}
    </motion.div>,
    document.body
  )
}
