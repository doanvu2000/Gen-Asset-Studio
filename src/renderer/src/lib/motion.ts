import type { Transition } from 'motion/react'

export const EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1]

export const viewTransition: Transition = { duration: 0.26, ease: EASE }

export const fadeTransition: Transition = { duration: 0.2, ease: EASE }

export const sheetTransition: Transition = { type: 'spring', stiffness: 420, damping: 32, mass: 0.9 }

export const thumbTransition: Transition = { type: 'spring', stiffness: 520, damping: 38 }
