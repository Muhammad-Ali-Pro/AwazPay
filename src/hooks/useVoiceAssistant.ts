import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { OrbState, ParsedIntent, SpeechError, VoiceSessionState, VoiceStopReason } from '../types/voice'
import { routeIntent, type CommandAction } from '../engines/commandEngine'
import {
  containsWakePhrase,
  isAffirmative,
  isFinancialIntent,
  isNegative,
  parseTranscript,
  parseTranscriptSync,
  pickBestInterpretation,
  stripWakePhrase,
} from '../services/intentService'
import { normalizeForIntent } from '../services/normalizationService'
import { askAssistant, toSpeakable } from '../services/aiService'
import {
  bandFor,
  recordError,
  recordRecognition,
  recordSilence,
  setMicStatus,
  updateRecognition,
} from '../services/diagnosticsService'
import { fill, money } from '../data/voicePhrases'
import {
  getActiveSpeechProvider,
  getActiveSpeechProviderId,
  requestMicrophoneAccess,
  type RecognitionOutcome,
  type SpeechContinuousSession,
} from '../services/speechProvider'
import { onSpeakingChange } from '../services/voiceOutputService'
import { PHRASES } from '../data/voicePhrases'
import { useAnnouncer } from '../state/announcer'
import { useAppState } from '../state/store'
import { useVoiceSession } from '../state/voiceSession'
import { vibrate } from '../lib/haptics'

/**
 * How long the command window stays open after the wake phrase before the
 * assistant goes back to only listening for "Hey AwazPay".
 */
const COMMAND_WINDOW_MS = 9000

/**
 * Recognition language chains, tried in order if one is unsupported.
 *
 * WHY 'auto' RUNS IN ENGLISH: the Web Speech API cannot detect language, and
 * only one recogniser may be live, so genuine auto-detection is impossible in
 * a browser. What works in practice for Pakistani users is a Pakistani or
 * Indian English acoustic model: it transcribes Roman Urdu words phonetically
 * ("bhejo", "batao") and gets embedded English words right, which is exactly
 * what code-mixed speech needs. An Urdu-only model returns Urdu script and
 * mangles the English half. Users who speak pure Urdu should pick the Urdu
 * profile explicitly; the parser accepts all three scripts either way.
 */
const RECOGNITION_FALLBACKS: Record<string, string[]> = {
  auto: ['en-PK', 'en-IN', 'en-US'],
  'ur-PK': ['ur-PK', 'en-PK', 'en-IN', 'en-US'],
  'en-PK': ['en-PK', 'en-IN', 'en-US'],
  'en-GB': ['en-GB', 'en-US'],
  'en-US': ['en-US'],
}

/** Orb state for each session state. */
const ORB_BY_SESSION: Record<VoiceSessionState, OrbState> = {
  off: 'idle',
  ready: 'idle',
  listening: 'listening',
  processing: 'processing',
  speaking: 'speaking',
  awaiting_confirmation: 'verifying',
  transaction: 'verifying',
  success: 'success',
  error: 'error',
}

/** Short, non-sensitive status line for each state. */
export const SESSION_CAPTIONS: Record<VoiceSessionState, string> = {
  off: 'Voice mode is off',
  ready: 'AwazPay is ready',
  listening: 'AwazPay is listening',
  processing: 'AwazPay is understanding your request',
  speaking: 'AwazPay is responding privately',
  awaiting_confirmation: 'Private confirmation required',
  transaction: 'Secure verification in progress',
  success: 'Done',
  error: 'AwazPay did not catch that',
}

export interface UseVoiceAssistantResult {
  sessionState: VoiceSessionState
  orbState: OrbState
  statusText: string
  /** Non-sensitive echo of what was heard. */
  transcript: string
  /** True when the wake phrase landed and a command is expected. */
  awake: boolean
  isSupported: boolean
  voiceModeEnabled: boolean
  micOpen: boolean
  /** Set when the session is not listening, and why. */
  stopReason: VoiceStopReason
  /** One-time gesture: asks for the microphone and starts the session. */
  enableVoiceMode: () => Promise<void>
  /** Reopens the microphone after the user or the browser closed it. */
  restartListening: () => void
  /** Closes the microphone until the user reopens it. */
  stopListening: () => void
  /** Tears down the current session and opens a new one on the active provider. */
  switchSpeechProvider: () => void
}

