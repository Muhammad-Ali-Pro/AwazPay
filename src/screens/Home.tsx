import { useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { AwazOrb } from '../components/AwazOrb'
import { AccessibleButton } from '../components/AccessibleButton'
import { useVoiceAssistantContext } from '../state/assistantContext'
import { MENU_OPTIONS } from '../services/intentService'
import { useVoiceSession } from '../state/voiceSession'

/**
 * Whether the spoken greeting has already been heard this page load.
 *
 * Module scope on purpose: it must survive the home screen unmounting while
 * a payment runs, so coming back reads the options without repeating the
 * whole introduction every single time.
 */
let menuIntroPlayed = false

/**
 * The AwazPay main menu.
 *
 * Navigation here is spoken, not tapped. AwazPay reads the numbered options
 * aloud as soon as the session is listening, and a bare number chooses one —
 * no wake phrase needed, because the menu has just asked a question and is
 * waiting for the answer.
 *
 * The list is mirrored on screen for a sighted helper and as a touch
 * fallback for anyone who cannot speak, but nothing here requires a tap.
 */
const ROUTE_BY_INTENT: Record<string, string> = {
  pay_nfc: '/nfc',
  pay: '/payment',
  check_balance: '/balance',
  recent_transactions: '/history',
  cash_deposit: '/cash-assist',
}

export function Home() {
  const navigate = useNavigate()
  const assistant = useVoiceAssistantContext()
  const announcedRef = useRef(false)

  const { setMenuMode, announceMenu, sessionState, voiceModeEnabled } = assistant
  const { setSessionState } = useVoiceSession()
  const resetToReady = useCallback(() => setSessionState('ready'), [setSessionState])

  // Menu mode is on only while this screen is showing. Everywhere else a
  // bare number means nothing and the wake phrase gates commands as usual.
  useEffect(() => {
    setMenuMode(true)
    return () => setMenuMode(false)
  }, [setMenuMode])

  /**
   * Clear any state left over from a screen we just came back from.
   *
   * Being on the menu means no transaction is in progress, by definition. A
   * flow that ended without tidying up used to leave the session reading
   * "Secure verification in progress" with a padlock on the menu screen, and
   * the menu would then never be announced because it waits for 'ready'.
   */
  useEffect(() => {
    if (sessionState === 'off' || sessionState === 'error' || sessionState === 'ready') return
    if (sessionState === 'speaking' || sessionState === 'processing') return
    resetToReady()
  }, [sessionState, resetToReady])

  /**
   * Read the menu out as soon as the microphone is actually listening.
   *
   * Waiting for 'ready' rather than firing on mount matters: speaking before
   * the session is up would talk over the permission prompt, and the user
   * would hear the options while the microphone was not yet able to catch
   * their answer.
   *
   * This runs on every arrival at the menu, not just the first, because
   * finishing a payment should drop the user straight back into the options
   * rather than into silence. The spoken greeting is only used the first
   * time; after that it goes straight to the numbers.
   */
  useEffect(() => {
    if (announcedRef.current) return
    if (!voiceModeEnabled) return
    if (sessionState !== 'ready') return
    announcedRef.current = true
    announceMenu(!menuIntroPlayed)
    menuIntroPlayed = true
  }, [sessionState, voiceModeEnabled, announceMenu])

  const needsSetup = !voiceModeEnabled || assistant.stopReason !== null

  return (
    <div className="flex flex-col items-center gap-6 text-center text-white">
      <header className="flex flex-col items-center gap-1 pt-2">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan">AwazPay Assistant</p>
        <h1 className="text-2xl font-extrabold tracking-tight">
          Banking <span className="text-cyan">Beyond Sight</span>
        </h1>
      </header>

      <div className="relative flex flex-col items-center gap-4">
        <div className="absolute -inset-8 -z-10 rounded-full bg-violet/10 blur-3xl" aria-hidden="true" />
        <AwazOrb state={assistant.orbState} size={176} label={assistant.statusText} />
        <p className="text-lg font-semibold text-cyan-light" role="status" aria-live="polite">
          {assistant.statusText}
        </p>
        {assistant.transcript && (
          <p className="max-w-xs rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm italic text-white/70">
            &ldquo;{assistant.transcript}&rdquo;
          </p>
        )}
      </div>

      {/* First visit only: browsers will not open a microphone without one
          gesture. After permission is granted the session starts by itself
          and this never appears again. */}
      {needsSetup && (
        <div className="w-full max-w-sm">
          <AccessibleButton
            variant="primary"
            onClick={() => {
              if (voiceModeEnabled) assistant.restartListening()
              else void assistant.enableVoiceMode()
            }}
          >
            {voiceModeEnabled ? '🎙️ Resume Listening' : '🎙️ Start Listening'}
          </AccessibleButton>
          <p className="mt-3 text-sm leading-relaxed text-white/50">
            {assistant.isSupported
              ? 'Your browser needs one tap to allow the microphone. After that AwazPay listens on its own every time.'
              : 'This browser cannot recognise speech. Open AwazPay in Chrome for the voice experience.'}
          </p>
        </div>
      )}

      {/* The spoken menu, mirrored on screen. */}
      <section className="w-full max-w-sm" aria-label="Main menu">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-white/40">
          Say a number
        </h2>
        <ul className="flex flex-col gap-2.5">
          {MENU_OPTIONS.map((option) => (
            <li key={option.number}>
              <button
                type="button"
                onClick={() => navigate(ROUTE_BY_INTENT[option.intent] ?? '/home')}
                aria-label={`Option ${option.number}. ${option.label}. You can also say ${option.number}.`}
                className="flex min-h-[64px] w-full items-center gap-4 rounded-2xl border border-white/10 bg-midnight-800 px-5 text-left transition-colors hover:bg-midnight-700 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-cyan"
              >
                <span
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-cyan/15 text-xl font-bold text-cyan"
                  aria-hidden="true"
                >
                  {option.number}
                </span>
                <span className="text-lg font-semibold">{option.label}</span>
              </button>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => announceMenu(false)}
          className="mt-3 min-h-[44px] w-full text-sm text-white/50 underline underline-offset-4 focus-visible:outline focus-visible:outline-4 focus-visible:outline-cyan"
        >
          Say &ldquo;menu&rdquo; to hear these options again
        </button>
      </section>

      <p className="max-w-xs text-xs leading-relaxed text-white/30">
        Prototype. All balances and transactions are simulated demo data. No real money is moved.
      </p>
    </div>
  )
}
