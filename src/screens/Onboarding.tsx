import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AccessibleButton } from '../components/AccessibleButton'
import { useAppDispatch } from '../state/store'
import { useAnnouncer } from '../state/announcer'
import { useVoiceSession } from '../state/voiceSession'
import { isSpeechRecognitionSupported, requestMicrophoneAccess } from '../services/speechService'
import { PHRASES } from '../data/voicePhrases'

type Step = 'privacy' | 'voice' | 'secret'

/**
 * First-run setup.
 *
 * The middle step is the only moment AwazPay asks the user to press anything
 * to speak. Browsers will not open a microphone without a user gesture, so
 * the permission is collected once, here, deliberately. After this the
 * assistant listens on its own and the user never needs the button again.
 */
export function Onboarding() {
  const [step, setStep] = useState<Step>('privacy')
  const [secretWord, setSecretWord] = useState('')
  const [micState, setMicState] = useState<'idle' | 'asking' | 'granted' | 'denied' | 'unsupported'>('idle')
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const { announce } = useAnnouncer()
  const { setVoiceModeEnabled } = useVoiceSession()
  const greetedRef = useRef(false)

  useEffect(() => {
    if (greetedRef.current) return
    greetedRef.current = true
    announce(PHRASES.welcome)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function enableVoice() {
    if (!isSpeechRecognitionSupported()) {
      setMicState('unsupported')
      announce(PHRASES.sttUnsupported)
      return
    }
    setMicState('asking')
    const { granted } = await requestMicrophoneAccess()
    if (granted) {
      setVoiceModeEnabled(true)
      setMicState('granted')
      announce(PHRASES.micGranted)
      setStep('secret')
    } else {
      setMicState('denied')
      announce(PHRASES.micDenied)
    }
  }

  function finishOnboarding() {
    const word = secretWord.trim() || 'falcon'
    dispatch({ type: 'COMPLETE_ONBOARDING', secretWord: word })
    navigate('/home', { replace: true })
  }

  if (step === 'secret') {
    return (
      <div className="flex min-h-dvh flex-col justify-between bg-midnight-950 px-6 py-10 text-white">
        <div>
          <p className="text-sm uppercase tracking-[0.2em] text-cyan">Step 3 of 3</p>
          <h1 className="mt-3 text-2xl font-bold">Choose your secret word</h1>
          <p className="mt-3 text-white/70">
            This word protects your payments. Before any transaction, AwazPay asks you to say it aloud together
            with a random number. This is a prototype security layer, not bank-grade authentication.
          </p>

          <label htmlFor="secret-word" className="mt-8 block text-sm font-medium text-white/80">
            Your secret word
          </label>
          <input
            id="secret-word"
            type="text"
            value={secretWord}
            onChange={(e) => setSecretWord(e.target.value)}
            placeholder="e.g. Falcon"
            autoComplete="off"
            className="mt-2 w-full rounded-2xl border border-white/15 bg-midnight-800 px-5 py-4 text-lg text-white placeholder-white/30 focus-visible:outline focus-visible:outline-4 focus-visible:outline-cyan"
          />
          <p className="mt-2 text-xs text-white/40">Leave blank to use the demo default word, &ldquo;Falcon&rdquo;.</p>
        </div>

        <div className="flex flex-col gap-3">
          <AccessibleButton onClick={finishOnboarding}>Start Secure Session</AccessibleButton>
          <AccessibleButton variant="ghost" onClick={() => setStep('voice')}>
            Back
          </AccessibleButton>
        </div>
      </div>
    )
  }

  if (step === 'voice') {
    return (
      <div className="flex min-h-dvh flex-col justify-between bg-midnight-950 px-6 py-10 text-white">
        <div className="flex flex-col items-center text-center">
          <p className="text-sm uppercase tracking-[0.2em] text-cyan">Step 2 of 3</p>
          <div className="mt-8 text-6xl" aria-hidden="true">
            🎙️
          </div>
          <h1 className="mt-6 text-2xl font-bold">Enable Voice Mode</h1>
          <p className="mt-4 max-w-sm text-white/70">
            AwazPay ko aapki awaaz sunne ki ijazat chahiye.
          </p>
          <p className="mt-3 max-w-sm text-sm leading-relaxed text-white/55">
            Your browser asks for microphone permission once. After you allow it, AwazPay keeps listening on its
            own, and you will never need to press a button to speak again. Just say &ldquo;Hey AwazPay&rdquo;.
          </p>

          {micState === 'denied' && (
            <p className="mt-6 max-w-sm rounded-2xl border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
              Microphone access was blocked. Allow it in your browser settings, or continue with touch controls.
            </p>
          )}
          {micState === 'unsupported' && (
            <p className="mt-6 max-w-sm rounded-2xl border border-white/20 bg-white/5 px-4 py-3 text-sm text-white/70">
              This browser cannot recognise speech. AwazPay still works fully by touch. For the voice experience,
              open it in Google Chrome.
            </p>
          )}
        </div>

        <div className="flex flex-col gap-3">
          <AccessibleButton onClick={() => void enableVoice()} disabled={micState === 'asking'}>
            {micState === 'asking' ? 'Waiting for permission...' : '🎙️ Enable Voice Mode'}
          </AccessibleButton>
          <AccessibleButton variant="ghost" onClick={() => setStep('secret')}>
            Skip, use touch controls
          </AccessibleButton>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-dvh flex-col justify-between bg-midnight-950 px-6 py-10 text-white">
      <div className="flex flex-col items-center text-center">
        <p className="text-sm uppercase tracking-[0.2em] text-cyan">Step 1 of 3</p>
        <div className="mt-8 text-6xl" aria-hidden="true">
          🎧
        </div>
        <h1 className="mt-6 text-2xl font-bold">Private Audio Banking</h1>
        <p className="mt-4 max-w-sm text-white/70">
          Connect your earphones for private financial guidance. AwazPay delivers balances, amounts and
          confirmations through audio, never displayed openly on screen.
        </p>
      </div>

      <div className="flex flex-col gap-3">
        <AccessibleButton onClick={() => setStep('voice')}>Continue</AccessibleButton>
        <AccessibleButton variant="ghost" onClick={() => setStep('voice')}>
          Continue without earphones
        </AccessibleButton>
      </div>
    </div>
  )
}
