import { useNavigate } from 'react-router-dom'
import { AwazOrb } from '../components/AwazOrb'
import { AccessibleButton } from '../components/AccessibleButton'
import { VoiceStatusPanel } from '../components/VoiceStatusPanel'
import { useVoiceAssistantContext } from '../state/assistantContext'
import { useVoiceSession } from '../state/voiceSession'
import { WAKE_PHRASE } from '../services/intentService'

/**
 * The AwazPay agent home screen.
 *
 * There is no "tap to speak" control here. Once voice mode is enabled the
 * microphone is already open, and the user simply says "Hey AwazPay". The orb
 * is the agent's presence on screen, not a button the user must find.
 *
 * The buttons below the fold are a touch fallback, not the main path: they
 * exist for a user who cannot use speech, or a browser that cannot.
 */
export function Home() {
  const navigate = useNavigate()
  const assistant = useVoiceAssistantContext()
  const { setPendingFlow } = useVoiceSession()

  // Only ask for setup when voice mode was never granted, or when the session
  // actually stopped. A momentary 'off' while the listener boots must not
  // flash a button at the user.
  const needsSetup = !assistant.voiceModeEnabled || assistant.stopReason !== null

  function startFlow(kind: 'payment' | 'topup' | 'deposit', to: string) {
    setPendingFlow({ kind, fromVoice: false, createdAt: Date.now() })
    navigate(to)
  }

  return (
    <div className="flex flex-col items-center gap-8 text-center text-white">
      {/* Agent identity */}
      <header className="flex flex-col items-center gap-1 pt-2">
        <p className="text-xs font-semibold uppercase tracking-[0.32em] text-cyan">AwazPay Assistant</p>
        <h1 className="text-3xl font-extrabold tracking-tight">
          Banking <span className="text-cyan">Beyond Sight</span>
        </h1>
        <p className="text-sm text-white/50">Voice-First Banking for Everyone</p>
        <p className="mt-2 rounded-full border border-cyan/25 bg-cyan/5 px-4 py-1.5 text-sm font-semibold text-cyan-light">
          Say &ldquo;{WAKE_PHRASE}&rdquo;
        </p>
      </header>

      {/* The orb is the agent, and the centrepiece of the screen. */}
      <div className="relative flex flex-col items-center gap-6">
        <div className="absolute -inset-8 -z-10 rounded-full bg-violet/10 blur-3xl" aria-hidden="true" />
        <AwazOrb state={assistant.orbState} size={252} label={assistant.statusText} />

        <VoiceStatusPanel
          sessionState={assistant.sessionState}
          statusText={assistant.statusText}
          transcript={assistant.transcript}
          micOpen={assistant.micOpen}
        />
      </div>

      {/* One-time setup, or recovery if the session was stopped. */}
      {needsSetup ? (
        <div className="w-full max-w-sm">
          <AccessibleButton
            variant="primary"
            onClick={() => {
              if (assistant.voiceModeEnabled) assistant.restartListening()
              else void assistant.enableVoiceMode()
            }}
          >
            {assistant.voiceModeEnabled ? '🎙️ Resume Voice Mode' : '🎙️ Enable Voice Mode'}
          </AccessibleButton>
          <p className="mt-3 text-sm leading-relaxed text-white/50">
            {assistant.isSupported
              ? 'One tap grants the microphone. After that AwazPay listens for you, and you never need this button again.'
              : 'This browser cannot recognise speech. Use the buttons below, or open AwazPay in Chrome.'}
          </p>
        </div>
      ) : (
        <p className="max-w-xs text-sm leading-relaxed text-white/55">
          Say the wake phrase, then your request. No need to touch the screen.
        </p>
      )}

      {/* Touch fallback. Secondary to voice, but always available. */}
      <section className="w-full max-w-sm" aria-label="Touch alternatives">
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.2em] text-white/35">
          Or use touch
        </h2>
        <div className="grid grid-cols-2 gap-3">
          <AccessibleButton variant="secondary" fullWidth onClick={() => startFlow('payment', '/payment')}>
            Pay
          </AccessibleButton>
          <AccessibleButton variant="secondary" fullWidth onClick={() => navigate('/nfc')}>
            NFC Pay
          </AccessibleButton>
          <AccessibleButton variant="secondary" fullWidth onClick={() => navigate('/balance')}>
            Balance
          </AccessibleButton>
          <AccessibleButton variant="secondary" fullWidth onClick={() => navigate('/history')}>
            Activity
          </AccessibleButton>
          <AccessibleButton variant="ghost" fullWidth onClick={() => startFlow('topup', '/topup')}>
            Mobile Load
          </AccessibleButton>
          <AccessibleButton variant="ghost" fullWidth onClick={() => startFlow('deposit', '/cash-assist')}>
            Cash Deposit
          </AccessibleButton>
        </div>
      </section>

      <p className="max-w-xs text-xs leading-relaxed text-white/30">
        Prototype. All balances and transactions are simulated demo data. No real money is moved.
      </p>
    </div>
  )
}
