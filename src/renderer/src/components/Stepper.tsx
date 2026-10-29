import type { ReactElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { fadeTransition } from '@renderer/lib/motion'

interface StepperProps {
  value: number
  min: number
  max: number
  onChange: (v: number) => void
  label: string
}

export function Stepper({ value, min, max, onChange, label }: StepperProps): ReactElement {
  return (
    <div className="stepper" role="group" aria-label={label} title={label}>
      <button type="button" disabled={value <= min} aria-label="-" onClick={() => onChange(Math.max(min, value - 1))}>
        −
      </button>
      <output>
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span key={value} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }} transition={fadeTransition}>
            {value}
          </motion.span>
        </AnimatePresence>
      </output>
      <button type="button" disabled={value >= max} aria-label="+" onClick={() => onChange(Math.min(max, value + 1))}>
        +
      </button>
    </div>
  )
}
