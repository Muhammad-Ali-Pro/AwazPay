import { useCallback, useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { OrbState, ParsedIntent, SpeechError, VoiceSessionState, VoiceStopReason } from '../types/voice'
import { routeIntent, type CommandAction } from '../engines/commandEngine'
import {
  containsWakePhrase,
  isAffirmative,
  isFinancialIntent,
  isMenuRequest,
  isNegative,
  parseMenuSelection,
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
import { fill, joinPhrases, money } from '../data/voicePhrases'
import { getActiveSpeechProviderId, type RecognitionOutcome } from '../services/speechProvider'
import { isVoiceSessionSupported, voiceSession } from '../services/voiceSessionController'
import { getMicPermissionState } from '../services/micMonitor'
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
  /**
   * Turns on menu mode, where a bare number selects a menu option without
   * needing the wake phrase. The home screen switches this on while it is
   * showing and off when it leaves.
   */
  setMenuMode: (enabled: boolean) => void
  /** Speaks the numbered main menu. */
  announceMenu: (withIntro?: boolean) => void
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
    canCancel,
    requestCancel,
  } = useVoiceSession()

  const [transcript, setTranscript] = useState('')
  const [awake, setAwake] = useState(false)
  const [micOpen, setMicOpen] = useState(false)
  const isSupported = isVoiceSessionSupported()

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
  /**
   * True while the home menu is showing, so a bare number counts as a menu
   * choice without needing the wake phrase in front of it.
   */
  const menuModeRef = useRef(false)

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
          voiceSession.stop('user said stop listening')
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

      /**
       * "Cancel" is always heard, from any screen, with no wake phrase.
       *
       * Every other command is gated behind "Hey AwazPay" so ambient talk
       * cannot move money. Cancelling is the exception, because it is the one
       * command that is never destructive and the one a user most needs when
       * they have lost track of where they are. It only does anything when a
       * screen has registered something to cancel.
       */
      const cancelReadings = outcome.alternatives.length
        ? outcome.alternatives.map((a) => a.transcript)
        : [outcome.transcript]
      if (canCancel() && cancelReadings.some((text) => parseTranscriptSync(text).intent === 'cancel')) {
        setTranscript(outcome.transcript)
        sleepWake()
        requestCancel()
        return
      }

      /**
       * Menu mode: on the main screen, a bare number is a menu choice.
       *
       * No wake phrase is required here, because AwazPay has just read the
       * options out and is explicitly waiting for an answer. Requiring "Hey
       * AwazPay" before every "three" would make the menu useless for the
       * person it exists for. Menu mode is only on while the home screen is
       * showing; everywhere else the wake phrase still gates commands.
       */
      if (menuModeRef.current) {
        const readingsForMenu = outcome.alternatives.length
          ? outcome.alternatives.map((a) => a.transcript)
          : [outcome.transcript]

        for (const reading of readingsForMenu) {
          if (isMenuRequest(reading)) {
            setTranscript(reading)
            setSessionState('speaking')
            announce(joinPhrases(PHRASES.menuRepeat, PHRASES.menu), { onEnd: () => toIdle(300) })
            return
          }
          const option = parseMenuSelection(reading)
          if (option) {
            vibrate('tap', stateRef.current.settings.vibrationEnabled)
            setTranscript(reading)
            setLastTranscript(reading)
            busyRef.current = true
            sleepWake()
            setSessionState('processing')
            // Built straight from the option rather than re-parsed from its
            // label, so the menu can never drift away from what it triggers.
            applyAction(
              routeIntent(
                {
                  intent: option.intent,
                  slots: {},
                  confidence: 1,
                  raw: reading,
                  normalized: reading,
                  wakeWordDetected: false,
                },
                stateRef.current,
              ),
            )
            return
          }
        }
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
    [announce, applyAction, armWakeWindow, canCancel, handleCommand, requestCancel, setLastTranscript, setSessionState, sleepWake, toIdle],
  )

  // -------------------------------------------------- listener lifecycle

  /**
   * Opens the one shared voice session.
   *
   * Guarded so repeated calls (React re-renders, StrictMode's double effect
   * invocation, a user tapping Resume twice) cannot produce two sessions
   * competing for the microphone. The controller enforces this too, but
   * catching it here keeps the log readable.
   */
  const startSession = useCallback(() => {
    if (voiceSession.isRunning) return
    if (!isVoiceSessionSupported()) {
      setSessionState('error')
      setStopReason('unsupported')
      return
    }

    const langs = RECOGNITION_FALLBACKS[state.settings.voiceLanguage] ?? [state.settings.voiceLanguage, 'en-US']

    void voiceSession.start(
      { langs, autoRestart: true },
      {
        onFinal: handleOutcome,
        onInterim: (text) => {
          if (!busyRef.current) setTranscript(text)
        },
        onStatus: (status) => {
          setMicOpen(status.micStreamOpen)
          setMicStatus({
            isCapturing: status.recognitionActive,
            provider: 'browser',
            language: status.language,
            restartCount: status.restartCount,
            deviceLabel: status.deviceLabel,
          })
          if (status.state === 'listening' && !busyRef.current && !awakeRef.current && sessionStateRef.current === 'off') {
            setSessionState('ready')
          }
        },
        onSilence: () => {
          // Previously discarded silently. Recording it is what lets a
          // developer tell "the mic heard nothing" apart from "the mic heard
          // you and misread you" in Voice Diagnostics.
          recordSilence(voiceSession.getStatus().language, 'browser')
        },
        onError: (message, kind) => {
          recordError(`${kind}: ${message}`, voiceSession.getStatus().language, 'browser')
          if (kind === 'permission_denied') {
            setSessionState('error')
            setStopReason('permission')
            announce(PHRASES.micDenied)
          } else if (kind === 'restart_limit' || kind === 'no_device') {
            setSessionState('error')
            setStopReason('restart_limit')
            announce(PHRASES.micLost)
          }
        },
      },
    )

    setStopReason(null)
    setSessionState('ready')
  }, [announce, handleOutcome, setSessionState, setStopReason, state.settings.voiceLanguage])

  /**
   * One-time gesture: open the shared microphone, then go hands-free.
   *
   * The controller's own `start` performs the permission request, so there
   * is no separate probe stream opened and immediately discarded here. That
   * probe was one of the four competing microphone owners.
   */
  const enableVoiceMode = useCallback(async () => {
    if (!isVoiceSessionSupported()) {
      setStopReason('unsupported')
      setSessionState('error')
      announce(PHRASES.sttUnsupported)
      return
    }

    setVoiceModeEnabled(true)
    startSession()

    // Give the permission prompt a moment to resolve before reporting.
    await new Promise((resolve) => setTimeout(resolve, 250))
    if (voiceSession.getStatus().micStreamOpen) announce(PHRASES.micGranted)
  }, [announce, setSessionState, setStopReason, setVoiceModeEnabled, startSession])

  const restartListening = useCallback(() => {
    setStopReason(null)
    if (voiceSession.isRunning) {
      voiceSession.resume('user asked to resume')
      setSessionState('ready')
      return
    }
    startSession()
  }, [setSessionState, setStopReason, startSession])

  const stopSession = useCallback(() => {
    voiceSession.stop('user stopped voice mode')
    silence()
    setStopReason('user')
    setSessionState('off')
  }, [silence, setSessionState, setStopReason])

  /**
   * Restarts the session, for example after a Settings change.
   *
   * Kept on the returned API so Settings can force the live session to pick
   * up a new configuration without a page reload.
   */
  const switchSpeechProvider = useCallback(() => {
    voiceSession.stop('configuration changed')
    if (voiceModeEnabled) startSession()
  }, [startSession, voiceModeEnabled])

  const setMenuMode = useCallback((enabled: boolean) => {
    menuModeRef.current = enabled
  }, [])

  const announceMenu = useCallback(
    (withIntro = false) => {
      setSessionState('speaking')
      announce(withIntro ? joinPhrases(PHRASES.menuIntro, PHRASES.menu) : PHRASES.menu, {
        onEnd: () => toIdle(200),
      })
    },
    [announce, setSessionState, toIdle],
  )

  /**
   * Start listening on load, without waiting for a tap.
   *
   * Browsers will not open a microphone on a page's first ever visit without
   * a user gesture, and that is not something an app can opt out of. But once
   * permission has been granted for this origin the browser remembers it, and
   * from then on the session can open itself. So: if permission is already
   * granted, start immediately; only a genuinely first-time visitor sees the
   * enable control.
   */
  useEffect(() => {
    let cancelled = false

    if (voiceModeEnabled) {
      startSession()
      return
    }

    void getMicPermissionState().then((permission) => {
      if (cancelled || permission !== 'granted') return
      // The browser already trusts this origin with the microphone, so no
      // gesture is required and the user should not be asked for one.
      setVoiceModeEnabled(true)
      startSession()
    })

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [voiceModeEnabled])

  // Keep recognition in the user's chosen language.
  useEffect(() => {
    const langs = RECOGNITION_FALLBACKS[state.settings.voiceLanguage] ?? [state.settings.voiceLanguage]
    voiceSession.setLanguage(langs[0], 'settings changed')
  }, [state.settings.voiceLanguage])

  /**
   * Tell the controller when AwazPay is speaking.
   *
   * The controller tears down recognition while speech output plays, so it
   * never transcribes the app's own voice, and relaunches it afterwards. The
   * microphone stream itself stays open the whole time, which is why the
   * recording indicator no longer blinks on every reply.
   */
  useEffect(() => onSpeakingChange((speaking) => voiceSession.setSpeaking(speaking)), [])

  // Expose microphone control so transaction flows can borrow the mic.
  useEffect(() => {
    registerMicControls({
      suspend: () => {
        borrowedRef.current = true
        voiceSession.pause('a transaction flow borrowed the microphone')
      },
      resume: () => {
        borrowedRef.current = false
        voiceSession.resume('transaction flow returned the microphone')
      },
      restart: () => {
        borrowedRef.current = false
        restartListening()
      },
    })
    return () => registerMicControls(null)
  }, [registerMicControls, restartListening])

  // Suspend recognition when the tab is hidden, and take it back on return.
  useEffect(() => {
    function onVisibility() {
      if (!voiceSession.isRunning) return
      if (document.hidden) voiceSession.pause('tab hidden')
      else if (!borrowedRef.current) voiceSession.resume('tab visible again')
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [])

  useEffect(
    () => () => {
      if (awakeTimer.current) clearTimeout(awakeTimer.current)
      if (idleTimer.current) clearTimeout(idleTimer.current)
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
    setMenuMode,
    announceMenu,
  }
}
