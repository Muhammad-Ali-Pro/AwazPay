import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AccessibleButton } from '../components/AccessibleButton'
import { useAppDispatch } from '../state/store'
import { useAnnouncer } from '../state/announcer'
import { useVoiceSession } from '../state/voiceSession'
import { isVoiceSessionSupported, voiceSession } from '../services/voiceSessionController'
import { isAffirmative, isNegative } from '../services/intentService'
import { PHRASES, fill, type Phrase } from '../data/voicePhrases'

type Step = 'privacy' | 'voice' | 'secret'

/**
 * Takes the first usable word of what was heard.
 *
 * People answer "my secret word is falcon" as often as they answer "falcon",
 * so the lead-in is dropped and a single word is kept — the word has to be
 * repeatable at every payment, and a whole sentence is not.
 */
function firstWordOf(transcript: string): string {
  const words = transcript
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .filter((w) => !['my', 'secret', 'word', 'is', 'the', 'a', 'it', 'okay', 'please', 'mera'].includes(w))
  return words[0] ?? ''
}

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
  const [secretState, setSecretState] = useState<'idle' | 'listening' | 'confirming' | 'saved'>('idle')
  const [heardWord, setHeardWord] = useState('')
  const navigate = useNavigate()
  const dispatch = useAppDispatch()
  const { announce } = useAnnouncer()
  const { setVoiceModeEnabled } = useVoiceSession()
  const greetedRef = useRef(false)
  const secretCaptureStartedRef = useRef(false)

  useEffect(() => {
    if (greetedRef.current) return
    greetedRef.current = true
    announce(PHRASES.welcome)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Start capturing the secret word as soon as this step opens.
   *
   * The microphone is already running by now, so there is nothing for the
   * user to press: AwazPay asks for the word and listens for the answer.
   */
  useEffect(() => {
    if (step !== 'secret') return
    if (secretCaptureStartedRef.current) return
    secretCaptureStartedRef.current = true
    void captureSecretWord()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step])

  async function enableVoice() {
    if (!isVoiceSessionSupported()) {
      setMicState('unsupported')
      announce(PHRASES.sttUnsupported)
      return
    }
    setMicState('asking')
    // Opens the one shared session rather than a throwaway permission probe.
    // The assistant on the next screen attaches its handlers to this same
    // running session, so the microphone is acquired exactly once.
    const granted = await voiceSession.start({ langs: ['en-US'], autoRestart: true })
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

  /**
   * Captures the secret word by voice, then reads it back for confirmation.
   *
   * Typed entry was removed deliberately: a blind user should never have to
   * find a text field, and the word is going to be spoken at every payment
   * anyway, so capturing it by voice also proves the recogniser can hear it.
   */
  async function captureSecretWord() {
    setSecretState('listening')
    try {
      const heard = await listenForPhrase(PHRASES.askSecretWord)
      const word = firstWordOf(heard)
      if (!word) {
        setSecretState('idle')
        announce(PHRASES.secretWordNotHeard)
        return
      }

      setHeardWord(word)
      setSecretState('confirming')

      const answer = await listenForPhrase(fill(PHRASES.confirmSecretWord, { word }))
      if (isNegative(answer)) {
        setSecretState('idle')
        setHeardWord('')
        return
      }
      if (!isAffirmative(answer)) {
        // Neither a clear yes nor no; ask again rather than guessing at
        // something the user will have to say before every payment.
        setSecretState('idle')
        announce(PHRASES.secretWordNotHeard)
        return
      }

      setSecretWord(word)
      setSecretState('saved')
      announce(fill(PHRASES.secretWordSaved, { word }))
    } catch {
      setSecretState('idle')
      announce(PHRASES.secretWordNotHeard)
    }
  }

  /** Speaks a prompt, then listens for one answer once the prompt finishes. */
  function listenForPhrase(prompt: Phrase): Promise<string> {
    return new Promise((resolve, reject) => {
      announce(prompt, {
        onEnd: () => {
          let settled = false
          voiceSession.setHandlers({
            onFinal: (outcome) => {
              if (settled) return
              settled = true
              resolve(outcome.transcript)
            },
            onSilence: () => {
              if (settled) return
              settled = true
              reject(new Error('no speech'))
            },
            onError: () => {
              if (settled) return
              settled = true
              reject(new Error('recognition error'))
            },
          })
          voiceSession.restartRecognition('onboarding: secret word')
        },
      })
    })
  }

  function useDefaultSecretWord() {
    setSecretWord('falcon')
    setHeardWord('falcon')
    setSecretState('saved')
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
          <h1 className="mt-3 text-2xl font-bold">Say your secret word</h1>
          <p className="mt-3 text-white/70">
            This word protects your payments. Before any transaction, AwazPay asks you to say it aloud followed by a
            random number, so a recording of you saying it once cannot be replayed. This is a prototype security
            layer, not bank-grade authentication.
          </p>

          <div className="mt-8 rounded-2xl border border-white/10 bg-midnight-800 p-5">
            <div className="flex items-center gap-3">
              <span
                className={`h-3 w-3 rounded-full ${secretState === 'listening' ? 'animate-pulse bg-danger' : 'bg-white/25'}`}
                aria-hidden="true"
              />
              <p className="text-sm font-medium text-white" role="status" aria-live="polite">
                {secretState === 'listening'
                  ? 'Listening. Say your secret word now.'
                  : secretState === 'confirming'
                    ? `I heard "${heardWord}". Say yes to keep it, or no to try again.`
                    : secretState === 'saved'
                      ? `Your secret word is set to "${heardWord}".`
                      : 'Press the button, then say a single word only you would know.'}
              </p>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-3">
          {secretState === 'saved' ? (
            <AccessibleButton onClick={finishOnboarding}>Start Secure Session</AccessibleButton>
          ) : (
            <AccessibleButton onClick={() => void captureSecretWord()} disabled={secretState === 'listening'}>
              {secretState === 'listening' ? 'Listening…' : '🎙️ Say my secret word'}
            </AccessibleButton>
          )}
          <AccessibleButton variant="ghost" onClick={useDefaultSecretWord}>
            Use the demo word &ldquo;Falcon&rdquo;
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
            AwazPay needs permission to hear your voice.
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
