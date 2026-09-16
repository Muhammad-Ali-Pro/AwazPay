import { useEffect, useMemo, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'framer-motion'
import { useNavigate } from 'react-router-dom'
import { AccessibleButton } from '../components/AccessibleButton'
import { PrivacyCurtain } from '../components/PrivacyCurtain'
import { StageLayout } from '../components/StageLayout'
import { TransactionStage } from '../components/TransactionStage'
import { useTransactionFlow } from '../hooks/useTransactionFlow'
import { useCancelHandler } from '../hooks/useCancelHandler'
import { useReturnToMenu } from '../hooks/useReturnToMenu'
import { useAnnouncer } from '../state/announcer'
import { useAppState } from '../state/store'
import { useVoiceSession } from '../state/voiceSession'
import { DEMO_MERCHANTS } from '../data/demoWallet'
import { PHRASES } from '../data/voicePhrases'
import { vibrate } from '../lib/haptics'
import type { Merchant } from '../types'

/**
 * NFC payment.
 *
 * SIMULATED. A web page cannot run a contactless payment: Web NFC is
 * Android-Chrome only, reads tags rather than payment terminals, and the card
 * rails are not reachable from a browser at all. What this screen does is
 * model the journey faithfully so the interaction design can be judged, then
 * hand the amount to the same transaction flow, security engine and Trusted
 * Circle rules every other payment goes through.
 */
const DETECT_MS = 2600

function pickMerchant(): Merchant {
  return DEMO_MERCHANTS[Math.floor(Math.random() * DEMO_MERCHANTS.length)]
}

export function NfcPayment() {
  const { consumeFlow } = useVoiceSession()
  // Consumed once so a refresh does not replay a stale voice request.
  const request = useMemo(() => consumeFlow(), [consumeFlow])
  const [merchant, setMerchant] = useState<Merchant | null>(null)

  if (!merchant) {
    return <NfcScanning onDetected={setMerchant} />
  }

  return <NfcTransaction merchant={merchant} amountOverride={request?.amount} />
}

/** Phase one: hold the phone near the terminal. */
function NfcScanning({ onDetected }: { onDetected: (merchant: Merchant) => void }) {
  const navigate = useNavigate()
  const { announce } = useAnnouncer()
  const { settings } = useAppState()
  const reduceMotion = useReducedMotion()
  const announcedRef = useRef(false)
  const returnToMenu = useReturnToMenu()

  /**
   * Run the terminal detection.
   *
   * The guard covers only the spoken prompt, never the timer. Guarding the
   * whole effect left this screen searching forever: React's development
   * double-invoke ran the effect, tore it down (clearing the timer), then ran
   * it again, where the guard returned early and nothing was ever
   * rescheduled. The timer must be created fresh on every effect run and the
   * cleanup must be allowed to cancel it.
   */
  useEffect(() => {
    if (!announcedRef.current) {
      announcedRef.current = true
      announce(PHRASES.nfcBringPhone)
    }

    const timer = setTimeout(() => {
      vibrate('detect', settings.vibrationEnabled)
      // Hand over only once "terminal detected" has finished playing. Calling
      // onDetected immediately swapped in the payment flow, whose own opening
      // line then cut this one off mid-sentence.
      announce(PHRASES.nfcDetected, { onEnd: () => onDetected(pickMerchant()) })
    }, DETECT_MS)
    return () => clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // "Cancel" works by voice here, with no wake phrase needed.
  useCancelHandler(() => {
    announce(PHRASES.cancelled, { onEnd: () => returnToMenu(300) })
  })

  return (
    <StageLayout
      orbState="listening"
      eyebrow="NFC Payment"
      heading="Hold Near The Terminal"
      caption="AwazPay is searching for a payment terminal."
    >
      <div className="flex flex-col gap-4">
        <NfcVisual reduceMotion={!!reduceMotion} />
        <PrivacyCurtain
          message="Please listen privately"
          detail="Terminal and payment details are spoken to you, not shown on screen."
        />
        <p className="rounded-2xl border border-dashed border-white/20 px-4 py-3 text-xs leading-relaxed text-white/45">
          Simulated NFC. This web prototype models the contactless journey; it does not communicate with a real
          payment terminal.
        </p>
        <AccessibleButton variant="danger" onClick={() => navigate('/home')}>
          Cancel
        </AccessibleButton>
      </div>
    </StageLayout>
  )
}

/** Phase two: the detected amount runs the standard secured payment flow. */
function NfcTransaction({ merchant, amountOverride }: { merchant: Merchant; amountOverride?: number }) {
  const flow = useTransactionFlow({
    kind: 'payment',
    request: {
      kind: 'payment',
      amount: amountOverride ?? merchant.amount,
      recipient: merchant.name,
      fromVoice: true,
      createdAt: Date.now(),
    },
  })

  return <TransactionStage flow={flow} title="NFC Payment" successTitle="Payment Complete" />
}

/**
 * The contactless visual: a phone, a terminal, and radio waves crossing
 * between them. Purely decorative, so it is hidden from assistive tech; the
 * state it illustrates is announced in speech and in the caption above.
 */
function NfcVisual({ reduceMotion }: { reduceMotion: boolean }) {
  return (
    <div
      className="relative flex h-40 items-center justify-center gap-3 overflow-hidden rounded-3xl border border-white/10 bg-gradient-to-br from-midnight-800 to-midnight-900"
      aria-hidden="true"
    >
      {/* Phone */}
      <motion.div
        className="relative z-10 h-24 w-14 shrink-0 rounded-xl border-2 border-cyan/60 bg-midnight-950"
        animate={reduceMotion ? {} : { x: [0, 8, 0] }}
        transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
      >
        <span className="absolute left-1/2 top-2 h-1 w-5 -translate-x-1/2 rounded-full bg-cyan/50" />
        <span className="absolute bottom-3 left-1/2 h-6 w-6 -translate-x-1/2 rounded-full bg-cyan/20" />
      </motion.div>

      {/* Radio waves */}
      <div className="relative flex h-full w-16 items-center justify-center">
        {[0, 1, 2].map((ring) => (
          <motion.span
            key={ring}
            className="absolute rounded-full border-2 border-cyan/70"
            style={{ width: 18 + ring * 16, height: 18 + ring * 16 }}
            animate={reduceMotion ? { opacity: 0.4 } : { opacity: [0, 0.9, 0], scale: [0.6, 1.15, 1.3] }}
            transition={{ duration: 1.8, repeat: Infinity, delay: ring * 0.35, ease: 'easeOut' }}
          />
        ))}
      </div>

      {/* Terminal */}
      <div className="relative z-10 h-28 w-20 shrink-0 rounded-xl border-2 border-violet-light/60 bg-midnight-950">
        <span className="absolute left-1/2 top-3 h-8 w-12 -translate-x-1/2 rounded bg-violet-light/20" />
        <div className="absolute bottom-3 left-1/2 grid -translate-x-1/2 grid-cols-3 gap-1">
          {Array.from({ length: 9 }).map((_, i) => (
            <span key={i} className="h-1.5 w-1.5 rounded-sm bg-white/25" />
          ))}
        </div>
      </div>
    </div>
  )
}
