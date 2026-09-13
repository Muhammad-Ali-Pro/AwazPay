import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import type { OrbState } from '../types'

interface AwazOrbProps {
  state: OrbState
  size?: number
  label?: string
}

// Matches the AwazPay logo's blue-to-green gradient.
const STATE_GRADIENTS: Record<OrbState, [string, string]> = {
  idle: ['#0A6EC7', '#00C896'],
  listening: ['#1F82DB', '#00C896'],
  processing: ['#0A6EC7', '#4FA8F5'],
  // 'verifying' is the documented name for the secure-verification state;
  // 'secure' is the original alias and renders identically.
  verifying: ['#073F73', '#00C896'],
  secure: ['#073F73', '#00C896'],
  speaking: ['#0A6EC7', '#6EEFC9'],
  success: ['#3ddc97', '#00C896'],
  error: ['#ff6b7a', '#0A6EC7'],
}

/** States that render the locked, verification look. */
const isSecureState = (state: OrbState) => state === 'secure' || state === 'verifying'

export function AwazOrb({ state, size = 220, label }: AwazOrbProps) {
  const reduceMotion = useReducedMotion()
  const [from, to] = STATE_GRADIENTS[state]
  const gradientId = 'awaz-orb-gradient'

  return (
    <div
      className="relative flex items-center justify-center"
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? `Awaz Orb, ${state}`}
    >
      {!reduceMotion && (state === 'listening' || state === 'speaking' || isSecureState(state)) && (
        <AnimatePresence>
          {[0, 1, 2].map((ring) => (
            <motion.span
              key={ring}
              className="absolute rounded-full border"
              style={{
                width: size,
                height: size,
                borderColor: isSecureState(state) ? '#00C896' : state === 'speaking' ? '#6EEFC9' : '#4FA8F5',
                borderWidth: isSecureState(state) ? 1 : 2,
              }}
              initial={{ scale: 0.85, opacity: 0.6 }}
              animate={{ scale: 1.5, opacity: 0 }}
              transition={{
                duration: isSecureState(state) ? 3 : state === 'speaking' ? 2.4 : 1.8,
                repeat: Infinity,
                delay: ring * (isSecureState(state) ? 1 : 0.6),
                ease: 'easeOut',
              }}
            />
          ))}
        </AnimatePresence>
      )}

      {isSecureState(state) && (
        <div
          className="absolute rounded-full border-2 border-dashed border-cyan/70"
          style={{ width: size * 0.86, height: size * 0.86 }}
          aria-hidden="true"
        >
          {!reduceMotion && (
            <motion.div
              className="h-full w-full rounded-full"
              animate={{ rotate: 360 }}
              transition={{ duration: 8, repeat: Infinity, ease: 'linear' }}
            />
          )}
        </div>
      )}

      {state === 'processing' && (
        <motion.span
          className="absolute rounded-full"
          style={{
            width: size * 0.92,
            height: size * 0.92,
            border: '3px solid transparent',
            borderTopColor: to,
            borderRightColor: to,
          }}
          animate={reduceMotion ? {} : { rotate: 360 }}
          transition={{ duration: 1.6, repeat: Infinity, ease: 'linear' }}
          aria-hidden="true"
        />
      )}

      <motion.div
        className="relative rounded-full"
        style={{
          width: size * 0.72,
          height: size * 0.72,
          background: `radial-gradient(circle at 35% 30%, ${from}, ${to} 75%)`,
        }}
        animate={
          reduceMotion
            ? { scale: 1 }
            : state === 'idle'
              ? { scale: [1, 1.06, 1] }
              : state === 'listening'
                ? { scale: [1, 1.1, 0.98, 1.08, 1] }
                : { scale: 1 }
        }
        transition={
          state === 'idle'
            ? { duration: 3.2, repeat: Infinity, ease: 'easeInOut' }
            : state === 'listening'
              ? { duration: 1.1, repeat: Infinity, ease: 'easeInOut' }
              : { duration: 0.4 }
        }
      >
        <div className="absolute inset-0 flex items-center justify-center">
          <OrbGlyph state={state} reduceMotion={!!reduceMotion} />
        </div>
      </motion.div>

      <svg width="0" height="0">
        <defs>
          <linearGradient id={gradientId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor={from} />
            <stop offset="100%" stopColor={to} />
          </linearGradient>
        </defs>
      </svg>
    </div>
  )
}

function OrbGlyph({ state, reduceMotion }: { state: OrbState; reduceMotion: boolean }) {
  if (state === 'success') {
    return (
      <motion.svg
        width="40%"
        height="40%"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        initial={{ scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
      >
        <path d="M4 12.5L9.5 18L20 6" stroke="white" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
      </motion.svg>
    )
  }

  if (state === 'error') {
    return (
      <svg width="34%" height="34%" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M6 6L18 18M18 6L6 18" stroke="white" strokeWidth={2.5} strokeLinecap="round" />
      </svg>
    )
  }

  if (state === 'secure' || state === 'verifying') {
    return (
      <svg width="32%" height="32%" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <rect x="5" y="10" width="14" height="10" rx="2" stroke="white" strokeWidth={2} />
        <path d="M8 10V7a4 4 0 018 0v3" stroke="white" strokeWidth={2} strokeLinecap="round" />
      </svg>
    )
  }

  if (state === 'speaking') {
    // Headphones: private voice guidance is playing.
    return (
      <svg width="36%" height="36%" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 15v-3a8 8 0 0116 0v3" stroke="white" strokeWidth={2} strokeLinecap="round" />
        <rect x="2.5" y="14" width="4.5" height="6.5" rx="2.25" stroke="white" strokeWidth={2} />
        <rect x="17" y="14" width="4.5" height="6.5" rx="2.25" stroke="white" strokeWidth={2} />
      </svg>
    )
  }

  // idle / listening / processing: waveform bars
  const bars = state === 'listening' ? [0.4, 0.9, 1.3, 0.7, 1.0] : [0.5, 0.75, 0.5, 0.75, 0.5]
  return (
    <div className="flex items-end gap-1" aria-hidden="true">
      {bars.map((h, i) => (
        <motion.span
          key={i}
          className="w-1.5 rounded-full bg-white/90"
          style={{ height: `${h * 20}px` }}
          animate={
            reduceMotion
              ? {}
              : state === 'listening'
                ? { height: [`${h * 12}px`, `${h * 26}px`, `${h * 12}px`] }
                : {}
          }
          transition={{ duration: 0.7 + i * 0.08, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}
    </div>
  )
}
