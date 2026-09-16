/**
 * speechService — Speech-to-Text.
 *
 * A framework-free wrapper around the browser Web Speech API
 * (`SpeechRecognition` / `webkitSpeechRecognition`).
 *
 * Two modes:
 *
 *   startListening / listenOnce   one turn, used inside transaction flows
 *   createContinuousListener      a long-lived session that keeps the
 *                                 microphone open and restarts itself
 *
 * HONEST LIMITATION: browsers have no true background wake-word engine. What
 * "continuous" means here is that after the user grants microphone permission
 * once, this service keeps a recognition session alive for as long as the tab
 * is focused, restarting it whenever the browser ends it. The wake phrase is
 * then matched in software against what that session transcribes. It is not
 * an OS-level hotword detector, it stops when the tab loses the microphone,
 * and it requires that one initial user gesture.
 */
import type { SpeechError, SpeechErrorKind } from '../types/voice'
import type { RecognitionAlternative } from './diagnosticsService'

/**
 * How many ranked readings to ask the engine for per phrase.
 *
 * This is the single most effective accuracy fix for accented speech. The
 * engine's top guess is tuned for a generic accent; for Pakistani English and
 * Roman Urdu the intended words very often sit in the second or third
 * alternative. Asking for several and letting the intent parser pick the one
 * that actually forms a command costs nothing and recovers a large share of
 * otherwise-lost utterances.
 */
export const MAX_ALTERNATIVES = 5

/** A recognised phrase with every reading the engine offered. */
export interface RecognitionOutcome {
  /** The engine's own top choice, unmodified. */
  transcript: string
  alternatives: RecognitionAlternative[]
  confidence: number
  /** The language the recogniser was actually running in. */
  language: string
  /**
   * Milliseconds from when this phrase first produced an interim result to
   * its final result. An approximation of round-trip recognition latency: the
   * browser's Web Speech engine is a black box that talks to a remote
   * transcription service, so this measures wall-clock time on this device,
   * not server-side compute time.
   */
  latencyMs?: number
}

function readAlternatives(result: SpeechRecognitionResultLike): RecognitionAlternative[] {
  const out: RecognitionAlternative[] = []
  for (let i = 0; i < result.length; i++) {
    const alternative = result[i]
    if (alternative?.transcript?.trim()) {
      out.push({ transcript: alternative.transcript.trim(), confidence: alternative.confidence ?? 0 })
    }
  }
  return out
}

export interface ListenHandlers {
  onInterim?: (transcript: string) => void
  /** Receives the engine's best reading. */
  onFinal?: (transcript: string) => void
  /** Receives every ranked reading, for callers that can choose between them. */
  onOutcome?: (outcome: RecognitionOutcome) => void
  onError?: (error: SpeechError) => void
  onStart?: () => void
  onEnd?: () => void
}

export interface ListenOptions extends ListenHandlers {
  lang?: string
  /** Auto-stop after this many milliseconds of listening. Default 12000. */
  timeoutMs?: number
}

const ERROR_MESSAGES: Record<SpeechErrorKind, string> = {
  unsupported: 'Voice recognition is not supported in this browser. Please use the touch controls.',
  permission_denied:
    'Microphone access is blocked. Please allow microphone access in your browser, or use the touch controls.',
  no_speech: "I didn't hear anything. Please try again.",
  audio_capture: 'No microphone was found. Please use the touch controls.',
  network: 'The speech service is unreachable. Please check your connection or use the touch controls.',
  aborted: 'Listening stopped.',
  unknown: "I didn't understand that. Please try again.",
}

function mapErrorCode(code: string | undefined): SpeechErrorKind {
  switch (code) {
    case 'not-allowed':
    case 'permission-denied':
    case 'service-not-allowed':
      return 'permission_denied'
    case 'no-speech':
      return 'no_speech'
    case 'audio-capture':
      return 'audio_capture'
    case 'network':
      return 'network'
    case 'aborted':
      return 'aborted'
    default:
      return 'unknown'
  }
}

export function toSpeechError(kind: SpeechErrorKind): SpeechError {
  return { kind, message: ERROR_MESSAGES[kind] }
}

export function isSpeechRecognitionSupported(): boolean {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}

function createRecognition(lang: string, continuous: boolean): SpeechRecognitionLike | null {
  if (!isSpeechRecognitionSupported()) return null
  const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
  const recognition = new Ctor!()
  recognition.lang = lang
  recognition.continuous = continuous
  recognition.interimResults = true
  recognition.maxAlternatives = MAX_ALTERNATIVES
  return recognition
}

