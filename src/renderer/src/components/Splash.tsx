import { useEffect, useState, type ReactElement } from 'react'
import { AnimatePresence, MotionConfig, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { EASE } from '@renderer/lib/motion'

const WORDS = ['Gen', 'Asset', 'Studio']
const LETTER_START = 1.05
const LETTER_STEP = 0.06
const HOLD_MS = 3900
const FILL_BOX = {
  transformBox: 'fill-box',
  transformOrigin: 'center'
} as const

function SplashLogo(): ReactElement {
  return (
    <div className="splash-logo">
      {[0.75, 1.05].map((delay) => (
        <motion.span
          key={delay}
          className="splash-ring"
          initial={{ opacity: 0, scale: 0.6 }}
          animate={{ opacity: [0, 0.55, 0], scale: [0.6, 1.25, 1.9] }}
          transition={{ delay, duration: 1.1, ease: 'easeOut' }}
        />
      ))}
      <motion.div
        className="splash-logo-body"
        initial={{ opacity: 0, scale: 0.2, rotate: -28 }}
        animate={{ opacity: 1, scale: 1, rotate: 0, y: [0, 0, -4, 0] }}
        transition={{
          opacity: { duration: 0.25 },
          scale: { type: 'spring', stiffness: 220, damping: 11, delay: 0.1 },
          rotate: { type: 'spring', stiffness: 160, damping: 12, delay: 0.1 },
          y: {
            delay: 1.6,
            duration: 2.2,
            times: [0, 0.1, 0.55, 1],
            ease: 'easeInOut'
          }
        }}
      >
        <svg viewBox="0 0 64 64" className="splash-logo-svg" aria-hidden="true">
          <defs>
            <linearGradient id="splash-g" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#5AC8FA" />
              <stop offset="1" stopColor="#007AFF" />
            </linearGradient>
            <linearGradient id="splash-shine" x1="0" y1="0" x2="1" y2="0">
              <stop offset="0" stopColor="#fff" stopOpacity="0" />
              <stop offset="0.5" stopColor="#fff" stopOpacity="0.75" />
              <stop offset="1" stopColor="#fff" stopOpacity="0" />
            </linearGradient>
            <clipPath id="splash-clip">
              <rect x="2" y="2" width="60" height="60" rx="14" />
            </clipPath>
          </defs>
          <rect x="2" y="2" width="60" height="60" rx="14" fill="url(#splash-g)" />
          <motion.rect
            x="14"
            y="20"
            width="26"
            height="26"
            rx="7"
            fill="#fff"
            style={FILL_BOX}
            initial={{ opacity: 0, x: -12, y: 12, scale: 0.6 }}
            animate={{ opacity: 0.35, x: 0, y: 0, scale: 1 }}
            transition={{
              delay: 0.4,
              type: 'spring',
              stiffness: 260,
              damping: 16
            }}
          />
          <motion.rect
            x="22"
            y="14"
            width="28"
            height="28"
            rx="7"
            fill="#fff"
            style={FILL_BOX}
            initial={{ opacity: 0, y: -22, scale: 0.7 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{
              delay: 0.55,
              type: 'spring',
              stiffness: 300,
              damping: 14
            }}
          />
          <motion.path
            d="M36 20l2 5 5 2-5 2-2 5-2-5-5-2 5-2z"
            fill="#007AFF"
            style={FILL_BOX}
            initial={{ opacity: 0, scale: 0, rotate: -180 }}
            animate={{ opacity: 1, scale: [0, 1.6, 1], rotate: 0 }}
            transition={{ delay: 0.8, duration: 0.7, ease: EASE }}
          />
          <g clipPath="url(#splash-clip)">
            <g transform="rotate(20 32 32)">
              <motion.rect
                x="-40"
                y="-10"
                width="24"
                height="90"
                fill="url(#splash-shine)"
                initial={{ x: -40 }}
                animate={{ x: 130 }}
                transition={{
                  delay: 1.35,
                  duration: 0.9,
                  ease: [0.4, 0, 0.2, 1]
                }}
              />
            </g>
          </g>
        </svg>
      </motion.div>
      {[
        { x: -70, y: -46, d: 1.0, s: 10 },
        { x: 72, y: -30, d: 1.15, s: 8 },
        { x: 60, y: 54, d: 1.3, s: 6 },
        { x: -62, y: 48, d: 1.2, s: 7 }
      ].map((p) => (
        <motion.span
          key={`${p.x}${p.y}`}
          className="splash-spark"
          style={{ width: p.s, height: p.s, marginLeft: p.x, marginTop: p.y }}
          initial={{ opacity: 0, scale: 0 }}
          animate={{ opacity: [0, 1, 0], scale: [0, 1.2, 0.4], rotate: 90 }}
          transition={{ delay: p.d, duration: 0.9, ease: 'easeOut' }}
        />
      ))}
    </div>
  )
}

export function Splash(): ReactElement {
  const { t } = useTranslation()
  const [visible, setVisible] = useState(true)
  const year = new Date().getFullYear()

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(false), HOLD_MS)
    return () => window.clearTimeout(timer)
  }, [])

  let index = 0
  const letters = WORDS.map((word, w) => (
    <span key={word} className={w === WORDS.length - 1 ? 'splash-word accent' : 'splash-word'}>
      {Array.from(word).map((ch) => {
        const delay = LETTER_START + LETTER_STEP * index++
        return (
          <motion.span
            key={`${word}-${delay}`}
            className="splash-ch"
            initial={{ opacity: 0, y: 22, filter: 'blur(8px)' }}
            animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
            transition={{ delay, duration: 0.55, ease: EASE }}
          >
            {ch}
          </motion.span>
        )
      })}
    </span>
  ))
  const textEnd = LETTER_START + LETTER_STEP * index + 0.3

  return (
    <MotionConfig reducedMotion="user">
      <AnimatePresence>
        {visible && (
          <motion.div
            className="splash"
            role="status"
            aria-label="Gen Asset Studio"
            initial={{ opacity: 1 }}
            exit={{ opacity: 0, scale: 1.015 }}
            transition={{ duration: 0.45, ease: EASE }}
            onClick={() => setVisible(false)}
          >
            <div className="splash-center">
              <SplashLogo />
              <h1 className="splash-title">{letters}</h1>
              <motion.p
                className="splash-tag"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: textEnd, duration: 0.4, ease: EASE }}
              >
                {t('splash.tagline')}
              </motion.p>
              <div className="splash-bar">
                <motion.i
                  initial={{ scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{
                    delay: 0.3,
                    duration: HOLD_MS / 1000 - 0.4,
                    ease: [0.4, 0, 0.2, 1]
                  }}
                />
              </div>
            </div>
            <motion.p
              className="splash-copy"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: textEnd + 0.15, duration: 0.5 }}
            >
              {t('status.copyright', { year })}
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </MotionConfig>
  )
}