/**
 * useVoiceAssistant — the always-on voice session.
 *
 * Mounted once, in the app shell, so the microphone stays open across every
 * screen. The user never has to find a button to speak again after the
 * one-time permission gesture.
 *
 * HOW "CONTINUOUS" WORKS, HONESTLY: browsers have no background hotword
 * engine. After permission is granted, this keeps a recognition session alive
 * and restarts it whenever the browser ends it, then matches the wake phrase
 * in software against the transcript. It needs the tab to be open, and it
 * needs that one initial gesture, which browsers require before any page may
 * open a microphone.
 *
 * Two safeguards keep it usable rather than maddening. The microphone closes
 * while AwazPay speaks, so it never transcribes its own voice and answers
 * itself. And restarts are rate-limited, so a failing microphone reports a
 * problem instead of spinning forever.
 */
export function useVoiceAssistant(): UseVoiceAssistantResult {
  const navigate = useNavigate()
  const state = useAppState()
  const { announce, silence } = useAnnouncer()
  const {
    setPendingFlow,
    setLastTranscript,
    voiceModeEnabled,
    setVoiceModeEnabled,
    sessionState,
    setSessionState,
    stopReason,
    setStopReason,
    registerMicControls,
  } = useVoiceSession()

  const [transcript, setTranscript] = useState('')
  const [awake, setAwake] = useState(false)
  const [micOpen, setMicOpen] = useState(false)
  const isSupported = getActiveSpeechProvider().isSupported()

  const listenerRef = useRef<SpeechContinuousSession | null>(null)
  const awakeRef = useRef(false)
  const awakeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const idleTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stateRef = useRef(state)
  stateRef.current = state
  const sessionStateRef = useRef(sessionState)
  sessionStateRef.current = sessionState
  const busyRef = useRef(false)
  /**
   * True while a transaction flow has borrowed the microphone. The
   * speaking-observer below must not hand it back on its own, or the global
   * wake-word session would fight the flow's own recogniser for the device.
   */
  const borrowedRef = useRef(false)

  const setAwakeState = useCallback((value: boolean) => {
    awakeRef.current = value
    setAwake(value)
  }, [])

  const toIdle = useCallback(
    (delay = 1600) => {
      if (idleTimer.current) clearTimeout(idleTimer.current)
      idleTimer.current = setTimeout(() => {
        busyRef.current = false
        setSessionState('ready')
      }, delay)
    },
    [setSessionState],
  )

  const sleepWake = useCallback(() => {
    if (awakeTimer.current) clearTimeout(awakeTimer.current)
    setAwakeState(false)
  }, [setAwakeState])

  const armWakeWindow = useCallback(() => {
    setAwakeState(true)
    if (awakeTimer.current) clearTimeout(awakeTimer.current)
    awakeTimer.current = setTimeout(() => setAwakeState(false), COMMAND_WINDOW_MS)
  }, [setAwakeState])

  // ------------------------------------------------------------- acting

  const applyAction = useCallback(
    (action: CommandAction) => {
      switch (action.kind) {
        case 'speak':
          setSessionState(action.orb === 'secure' ? 'transaction' : 'speaking')
          announce(action.text, { onEnd: () => toIdle(300) })
          break

        case 'navigate':
          setSessionState('processing')
          if (action.text) announce(action.text, { onEnd: () => toIdle(300) })
          else toIdle(300)
          navigate(action.to)
          break

        case 'start_flow':
          setSessionState('transaction')
          setPendingFlow(action.request)
          navigate(action.to)
          // The destination screen takes over speaking and the microphone.
          busyRef.current = false
          break

        case 'back':
          setSessionState('processing')
          if (action.text) announce(action.text, { onEnd: () => toIdle(300) })
          navigate(-1)
          break

        case 'stop_listening':
          listenerRef.current?.stop()
          setStopReason('user')
          setSessionState('off')
          announce(action.text)
          break

        case 'unrecognised':
        default:
          vibrate('error', stateRef.current.settings.vibrationEnabled)
          setSessionState('error')
          announce(action.text, { onEnd: () => toIdle(300) })
          break
      }
    },
    [announce, navigate, setPendingFlow, setSessionState, setStopReason, toIdle],
  )

  /**
   * A financial command the app understood but is not confident enough to run
   * without asking. Held until the user says yes or no.
   */
  const pendingConfirmRef = useRef<CommandAction | null>(null)

  /**
   * Runs one understood command.
   *
   * `outcome` carries every reading the engine offered. The best one is chosen
   * here rather than trusting position zero, which is the main accuracy fix
   * for accented speech.
   */
  const handleCommand = useCallback(
    async (outcome: RecognitionOutcome) => {
      busyRef.current = true
      sleepWake()
      setSessionState('processing')

      const alternatives = outcome.alternatives.length
        ? outcome.alternatives
        : [{ transcript: outcome.transcript, confidence: outcome.confidence }]

      const best = pickBestInterpretation(alternatives)
      const parsed: ParsedIntent = best ? best.parsed : await parseTranscript(outcome.transcript)
      const chosenTranscript = best ? alternatives[best.index].transcript : outcome.transcript
      const recognitionConfidence = best ? best.recognitionConfidence : outcome.confidence
      const normalization = normalizeForIntent(chosenTranscript)

      setTranscript(chosenTranscript)
      setLastTranscript(chosenTranscript)

      const diagnosticId = recordRecognition({
        rawTranscript: outcome.transcript,
        alternatives,
        chosenIndex: best?.index ?? 0,
        language: outcome.language,
        confidence: recognitionConfidence,
        normalized: normalization.normalized,
        corrections: normalization.corrections,
        intent: parsed.intent,
        handledBy: 'local',
        provider: getActiveSpeechProviderId(),
        latencyMs: outcome.latencyMs,
      })

      const band = bandFor(recognitionConfidence)
      const financial = isFinancialIntent(parsed.intent)

      // Nothing matched any rule. Hand it to the intelligence layer, which can
      // answer conversationally but can never execute anything.
      if (parsed.intent === 'unknown') {
        const { result, providerId } = await askAssistant({
          transcript: normalization.normalized || chosenTranscript,
          confidence: band === 'unknown' ? 'medium' : band,
          language: stateRef.current.settings.voiceLanguage,
        })
        updateRecognition(diagnosticId, { handledBy: providerId === 'local' ? 'ai' : 'ai', intent: 'ai_conversation' })

        if (result.type === 'conversation') {
          setSessionState('speaking')
          announce(toSpeakable(result.response), { onEnd: () => toIdle(300) })
          return
        }
        if (result.type === 'banking_intent') {
          // A model suggestion is only a suggestion. Re-parse it through the
          // deterministic engine and confirm it out loud before anything runs.
          const rebuilt = parseTranscriptSync(
            [result.intent.replace('_', ' '), result.amount ? `${result.amount} rupay` : '', result.recipient ?? '']
              .filter(Boolean)
              .join(' '),
          )
          updateRecognition(diagnosticId, { intent: `ai_suggested:${rebuilt.intent}`, confirmationRequired: true })
          pendingConfirmRef.current = routeIntent(rebuilt, stateRef.current)
          setSessionState('awaiting_confirmation')
          announce(PHRASES.lowConfidence, { onEnd: () => toIdle(300) })
          return
        }
        setSessionState('error')
        announce(PHRASES.notUnderstood, { onEnd: () => toIdle(300) })
        return
      }

      /**
       * A money command heard poorly is confirmed before it runs.
       *
       * Amounts are never guessed or corrected: if the transcript was shaky
       * and an amount is involved, the user is asked to say it again rather
       * than having a number invented for them. Getting this wrong would move
       * the wrong amount of someone's money.
       */
      if (financial && band === 'low') {
        if (parsed.slots.amount) {
          const amt = money(parsed.slots.amount)
          const question = parsed.slots.recipient
            ? fill(PHRASES.confirmUnderstanding, { name: parsed.slots.recipient, amount: amt })
            : fill(PHRASES.confirmUnderstandingTopUp, { amount: amt })
          pendingConfirmRef.current = routeIntent(parsed, stateRef.current)
          updateRecognition(diagnosticId, { confirmationRequired: true })
          setSessionState('awaiting_confirmation')
          armWakeWindow()
          announce(question)
          return
        }
        // Low confidence and no amount heard: ask again rather than guess.
        updateRecognition(diagnosticId, { confirmationRequired: true })
        setSessionState('error')
        announce(PHRASES.amountUnclear, { onEnd: () => toIdle(300) })
        return
      }

      applyAction(routeIntent(parsed, stateRef.current))
    },
    [announce, applyAction, armWakeWindow, setLastTranscript, setSessionState, sleepWake, toIdle],
  )

  /**
   * Every final result from the open microphone lands here.
   *
   * A wake phrase with a command attached runs immediately, so "Hey AwazPay
   * mera balance batao" is one breath rather than two. A bare wake phrase
   * opens a command window and acknowledges out loud. Anything else only
   * counts as a command when the window is already open, which is what keeps
   * ambient conversation from moving money.
   */
  const handleOutcome = useCallback(
    (outcome: RecognitionOutcome) => {
      if (busyRef.current) return

      // A yes/no answer to a confirmation takes priority over everything else.
      if (pendingConfirmRef.current) {
        const answer = outcome.transcript
        if (isAffirmative(answer)) {
          const action = pendingConfirmRef.current
          pendingConfirmRef.current = null
          busyRef.current = true
          applyAction(action)
          return
        }
        if (isNegative(answer)) {
          pendingConfirmRef.current = null
          setSessionState('speaking')
          announce(PHRASES.understoodCancelled, { onEnd: () => toIdle(300) })
          return
        }
        // Neither yes nor no: fall through and treat it as a fresh utterance.
        pendingConfirmRef.current = null
      }

      // Any alternative containing the wake phrase counts, because the top
      // reading often mangles it while a lower one gets it right.
      const readings = outcome.alternatives.length
        ? outcome.alternatives.map((a) => a.transcript)
        : [outcome.transcript]
      const wakeReading = readings.find((text) => containsWakePhrase(text))
      const hasWake = !!wakeReading
      const remainder = wakeReading ? stripWakePhrase(wakeReading) : ''

      if (hasWake && remainder.length > 1) {
        void handleCommand(outcome)
        return
      }

      if (hasWake) {
        vibrate('tap', stateRef.current.settings.vibrationEnabled)
        armWakeWindow()
        setSessionState('listening')
        setTranscript('')
        announce(PHRASES.wakeAcknowledged)
        return
      }

      if (awakeRef.current) {
        void handleCommand(outcome)
        return
      }

      // Not addressed to AwazPay. Show it, but do nothing.
      setTranscript(outcome.transcript)
    },
    [announce, applyAction, armWakeWindow, handleCommand, setSessionState, toIdle],
  )

  // -------------------------------------------------- listener lifecycle

  const startSession = useCallback(() => {
    if (listenerRef.current?.isRunning) return
    const provider = getActiveSpeechProvider()
    if (!provider.isSupported()) {
      setSessionState('error')
      setStopReason('unsupported')
      return
    }

    const langs = RECOGNITION_FALLBACKS[state.settings.voiceLanguage] ?? [state.settings.voiceLanguage, 'en-US']

    const session = provider.startContinuous({
      langs,
      onFinal: handleOutcome,
      onInterim: (text) => {
        if (!busyRef.current) setTranscript(text)
      },
      onListeningChange: (listening) => {
        setMicOpen(listening)
        setMicStatus({
          isCapturing: listening,
          provider: provider.id,
          language: listenerRef.current?.activeLanguage ?? langs[0],
          restartCount: listenerRef.current?.restartCount ?? 0,
        })
        // Coming back from a browser-initiated stop should look like ready,
        // but never overwrite a state a flow is actively driving.
        if (listening && !busyRef.current && !awakeRef.current && sessionStateRef.current === 'off') {
          setSessionState('ready')
        }
      },
      onSilence: () => {
        // Previously discarded silently. Recording it is what lets a
        // developer tell "the mic heard nothing" apart from "the mic heard
        // you and misread you" in Voice Diagnostics.
        recordSilence(listenerRef.current?.activeLanguage ?? langs[0], provider.id)
      },
      onLanguageFallback: (fromLang, toLang) => {
        recordError(`Language "${fromLang}" was rejected; falling back to "${toLang}".`, toLang, provider.id)
      },
      onError: (error: SpeechError) => {
        recordError(`${error.kind}: ${error.message}`, listenerRef.current?.activeLanguage ?? langs[0], provider.id)
        if (error.kind === 'permission_denied') {
          setSessionState('error')
          setStopReason('permission')
          announce(PHRASES.micDenied)
        }
      },
      onStopped: (reason) => {
        setMicOpen(false)
        setMicStatus({ isCapturing: false })
        setStopReason(reason)
        if (reason === 'restart_limit') {
          setSessionState('error')
          announce(PHRASES.micLost)
        } else if (reason !== 'user') {
          setSessionState('off')
        }
      },
    })

    listenerRef.current = session
    setMicStatus({ provider: provider.id, language: session.activeLanguage })
    setStopReason(null)
    setSessionState('ready')
  }, [announce, handleOutcome, setSessionState, setStopReason, state.settings.voiceLanguage])

  /** One-time gesture: request the microphone, then go hands-free. */
  const enableVoiceMode = useCallback(async () => {
    if (!getActiveSpeechProvider().isSupported()) {
      setStopReason('unsupported')
      setSessionState('error')
      announce(PHRASES.sttUnsupported)
      return
    }

    const { granted, error } = await requestMicrophoneAccess()
    if (!granted) {
      setStopReason('permission')
      setSessionState('error')
      announce(error?.kind === 'audio_capture' ? PHRASES.micLost : PHRASES.micDenied)
      return
    }

    setVoiceModeEnabled(true)
    startSession()
    announce(PHRASES.micGranted)
  }, [announce, setSessionState, setStopReason, setVoiceModeEnabled, startSession])

  const restartListening = useCallback(() => {
    setStopReason(null)
    if (listenerRef.current?.isRunning) {
      listenerRef.current.resume()
      setSessionState('ready')
      return
    }
    // A fully stopped session cannot be resumed; discard it and let the
    // active provider open a fresh one.
    listenerRef.current = null
    startSession()
  }, [setSessionState, setStopReason, startSession])

  const stopSession = useCallback(() => {
    listenerRef.current?.stop()
    silence()
    setStopReason('user')
    setSessionState('off')
  }, [silence, setSessionState, setStopReason])

  /**
   * Switches the live session onto whichever provider is now active.
   *
   * Called from Settings right after `setActiveSpeechProvider`, so choosing
   * Cloud Speech-to-Text there takes effect immediately rather than only on
   * the next page load.
   */
  const switchSpeechProvider = useCallback(() => {
    listenerRef.current?.stop()
    listenerRef.current = null
    if (voiceModeEnabled) startSession()
  }, [startSession, voiceModeEnabled])

  // Start automatically when voice mode was granted in a previous visit.
  useEffect(() => {
    if (!voiceModeEnabled) return
    startSession()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceModeEnabled])

  // Keep recognition in the user's chosen language.
  useEffect(() => {
    const langs = RECOGNITION_FALLBACKS[state.settings.voiceLanguage] ?? [state.settings.voiceLanguage]
    listenerRef.current?.setLanguage(langs[0])
  }, [state.settings.voiceLanguage])

  /**
   * Close the microphone while AwazPay speaks.
   *
   * Without this the recogniser transcribes the app's own output and the
   * assistant ends up talking to itself. The short delay after speech ends
   * lets the audio tail die away before the microphone reopens.
   */
  useEffect(() => {
    let resumeTimer: ReturnType<typeof setTimeout> | null = null
    const unsubscribe = onSpeakingChange((speaking) => {
      const listener = listenerRef.current
      if (!listener?.isRunning) return
      if (speaking) {
        if (resumeTimer) clearTimeout(resumeTimer)
        listener.pause()
      } else {
        if (resumeTimer) clearTimeout(resumeTimer)
        resumeTimer = setTimeout(() => {
          if (borrowedRef.current) return
          listener.resume()
        }, 400)
      }
    })
    return () => {
      unsubscribe()
      if (resumeTimer) clearTimeout(resumeTimer)
    }
  }, [])

  // Expose microphone control so transaction flows can borrow the mic.
  useEffect(() => {
    registerMicControls({
      suspend: () => {
        borrowedRef.current = true
        listenerRef.current?.pause()
      },
      resume: () => {
        borrowedRef.current = false
        listenerRef.current?.resume()
      },
      restart: () => {
        borrowedRef.current = false
        restartListening()
      },
    })
    return () => registerMicControls(null)
  }, [registerMicControls, restartListening])

  // Release the microphone when the tab is hidden, and take it back on return.
  useEffect(() => {
    function onVisibility() {
      const listener = listenerRef.current
      if (!listener?.isRunning) return
      if (document.hidden) listener.pause()
      else listener.resume()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(
    () => () => {
      if (awakeTimer.current) clearTimeout(awakeTimer.current)
      if (idleTimer.current) clearTimeout(idleTimer.current)
      listenerRef.current?.stop()
      listenerRef.current = null
    },
    [],
  )

  const effectiveState: VoiceSessionState = awake && sessionState === 'ready' ? 'listening' : sessionState

  return {
    sessionState: effectiveState,
    orbState: ORB_BY_SESSION[effectiveState],
    statusText: SESSION_CAPTIONS[effectiveState],
    transcript,
    awake,
    isSupported,
    voiceModeEnabled,
    micOpen,
    stopReason,
    enableVoiceMode,
    restartListening,
    stopListening: stopSession,
    switchSpeechProvider,
  }
}