/**
 * @deprecated Do not call this. Use `voiceSessionController.start()` instead.
 *
 * This opened a microphone stream purely to trigger the permission prompt and
 * then stopped its tracks immediately. That made it a third competing owner
 * of the device, and the open-then-close right before recognition started was
 * one of the causes of the microphone cycling on and off. The controller now
 * requests permission by opening the one stream it keeps for the whole
 * session. Kept only so the export does not break, and unused by the app.
 */
export async function requestMicrophoneAccess(): Promise<{ granted: boolean; error?: SpeechError }> {
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    // Without getUserMedia, recognition itself will prompt on first start.
    return { granted: isSpeechRecognitionSupported() }
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    // The permission is what we wanted; recognition opens its own stream.
    stream.getTracks().forEach((track) => track.stop())
    return { granted: true }
  } catch (error) {
    const name = (error as { name?: string })?.name
    if (name === 'NotAllowedError' || name === 'SecurityError') {
      return { granted: false, error: toSpeechError('permission_denied') }
    }
    if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
      return { granted: false, error: toSpeechError('audio_capture') }
    }
    return { granted: false, error: toSpeechError('unknown') }
  }
}

export async function checkMicrophonePermission(): Promise<'granted' | 'denied' | 'prompt'> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'prompt'
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return status.state as 'granted' | 'denied' | 'prompt'
  } catch {
    return 'prompt'
  }
}

// --------------------------------------------------------------- one-shot

let activeRecognition: SpeechRecognitionLike | null = null
let activeTimeout: ReturnType<typeof setTimeout> | null = null

function clearActive() {
  if (activeTimeout) {
    clearTimeout(activeTimeout)
    activeTimeout = null
  }
  activeRecognition = null
}

export function abortListening(): void {
  if (activeRecognition) {
    try {
      activeRecognition.abort()
    } catch {
      // Already stopped.
    }
  }
  clearActive()
}

export function stopListening(): void {
  if (activeRecognition) {
    try {
      activeRecognition.stop()
    } catch {
      // Already stopped.
    }
  }
}

/**
 * Starts one listening turn. Returns a disposer that aborts the session.
 *
 * Exactly one of `onFinal` or `onError` fires per turn, so callers always get
 * a resolution and can fall back to touch. Any continuous session is paused
 * first, because the browser allows only one live recogniser.
 */
export function startListening(options: ListenOptions = {}): () => void {
  const { lang = 'en-PK', timeoutMs = 12000, onInterim, onFinal, onOutcome, onError, onStart, onEnd } = options

  if (!isSpeechRecognitionSupported()) {
    onError?.(toSpeechError('unsupported'))
    return () => {}
  }

  // Only one recogniser may be live; the continuous session stands down and
  // is resumed explicitly by whoever suspended it.
  pauseContinuous()
  abortListening()

  const recognition = createRecognition(lang, false)
  if (!recognition) {
    onError?.(toSpeechError('unsupported'))
    return () => {}
  }

  let settled = false
  let finalTranscript = ''
  let bestAlternatives: RecognitionAlternative[] = []
  // Latency is measured from the first sign of speech (an interim result) to
  // the final result, not from recognition.start(), because the gap before
  // the user actually speaks is silence, not recognition delay.
  let utteranceStartAt: number | null = null

  recognition.onstart = () => {
    utteranceStartAt = Date.now()
    onStart?.()
  }

  recognition.onresult = (event) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const result = event.results[i]
      const transcript = result[0].transcript
      if (result.isFinal) {
        finalTranscript += transcript
        const alternatives = readAlternatives(result)
        if (alternatives.length > bestAlternatives.length) bestAlternatives = alternatives
        const latencyMs = utteranceStartAt !== null ? Date.now() - utteranceStartAt : undefined
        onOutcome?.({
          transcript: transcript.trim(),
          alternatives,
          confidence: result[0].confidence ?? 0,
          language: lang,
          latencyMs,
        })
        utteranceStartAt = null
      } else {
        if (utteranceStartAt === null) utteranceStartAt = Date.now()
        interim += transcript
      }
    }
    if (interim) onInterim?.(interim)
  }

  recognition.onerror = (event) => {
    const kind = mapErrorCode((event as Event & { error?: string }).error)
    if (kind === 'no_speech' && finalTranscript.trim()) return
    if (settled) return
    settled = true
    onError?.(toSpeechError(kind))
  }

  recognition.onend = () => {
    clearActive()
    onEnd?.()
    if (settled) return
    settled = true
    const text = finalTranscript.trim()
    if (text) onFinal?.(text)
    else onError?.(toSpeechError('no_speech'))
  }

  activeRecognition = recognition

  try {
    recognition.start()
  } catch {
    clearActive()
    if (!settled) {
      settled = true
      onError?.(toSpeechError('unknown'))
    }
    return () => {}
  }

  if (timeoutMs > 0) activeTimeout = setTimeout(() => stopListening(), timeoutMs)

  return () => abortListening()
}

