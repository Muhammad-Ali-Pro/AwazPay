/**
 * voiceSessionController — THE single owner of the microphone.
 *
 * Nothing else in AwazPay may call `getUserMedia`, `recognition.start()` or
 * `recognition.stop()`. Everything subscribes to this instead. Before this
 * existed, four separate places opened microphone streams independently
 * (the level monitor, the permission probe, the speech wrapper and the cloud
 * recorder), and the browser's recording indicator blinked on and off every
 * few seconds as they fought over the device.
 *
 * WHY THE INDICATOR USED TO BLINK, AND WHY IT NO LONGER DOES
 * -------------------------------------------------------------------------
 * Chrome ends a SpeechRecognition session on its own after a short pause in
 * speech, even with `continuous = true`. The old code reacted to that `onend`
 * by immediately constructing a *new* recognition instance, which re-acquired
 * the microphone from scratch. Each of those re-acquisitions toggled the
 * browser's recording indicator and dropped roughly the first half-second of
 * audio, so words spoken across a restart boundary were simply lost.
 *
 * This controller holds ONE `getUserMedia` stream open for the entire
 * session. The browser keeps the indicator lit steadily for as long as that
 * stream is live, so recognition instances can come and go underneath
 * without the user ever seeing a flicker. The same single stream also feeds
 * the audio-level meter, so the meter costs nothing extra.
 *
 * STATE MACHINE
 * -------------------------------------------------------------------------
 *   stopped -> requesting_permission -> ready -> listening -> processing
 *                                                   ^            |
 *                                                   |            v
 *                                                   +------- speaking
 *   any state -> paused (tab hidden, or a flow borrowed the mic)
 *   any state -> error (permission denied, no device, restart budget spent)
 *
 * Recognition is NEVER restarted when: the app stopped it deliberately, the
 * app is speaking, the tab is hidden, the session was destroyed, a start is
 * already pending, or auto-restart is switched off.
 */
import type { RecognitionAlternative } from './diagnosticsService'

export type VoiceControllerState =
  | 'stopped'
  | 'requesting_permission'
  | 'ready'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'paused'
  | 'error'

export interface ControllerOutcome {
  transcript: string
  alternatives: RecognitionAlternative[]
  confidence: number
  language: string
  latencyMs?: number
}

export interface ControllerStatus {
  state: VoiceControllerState
  /** True while the persistent microphone stream is open. */
  micStreamOpen: boolean
  /** True while a SpeechRecognition instance is actually running. */
  recognitionActive: boolean
  /** 0..1 live audio level from the shared stream. */
  level: number
  language: string
  /** How many times recognition has relaunched inside this session. */
  restartCount: number
  deviceLabel: string | null
  lastError: string | null
  autoRestart: boolean
}

export interface ControllerHandlers {
  onStatus?: (status: ControllerStatus) => void
  onInterim?: (transcript: string) => void
  onFinal?: (outcome: ControllerOutcome) => void
  /** Recognition ran and heard nothing at all. */
  onSilence?: () => void
  onError?: (message: string, kind: ControllerErrorKind) => void
  /** Emitted for every lifecycle event, with a reason. */
  onLog?: (line: string) => void
}

export type ControllerErrorKind =
  | 'unsupported'
  | 'permission_denied'
  | 'no_device'
  | 'network'
  | 'restart_limit'
  | 'unknown'

export interface StartOptions {
  /** Recognition languages, tried in order if one is rejected. */
  langs: string[]
  /**
   * Whether recognition relaunches itself after the browser ends a pass.
   *
   * Off is the honest debugging mode: one recognition pass, one transcript,
   * no churn. On is what the hands-free wake-word experience needs.
   */
  autoRestart: boolean
  /** Ask the engine for several ranked readings per phrase. */
  maxAlternatives?: number
}

// --------------------------------------------------------------- logging

