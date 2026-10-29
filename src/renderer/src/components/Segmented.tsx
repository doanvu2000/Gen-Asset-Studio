import { useId, type ReactElement } from 'react'
import { motion } from 'motion/react'
import { thumbTransition } from '@renderer/lib/motion'

export interface SegmentOption<T extends string> {
  value: T
  label: string
}

interface SegmentedProps<T extends string> {
  value: T
  options: readonly SegmentOption<T>[]
  onChange: (value: T) => void
  ariaLabel: string
}

export function Segmented<T extends string>({ value, options, onChange, ariaLabel }: SegmentedProps<T>): ReactElement {
  const layoutId = useId()
  return (
    <div className="seg" role="radiogroup" aria-label={ariaLabel}>
      {options.map((opt) => {
        const on = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={on}
            className={on ? 'on' : undefined}
            onClick={() => {
              if (!on) onChange(opt.value)
            }}
          >
            {on && <motion.span layoutId={layoutId} className="seg-thumb" transition={thumbTransition} />}
            <span className="seg-label">{opt.label}</span>
          </button>
        )
      })}
    </div>
  )
}