export function listenOnce(options: Omit<ListenOptions, 'onFinal' | 'onError'> = {}): Promise<string> {
  return new Promise((resolve, reject) => {
    startListening({
      ...options,
      onFinal: (transcript) => resolve(transcript),
      onError: (error) => reject(error),
    })
  })
}

// ------------------------------------------------------------- continuous

export interface ContinuousListenerOptions {
  /** Recognition languages, tried in order if one is unsupported. */
  langs: string[]
  /** Receives every ranked reading of one recognised phrase. */
  onFinal: (outcome: RecognitionOutcome) => void
  onInterim?: (transcript: string) => void
  onError?: (error: SpeechError) => void
  /** Fires whenever the microphone actually opens or closes. */
  onListeningChange?: (listening: boolean) => void
  /** Fires when the session gives up and will not restart on its own. */
  onStopped?: (reason: 'user' | 'permission' | 'unsupported' | 'restart_limit') => void
  /**
   * Fires when a recognition pass ended having heard nothing at all.
   *
   * Previously this was swallowed entirely because it is a routine event in a
   * long session (the browser closes the mic after a few seconds of quiet).
   * It is surfaced here instead of hidden, because "the app heard silence"
   * and "the app heard you and misread you" are different failures that look
   * identical from outside without this signal.
   */
  onSilence?: () => void
  /** Fires when a language was rejected by the engine and another was tried. */
  onLanguageFallback?: (fromLang: string, toLang: string) => void
}

export interface ContinuousListener {
  start: () => void
  stop: () => void
  /** Temporarily closes the microphone, for example while AwazPay speaks. */
  pause: () => void
  resume: () => void
  readonly isRunning: boolean
  readonly isPaused: boolean
  /** The BCP-47 tag recognition is actually running in right now. */
  readonly activeLanguage: string
  /** How many times the session has silently restarted itself. Diagnostic only. */
  readonly restartCount: number
  setLanguage: (lang: string) => void
}

/** Restart-loop guard: more than this many restarts in the window means stop. */
const RESTART_LIMIT = 10
const RESTART_WINDOW_MS = 12000
const RESTART_DELAY_MS = 350

let activeContinuous: ContinuousListener | null = null

/** Pauses the live continuous session, if any. Resume is always explicit. */
export function pauseContinuous(): void {
  activeContinuous?.pause()
}

export function resumeContinuous(): void {
  activeContinuous?.resume()
}

export function hasContinuousListener(): boolean {
  return activeContinuous !== null
}

/**
 * Creates a self-restarting recognition session.
 *
 * The browser ends a recognition session on its own after a pause in speech,
 * on network hiccups, and on a timer. Keeping the experience hands-free means
 * restarting it each time, which is what this does, with three safeguards: a
 * delay between restarts, a cap on restarts inside a rolling window so a
 * failing microphone cannot spin forever, and a permanent stop on a
 * permission error rather than a retry the user would have to sit through.
 */