const LOG_PREFIX = '[VoiceSession]'
let logSink: ((line: string) => void) | null = null
const logHistory: string[] = []
const MAX_LOG_LINES = 200

function log(event: string, reason?: string) {
  const line = reason ? `${event} — ${reason}` : event
  const stamped = `${new Date().toLocaleTimeString()} ${line}`
  logHistory.unshift(stamped)
  if (logHistory.length > MAX_LOG_LINES) logHistory.length = MAX_LOG_LINES
  // Console output is what makes this debuggable from devtools during a
  // live demo, which is exactly when it is needed most.
  console.info(`${LOG_PREFIX} ${line}`)
  logSink?.(stamped)
  logListeners.forEach((listener) => listener(logHistory.slice()))
}

const logListeners = new Set<(lines: string[]) => void>()

export function subscribeVoiceLog(listener: (lines: string[]) => void): () => void {
  logListeners.add(listener)
  listener(logHistory.slice())
  return () => logListeners.delete(listener)
}

export function getVoiceLog(): string[] {
  return logHistory.slice()
}

export function clearVoiceLog(): void {
  logHistory.length = 0
  logListeners.forEach((listener) => listener([]))
}

// ------------------------------------------------------------- internals

/**
 * Restart budget. Generous enough for a long dictation session, tight enough
 * that a genuinely broken microphone reports a problem instead of spinning
 * forever and pinning a CPU core.
 */
const RESTART_LIMIT = 20
const RESTART_WINDOW_MS = 60000
const RESTART_DELAY_MS = 250

function supportsRecognition(): boolean {
  return typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)
}

function supportsMicrophone(): boolean {
  return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
}

export function isVoiceSessionSupported(): boolean {
  return supportsRecognition() && supportsMicrophone()
}

function mapRecognitionError(code: string | undefined): ControllerErrorKind {
  switch (code) {
    case 'not-allowed':
    case 'permission-denied':
    case 'service-not-allowed':
      return 'permission_denied'
    case 'audio-capture':
      return 'no_device'
    case 'network':
      return 'network'
    default:
      return 'unknown'
  }
}

class VoiceSessionController {
  private state: VoiceControllerState = 'stopped'
  private handlers: ControllerHandlers = {}
  private options: StartOptions = { langs: ['en-US'], autoRestart: true, maxAlternatives: 5 }

  /** The one and only microphone stream. */
  private stream: MediaStream | null = null
  private audioContext: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private levelData: Uint8Array<ArrayBuffer> | null = null
  private rafId: number | null = null
  private level = 0

  private recognition: SpeechRecognitionLike | null = null
  /** True between calling start() and receiving onstart/onerror. */
  private startPending = false
  private recognitionActive = false

  private desired = false
  private paused = false
  private speaking = false
  private destroyed = false

  private langIndex = 0
  private restartTimer: ReturnType<typeof setTimeout> | null = null
  private restartTimes: number[] = []
  private restartCount = 0
  private lastError: string | null = null
  private utteranceStartAt: number | null = null
  /** Set while an async start is in flight, so a second call cannot duplicate it. */
  private startInFlight: Promise<boolean> | null = null

  // ------------------------------------------------------------- status

  private get language(): string {
    return this.options.langs[this.langIndex] ?? this.options.langs[0] ?? 'en-US'
  }

  getStatus(): ControllerStatus {
    return {
      state: this.state,
      micStreamOpen: !!this.stream,
      recognitionActive: this.recognitionActive,
      level: this.level,
      language: this.language,
      restartCount: this.restartCount,
      deviceLabel: this.stream?.getAudioTracks()[0]?.label ?? null,
      lastError: this.lastError,
      autoRestart: this.options.autoRestart,
    }
  }

  private setState(next: VoiceControllerState, reason?: string) {
    if (this.state === next) return
    const previous = this.state
    this.state = next
    log(`state ${previous} -> ${next}`, reason)
    this.emitStatus()
  }

  private emitStatus() {
    this.handlers.onStatus?.(this.getStatus())
    statusListeners.forEach((listener) => listener(this.getStatus()))
  }

  // -------------------------------------------------------- microphone

  /**
   * Opens the one persistent stream. Held open for the whole session so the
   * browser's recording indicator stays steady rather than blinking with
   * every recognition restart.
   */
  private async openMicrophone(): Promise<boolean> {
    if (this.stream) return true
    if (!supportsMicrophone()) {
      this.fail('unsupported', 'This browser cannot open a microphone.')
      return false
    }

    this.setState('requesting_permission', 'opening the shared microphone stream')
    log('microphone requested')

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      })
    } catch (error) {
      const name = (error as { name?: string })?.name
      if (name === 'NotAllowedError' || name === 'SecurityError') {
        this.fail('permission_denied', 'Microphone permission was denied.')
      } else if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        this.fail('no_device', 'No microphone was found.')
      } else {
        this.fail('unknown', `Could not open the microphone. ${(error as Error).message}`)
      }
      return false
    }

    log('microphone granted', this.stream.getAudioTracks()[0]?.label || 'unnamed device')

    // If the OS or user yanks the device, react instead of pretending.
    this.stream.getAudioTracks().forEach((track) => {
      track.onended = () => {
        log('microphone track ended', 'device removed or revoked by the system')
        this.fail('no_device', 'The microphone was disconnected.')
        this.stopInternal('microphone track ended')
      }
    })

    this.startLevelMetering()
    return true
  }

  private startLevelMetering() {
    if (!this.stream || this.audioContext) return
    const Ctor =
      window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!Ctor) return

    try {
      this.audioContext = new Ctor()
      const source = this.audioContext.createMediaStreamSource(this.stream)
      this.analyser = this.audioContext.createAnalyser()
      this.analyser.fftSize = 512
      this.levelData = new Uint8Array(new ArrayBuffer(this.analyser.frequencyBinCount))
      source.connect(this.analyser)
      this.tick()
      log('level metering started', 'tapping the same shared stream, no second getUserMedia')
    } catch {
      // Metering is a diagnostic nicety; never let it break the session.
      this.audioContext = null
      this.analyser = null
    }
  }

  private tick = () => {
    if (!this.analyser || !this.levelData) return
    this.analyser.getByteTimeDomainData(this.levelData)

    let sumSquares = 0
    for (let i = 0; i < this.levelData.length; i++) {
      const value = (this.levelData[i] - 128) / 128
      sumSquares += value * value
    }
    const rms = Math.sqrt(sumSquares / this.levelData.length)
    const next = Math.min(1, rms * 4)

    // Only notify on a meaningful change, so a quiet room does not cause a
    // React re-render on every animation frame.
    if (Math.abs(next - this.level) > 0.01) {
      this.level = next
      levelListeners.forEach((listener) => listener(next))
    }

    this.rafId = requestAnimationFrame(this.tick)
  }

  private closeMicrophone(reason: string) {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
    if (this.audioContext) {
      void this.audioContext.close().catch(() => {})
      this.audioContext = null
    }
    this.analyser = null
    this.levelData = null
    this.level = 0

    if (this.stream) {
      this.stream.getTracks().forEach((track) => {
        track.onended = null
        track.stop()
      })
      this.stream = null
      log('microphone released', reason)
    }
  }

  // ------------------------------------------------------- recognition

  /**
   * The single guarded entry point for starting recognition.
   *
   * Every condition that should block a start is checked here and logged
   * with a reason, so "why is it not listening" always has an answer in the
   * log rather than requiring a guess.
   */
  private launchRecognition(reason: string) {
    if (this.destroyed) return log('start skipped', 'session destroyed')
    if (!this.desired) return log('start skipped', 'session not running')
    if (this.paused) return log('start skipped', 'session paused')
    if (this.speaking) return log('start skipped', 'AwazPay is speaking')
    if (typeof document !== 'undefined' && document.hidden) return log('start skipped', 'tab hidden')
    if (this.startPending) return log('start skipped', 'a start is already pending')
    if (this.recognitionActive || this.recognition) return log('start skipped', 'recognition already active')
    if (!supportsRecognition()) return this.fail('unsupported', 'This browser has no Web Speech API.')

    const Ctor = window.SpeechRecognition || window.webkitSpeechRecognition
    const instance = new Ctor!()
    instance.lang = this.language
    instance.continuous = true
    instance.interimResults = true
    instance.maxAlternatives = this.options.maxAlternatives ?? 5

    let heardAnything = false

    instance.onstart = () => {
      this.startPending = false
      this.recognitionActive = true
      this.utteranceStartAt = null
      log('recognition started', `lang=${instance.lang}`)
      this.setState('listening', 'recognition running')
    }

    instance.onaudiostart = () => log('audio capture started')
    instance.onspeechstart = () => {
      log('speech detected')
      if (this.utteranceStartAt === null) this.utteranceStartAt = Date.now()
    }

    instance.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const text = result[0].transcript
        if (result.isFinal) {
          const finalText = text.trim()
          if (!finalText) continue
          heardAnything = true
          const alternatives: RecognitionAlternative[] = []
          for (let a = 0; a < result.length; a++) {
            const alt = result[a]
            if (alt?.transcript?.trim()) {
              alternatives.push({ transcript: alt.transcript.trim(), confidence: alt.confidence ?? 0 })
            }
          }
          const latencyMs = this.utteranceStartAt !== null ? Date.now() - this.utteranceStartAt : undefined
          this.utteranceStartAt = null
          log('result received', `"${finalText}"`)
          this.handlers.onFinal?.({
            transcript: finalText,
            alternatives,
            confidence: result[0].confidence ?? 0,
            language: this.language,
            latencyMs,
          })
        } else {
          if (this.utteranceStartAt === null) this.utteranceStartAt = Date.now()
          heardAnything = true
          interim += text
        }
      }
      if (interim.trim()) this.handlers.onInterim?.(interim.trim())
    }

    instance.onerror = (event) => {
      const code = (event as Event & { error?: string }).error
      this.startPending = false

      if (code === 'no-speech') {
        log('recognition heard nothing', 'no-speech')
        if (!heardAnything) this.handlers.onSilence?.()
        return
      }
      if (code === 'aborted') {
        log('recognition aborted', 'expected during pause, stop or language change')
        return
      }
      if (code === 'language-not-supported' && this.langIndex < this.options.langs.length - 1) {
        const from = this.language
        this.langIndex += 1
        log('language rejected', `${from} -> ${this.language}`)
        return
      }

      const kind = mapRecognitionError(code)
      if (kind === 'permission_denied' || kind === 'no_device') {
        this.desired = false
        this.fail(kind, kind === 'permission_denied' ? 'Microphone permission was denied.' : 'No microphone was found.')
        return
      }
      log('recognition error', code ?? 'unknown')
      this.lastError = code ?? 'unknown'
      this.handlers.onError?.(`Recognition error: ${code ?? 'unknown'}`, kind)
    }

    instance.onend = () => {
      this.recognitionActive = false
      this.startPending = false
      this.recognition = null
      log('recognition ended')

      if (!this.options.autoRestart) {
        // Debug mode: one pass, one transcript, no churn. The microphone
        // stream stays open, so the indicator does not flicker and a manual
        // restart is instant.
        if (this.desired && !this.paused) this.setState('ready', 'auto-restart is off, waiting for a manual restart')
        return
      }
      this.scheduleRestart('browser ended the recognition pass')
    }

    this.recognition = instance
    this.startPending = true
    log('start requested', reason)

    try {
      instance.start()
    } catch (error) {
      this.startPending = false
      this.recognition = null
      log('start threw', (error as Error).message)
      this.scheduleRestart('start() threw, device may not be released yet', 600)
    }
  }

  private scheduleRestart(reason: string, delay = RESTART_DELAY_MS) {
    if (!this.desired || this.paused || this.speaking || this.destroyed) {
      log('restart skipped', reason)
      return
    }
    if (this.restartTimer) return log('restart skipped', 'a restart is already scheduled')

    const now = Date.now()
    this.restartTimes = this.restartTimes.filter((t) => now - t < RESTART_WINDOW_MS)
    if (this.restartTimes.length >= RESTART_LIMIT) {
      this.desired = false
      this.fail('restart_limit', 'Recognition restarted too many times; stopping to avoid a loop.')
      return
    }
    this.restartTimes.push(now)
    this.restartCount += 1

    log('restart scheduled', `${reason} (restart #${this.restartCount}, in ${delay}ms)`)
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null
      this.launchRecognition(`restart: ${reason}`)
    }, delay)
  }

  private stopRecognition(reason: string) {
    if (this.restartTimer) {
      clearTimeout(this.restartTimer)
      this.restartTimer = null
    }
    const instance = this.recognition
    if (!instance) return
    // Detach onend first so the teardown does not trigger a restart.
    instance.onend = null
    instance.onresult = null
    instance.onerror = null
    instance.onstart = null
    this.recognition = null
    this.recognitionActive = false
    this.startPending = false
    try {
      instance.abort()
    } catch {
      // Already gone.
    }
    log('recognition stopped', reason)
  }

  private fail(kind: ControllerErrorKind, message: string) {
    this.lastError = message
    log('error', `${kind}: ${message}`)
    this.setState('error', message)
    this.handlers.onError?.(message, kind)
  }

  // ----------------------------------------------------------- public API

  setHandlers(handlers: ControllerHandlers) {
    this.handlers = handlers
  }

  async start(options: StartOptions, handlers: ControllerHandlers = {}): Promise<boolean> {
    this.handlers = { ...this.handlers, ...handlers }
    this.options = { maxAlternatives: 5, ...options }
    this.destroyed = false
    this.lastError = null

    if (this.desired && this.stream) {
      log('start requested', 'session already running, reusing the open microphone')
      return true
    }

    /**
     * A start already in flight is awaited rather than duplicated.
     *
     * Without this, two calls arriving before the first `getUserMedia`
     * resolves would BOTH pass the guard above and open a stream — and React
     * StrictMode's double effect invocation in development does exactly
     * that. The second stream then leaked, and the browser showed the
     * microphone opening twice on load.
     */
    if (this.startInFlight) {
      log('start requested', 'a start is already in flight, awaiting it instead of opening a second microphone')
      return this.startInFlight
    }

    this.startInFlight = this.beginStart(options)
    try {
      return await this.startInFlight
    } finally {
      this.startInFlight = null
    }
  }

  private async beginStart(options: StartOptions): Promise<boolean> {
    log('start requested', `langs=${options.langs.join(',')} autoRestart=${options.autoRestart}`)
    this.desired = true
    this.paused = false
    this.restartTimes = []
    this.restartCount = 0
    this.langIndex = 0

    const opened = await this.openMicrophone()
    if (!opened) {
      this.desired = false
      return false
    }

    // The permission prompt is slow enough that the session can be stopped or
    // destroyed while it is up. Honour that rather than leaving behind a
    // microphone stream nobody asked for any more.
    if (!this.desired || this.destroyed) {
      this.closeMicrophone('session was stopped while the permission prompt was open')
      return false
    }

    this.setState('ready', 'microphone open')
    this.launchRecognition('session start')
    return true
  }

  /** Runs exactly one recognition pass and never relaunches it. */
  restartRecognition(reason = 'manual restart') {
    if (!this.desired) return log('restart skipped', 'session is not running')
    this.stopRecognition('manual restart')
    this.launchRecognition(reason)
  }

  private stopInternal(reason: string) {
    this.stopRecognition(reason)
    this.closeMicrophone(reason)
    this.setState('stopped', reason)
  }

  stop(reason = 'stop requested') {
    log('stop requested', reason)
    this.desired = false
    this.paused = false
    this.stopInternal(reason)
  }

  /**
   * Suspends recognition but KEEPS the microphone stream open.
   *
   * Holding the stream is what stops the indicator from flickering when a
   * transaction flow borrows the microphone or when AwazPay talks.
   */
  pause(reason = 'paused') {
    if (this.paused) return
    this.paused = true
    this.stopRecognition(`pause: ${reason}`)
    this.setState('paused', reason)
  }

  resume(reason = 'resumed') {
    if (!this.paused) return
    this.paused = false
    if (!this.desired) return log('resume skipped', 'session is not running')
    this.setState('ready', reason)
    this.launchRecognition(`resume: ${reason}`)
  }

  /**
   * Tells the controller that text-to-speech is playing.
   *
   * Recognition is torn down while speaking so it never transcribes
   * AwazPay's own voice, and is relaunched afterwards. The microphone stream
   * itself stays open throughout.
   */
  setSpeaking(speaking: boolean) {
    if (this.speaking === speaking) return
    this.speaking = speaking

    if (speaking) {
      this.stopRecognition('AwazPay started speaking')
      if (this.desired) this.setState('speaking', 'text-to-speech is playing')
      return
    }

    log('speech output finished')
    if (!this.desired || this.paused) return
    this.setState('ready', 'speech output finished')
    // A short settle delay lets the audio tail die away before the
    // microphone starts transcribing again.
    this.scheduleRestart('speech output finished', 400)
  }

  /** Marks the session as working on a command, for UI state only. */
  setProcessing(processing: boolean) {
    if (!this.desired) return
    if (processing) this.setState('processing', 'handling a command')
    else if (this.state === 'processing') this.setState('listening', 'command handled')
  }

  setLanguage(lang: string, reason = 'language changed') {
    if (this.options.langs[0] === lang) return
    this.options = { ...this.options, langs: [lang, ...this.options.langs.filter((l) => l !== lang)] }
    this.langIndex = 0
    log('language changed', `${lang} (${reason})`)
    if (this.desired && !this.paused && !this.speaking) {
      this.stopRecognition('language changed')
      this.launchRecognition('language changed')
    }
  }

  setAutoRestart(autoRestart: boolean, reason = 'policy changed') {
    if (this.options.autoRestart === autoRestart) return
    this.options = { ...this.options, autoRestart }
    log('auto-restart', `${autoRestart ? 'enabled' : 'disabled'} (${reason})`)
    this.emitStatus()
  }

  destroy(reason = 'session destroyed') {
    this.destroyed = true
    this.desired = false
    this.stopInternal(reason)
    this.handlers = {}
  }

  get isRunning(): boolean {
    return this.desired
  }

  get isPaused(): boolean {
    return this.paused
  }

  /** The shared stream, for anything that needs to read the same audio. */
  getStream(): MediaStream | null {
    return this.stream
  }
}

// One controller for the whole application. This is the point.
export const voiceSession = new VoiceSessionController()

// --------------------------------------------------------- subscriptions

const statusListeners = new Set<(status: ControllerStatus) => void>()
const levelListeners = new Set<(level: number) => void>()

export function subscribeVoiceStatus(listener: (status: ControllerStatus) => void): () => void {
  statusListeners.add(listener)
  listener(voiceSession.getStatus())
  return () => statusListeners.delete(listener)
}

/** Live 0..1 audio level from the one shared microphone stream. */
export function subscribeMicLevel(listener: (level: number) => void): () => void {
  levelListeners.add(listener)
  return () => levelListeners.delete(listener)
}

export function setVoiceLogSink(sink: ((line: string) => void) | null): void {
  logSink = sink
}