export function createContinuousListener(options: ContinuousListenerOptions): ContinuousListener {
  const { langs, onFinal, onInterim, onError, onListeningChange, onStopped, onSilence, onLanguageFallback } = options

  let recognition: SpeechRecognitionLike | null = null
  let desired = false
  let paused = false
  let langIndex = 0
  let restartTimer: ReturnType<typeof setTimeout> | null = null
  let restartTimes: number[] = []
  let overrideLang: string | null = null
  let restartCount = 0
  /** See the matching comment in startListening: latency is timed from the
   * first sign of speech, not from when the microphone opened. */
  let utteranceStartAt: number | null = null

  const currentLang = () => overrideLang ?? langs[langIndex] ?? langs[0] ?? 'en-US'

  function setListening(value: boolean) {
    onListeningChange?.(value)
  }

  function teardown() {
    if (restartTimer) {
      clearTimeout(restartTimer)
      restartTimer = null
    }
    if (recognition) {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      recognition.onstart = null
      try {
        recognition.abort()
      } catch {
        // Already stopped.
      }
      recognition = null
    }
    setListening(false)
  }

  function withinRestartBudget(): boolean {
    const now = Date.now()
    restartTimes = restartTimes.filter((t) => now - t < RESTART_WINDOW_MS)
    if (restartTimes.length >= RESTART_LIMIT) return false
    restartTimes.push(now)
    return true
  }

  function scheduleRestart(delay = RESTART_DELAY_MS) {
    if (!desired || paused) return
    if (restartTimer) return
    if (!withinRestartBudget()) {
      desired = false
      teardown()
      onStopped?.('restart_limit')
      onError?.(toSpeechError('unknown'))
      return
    }
    restartTimer = setTimeout(() => {
      restartTimer = null
      launch()
    }, delay)
  }

  function launch() {
    if (!desired || paused) return
    if (!isSpeechRecognitionSupported()) {
      desired = false
      onStopped?.('unsupported')
      onError?.(toSpeechError('unsupported'))
      return
    }
    // A one-shot session takes precedence; wait for it to finish.
    if (activeRecognition) {
      scheduleRestart(600)
      return
    }

    const instance = createRecognition(currentLang(), true)
    if (!instance) return
    recognition = instance
    let heardAnythingThisPass = false

    instance.onstart = () => {
      utteranceStartAt = Date.now()
      setListening(true)
    }

    instance.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0].transcript
        if (result.isFinal) {
          const finalText = text.trim()
          if (!finalText) continue
          heardAnythingThisPass = true
          const latencyMs = utteranceStartAt !== null ? Date.now() - utteranceStartAt : undefined
          utteranceStartAt = null
          onFinal({
            transcript: finalText,
            alternatives: readAlternatives(result),
            confidence: result[0].confidence ?? 0,
            language: currentLang(),
            latencyMs,
          })
        } else {
          if (utteranceStartAt === null) utteranceStartAt = Date.now()
          heardAnythingThisPass = true
          interim += text
        }
      }
      if (interim.trim()) onInterim?.(interim.trim())
    }

    instance.onerror = (event) => {
      const code = (event as Event & { error?: string }).error
      const kind = mapErrorCode(code)

      if (kind === 'permission_denied') {
        desired = false
        teardown()
        onStopped?.('permission')
        onError?.(toSpeechError(kind))
        return
      }
      if (code === 'language-not-supported' && langIndex < langs.length - 1) {
        // Fall back to the next language and keep going.
        const from = currentLang()
        langIndex += 1
        overrideLang = null
        onLanguageFallback?.(from, currentLang())
        return
      }
      // 'aborted' is routine (pause/resume, or a fresh restart); onend
      // restarts the session either way. 'no_speech' is reported rather than
      // hidden, because it is the single most useful diagnostic signal for
      // telling "the app heard nothing" apart from "the app misheard you".
      if (kind === 'no_speech') {
        if (!heardAnythingThisPass) onSilence?.()
        return
      }
      if (kind !== 'aborted') onError?.(toSpeechError(kind))
    }

    instance.onend = () => {
      setListening(false)
      recognition = null
      restartCount += 1
      scheduleRestart()
    }

    try {
      instance.start()
    } catch {
      // start() throws if the previous session has not released the mic yet.
      scheduleRestart(600)
    }
  }

  const listener: ContinuousListener = {
    start() {
      if (desired) return
      desired = true
      paused = false
      restartTimes = []
      restartCount = 0
      launch()
    },
    stop() {
      desired = false
      paused = false
      teardown()
      onStopped?.('user')
    },
    pause() {
      if (paused) return
      paused = true
      if (restartTimer) {
        clearTimeout(restartTimer)
        restartTimer = null
      }
      if (recognition) {
        recognition.onend = null
        try {
          recognition.abort()
        } catch {
          // Already stopped.
        }
        recognition = null
      }
      setListening(false)
    },
    resume() {
      if (!paused) return
      paused = false
      restartTimes = []
      if (desired) scheduleRestart(200)
    },
    get isRunning() {
      return desired
    },
    get isPaused() {
      return paused
    },
    get activeLanguage() {
      return currentLang()
    },
    get restartCount() {
      return restartCount
    },
    setLanguage(lang: string) {
      overrideLang = lang
      langIndex = 0
      if (desired && !paused) {
        // Restart so the new language takes effect.
        if (recognition) {
          recognition.onend = null
          try {
            recognition.abort()
          } catch {
            // Already stopped.
          }
          recognition = null
        }
        scheduleRestart(200)
      }
    },
  }

  activeContinuous = listener
  return listener
}

/** Releases the module's reference when a listener is discarded. */
export function releaseContinuousListener(listener: ContinuousListener): void {
  if (activeContinuous === listener) activeContinuous = null
}
