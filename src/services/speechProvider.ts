/**
 * speechProvider — the provider abstraction the rest of the app depends on.
 *
 *   Microphone
 *       |
 *   SpeechProvider  <-- this file: BrowserSpeechProvider | CloudSpeechProvider
 *       |
 *   RecognitionOutcome (raw transcript + alternatives + confidence + latency)
 *       |
 *   Pakistani normalisation layer (normalizationService)
 *       |
 *   Intent engine (intentService)
 *       |
 *   Security engine -> Transaction flow
 *
 * Nothing downstream of `RecognitionOutcome` knows or cares which provider
 * produced it. `useVoiceAssistant` and `useTransactionFlow` call
 * `getActiveSpeechProvider()` and use whichever implementation is active;
 * switching providers is a Settings change, not a code change.
 *
 * TWO IMPLEMENTATIONS SHIP TODAY:
 *
 *   BrowserSpeechProvider  Wraps the existing Web Speech API wrapper
 *                          (speechService.ts). Free, on-device-ish, no
 *                          configuration, but accuracy on Pakistani accents
 *                          and code-mixed speech is the browser vendor's
 *                          problem, not this app's, and it varies.
 *
 *   CloudSpeechProvider    Records real audio with MediaRecorder and posts it
 *                          to a configurable Whisper-compatible transcription
 *                          endpoint. This is what "send the actual recorded
 *                          audio to a stronger multilingual model" means in
 *                          practice for a browser-only hackathon build.
 *
 * SECURITY, READ THIS BEFORE WIRING A REAL KEY:
 * CloudSpeechProvider will call `VITE_CLOUD_STT_PROXY_URL` if it is set at
 * build time, with no key in the browser at all — that is the production
 * shape, and `server/sttProxy.example.mjs` is a minimal example of what such
 * a proxy looks like. Without that env var, it falls back to calling the
 * configured endpoint directly from the browser with a developer-entered key
 * held in memory for the current tab only. That fallback exists purely so a
 * hackathon judge can try cloud transcription in five minutes; it is not
 * how a shipped product should call a paid model API. See README.md.
 */
import type { SpeechError } from '../types/voice'
import type { RecognitionAlternative, SpeechProviderId } from './diagnosticsService'
import {
  abortListening as browserAbortListening,
  createContinuousListener,
  isSpeechRecognitionSupported,
  listenOnce as browserListenOnce,
  pauseContinuous as browserPauseContinuous,
  releaseContinuousListener,
  requestMicrophoneAccess,
  resumeContinuous as browserResumeContinuous,
  startListening as browserStartListening,
  toSpeechError,
  type ContinuousListener,
  type RecognitionOutcome,
} from './speechService'
import { getMonitorStream } from './micMonitor'

export type { RecognitionOutcome }

// -------------------------------------------------------------- interface

export interface SpeechContinuousHandlers {
  langs: string[]
  onFinal: (outcome: RecognitionOutcome) => void
  onInterim?: (transcript: string) => void
  onError?: (error: SpeechError) => void
  onListeningChange?: (listening: boolean) => void
  onSilence?: () => void
  onLanguageFallback?: (fromLang: string, toLang: string) => void
  onStopped?: (reason: 'user' | 'permission' | 'unsupported' | 'restart_limit') => void
}

export interface SpeechContinuousSession {
  stop: () => void
  pause: () => void
  resume: () => void
  setLanguage: (lang: string) => void
  readonly isRunning: boolean
  readonly isPaused: boolean
  readonly activeLanguage: string
  readonly restartCount: number
}

export interface SpeechOneShotOptions {
  lang: string
  timeoutMs?: number
  onInterim?: (transcript: string) => void
  onOutcome?: (outcome: RecognitionOutcome) => void
}

export interface SpeechProvider {
  readonly id: SpeechProviderId
  readonly label: string
  /** True when this provider needs configuration before it can be used. */
  readonly requiresConfig: boolean
  isSupported(): boolean
  /** Opens a long-lived, self-restarting recognition session. */
  startContinuous(handlers: SpeechContinuousHandlers): SpeechContinuousSession
  /** One question, one answer — used by transaction flows for slot filling. */
  listenOnce(options: SpeechOneShotOptions): Promise<RecognitionOutcome>
  /** Cancels whatever one-shot listen is currently in flight, if any. */
  cancelOneShot(): void
  /** Structural or live check that this provider is ready to use. */
  checkConnection(): Promise<{ ok: boolean; detail: string }>
}

// -------------------------------------------------------- browser provider

/**
 * Thin adapter over the existing Web Speech API wrapper.
 *
 * All the restart-limiting, language-fallback and pause/resume behaviour
 * already built in speechService.ts is reused as-is; this only maps its
 * shape onto the shared SpeechProvider contract.
 */
export const browserSpeechProvider: SpeechProvider = {
  id: 'browser',
  label: 'Browser Speech Recognition (built in, free)',
  requiresConfig: false,

  isSupported: isSpeechRecognitionSupported,

  startContinuous(handlers: SpeechContinuousHandlers): SpeechContinuousSession {
    let listener: ContinuousListener | null = createContinuousListener({
      langs: handlers.langs,
      onFinal: handlers.onFinal,
      onInterim: handlers.onInterim,
      onError: handlers.onError,
      onListeningChange: handlers.onListeningChange,
      onStopped: handlers.onStopped,
      onSilence: handlers.onSilence,
      onLanguageFallback: handlers.onLanguageFallback,
    })
    listener.start()

    return {
      stop: () => {
        listener?.stop()
        if (listener) releaseContinuousListener(listener)
        listener = null
      },
      pause: () => listener?.pause(),
      resume: () => listener?.resume(),
      setLanguage: (lang: string) => listener?.setLanguage(lang),
      get isRunning() {
        return listener?.isRunning ?? false
      },
      get isPaused() {
        return listener?.isPaused ?? false
      },
      get activeLanguage() {
        return listener?.activeLanguage ?? handlers.langs[0] ?? ''
      },
      get restartCount() {
        return listener?.restartCount ?? 0
      },
    }
  },

  listenOnce({ lang, timeoutMs, onInterim, onOutcome }: SpeechOneShotOptions): Promise<RecognitionOutcome> {
    return new Promise((resolve, reject) => {
      let lastOutcome: RecognitionOutcome | null = null
      browserStartListening({
        lang,
        timeoutMs,
        onInterim,
        onOutcome: (outcome) => {
          lastOutcome = outcome
          onOutcome?.(outcome)
        },
        onFinal: () => {
          if (lastOutcome) resolve(lastOutcome)
          else reject(toSpeechError('no_speech'))
        },
        onError: (error) => reject(error),
      })
    })
  },

  cancelOneShot() {
    browserAbortListening()
  },

  async checkConnection() {
    if (!isSpeechRecognitionSupported()) {
      return { ok: false, detail: 'This browser has no Web Speech API. Try Chrome or Edge.' }
    }
    return { ok: true, detail: 'Browser speech recognition is available. No setup needed.' }
  },
}

/** So the continuous-session pause/resume module functions still work for it. */
export function pauseBrowserProvider(): void {
  browserPauseContinuous()
}
export function resumeBrowserProvider(): void {
  browserResumeContinuous()
}

// ---------------------------------------------------------- cloud provider

/**
 * Session-only configuration for the cloud transcription endpoint.
 *
 * Same convention as aiService.ts's ExternalProviderConfig: held in a module
 * variable, never written to localStorage, never persisted, gone on reload.
 * DEVELOPER / DEMO USE ONLY — see the file header and README.md.
 */
export interface CloudSpeechConfig {
  /** Whisper-style multipart endpoint, e.g. https://api.openai.com/v1/audio/transcriptions */
  endpoint: string
  model: string
  apiKey: string
  /** ISO-639-1 hint passed to the model, e.g. "ur" or "en". Optional. */
  languageHint?: string
}

let cloudConfig: CloudSpeechConfig | null = null

export function setCloudSpeechConfig(config: CloudSpeechConfig | null): void {
  cloudConfig = config
}

export function hasCloudSpeechConfig(): boolean {
  return !!cloudConfig?.apiKey || hasProxyConfigured()
}

export function describeCloudSpeechConfig(): { endpoint: string; model: string; keySet: boolean } | null {
  if (!cloudConfig) return null
  return { endpoint: cloudConfig.endpoint, model: cloudConfig.model, keySet: !!cloudConfig.apiKey }
}

/**
 * A same-origin or otherwise trusted proxy URL, supplied at build time.
 *
 * When this is set, no API key ever needs to reach the browser: the proxy
 * holds the credential server-side and this app just posts audio to it. This
 * is the production-shaped path; see server/sttProxy.example.mjs.
 */
function hasProxyConfigured(): boolean {
  return !!(import.meta.env.VITE_CLOUD_STT_PROXY_URL as string | undefined)?.trim()
}

function proxyUrl(): string | null {
  const url = (import.meta.env.VITE_CLOUD_STT_PROXY_URL as string | undefined)?.trim()
  return url || null
}

/** Silence detection for utterance-boundary recording, in RMS-ish units. */
const SILENCE_THRESHOLD = 0.02
const SILENCE_HOLD_MS = 900
const MAX_RECORDING_MS = 12000

function pickAudioMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4']
  for (const type of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(type)) return type
  }
  return ''
}

/**
 * Records one utterance: starts on open, stops automatically after a period
 * of quiet (or a hard cap), and resolves with the recorded blob.
 *
 * Reuses whatever stream the mic-level monitor already has open when
 * available, so the user is not prompted for permission twice; otherwise it
 * opens its own.
 */
async function recordUtterance(signal: {
  cancelled: boolean
}): Promise<{ blob: Blob; mimeType: string; durationMs: number }> {
  const existing = getMonitorStream()
  const stream = existing ?? (await navigator.mediaDevices.getUserMedia({ audio: true }))
  const ownsStream = !existing

  const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
  const audioContext = new AudioCtor()
  const source = audioContext.createMediaStreamSource(stream)
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = 512
  source.connect(analyser)
  const data = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))

  const mimeType = pickAudioMimeType()
  const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
  const chunks: BlobPart[] = []
  recorder.ondataavailable = (e) => {
    if (e.data.size > 0) chunks.push(e.data)
  }

  const startedAt = Date.now()
  let quietSince: number | null = null
  let rafId = 0

  return new Promise((resolve, reject) => {
    function cleanup() {
      cancelAnimationFrame(rafId)
      try {
        source.disconnect()
      } catch {
        // Already disconnected.
      }
      void audioContext.close().catch(() => {})
      if (ownsStream) stream.getTracks().forEach((t) => t.stop())
    }

    recorder.onstop = () => {
      cleanup()
      if (signal.cancelled) {
        reject(toSpeechError('aborted'))
        return
      }
      resolve({ blob: new Blob(chunks, { type: mimeType || 'audio/webm' }), mimeType, durationMs: Date.now() - startedAt })
    }
    recorder.onerror = () => {
      cleanup()
      reject(toSpeechError('audio_capture'))
    }

    function checkLevel() {
      if (signal.cancelled) {
        recorder.stop()
        return
      }
      analyser.getByteTimeDomainData(data)
      let sumSquares = 0
      for (let i = 0; i < data.length; i++) {
        const value = (data[i] - 128) / 128
        sumSquares += value * value
      }
      const rms = Math.sqrt(sumSquares / data.length)
      const now = Date.now()

      if (rms < SILENCE_THRESHOLD) {
        if (quietSince === null) quietSince = now
        else if (now - quietSince > SILENCE_HOLD_MS && now - startedAt > 400) {
          recorder.stop()
          return
        }
      } else {
        quietSince = null
      }

      if (now - startedAt > MAX_RECORDING_MS) {
        recorder.stop()
        return
      }
      rafId = requestAnimationFrame(checkLevel)
    }

    recorder.start(250)
    rafId = requestAnimationFrame(checkLevel)
  })
}

interface WhisperResponse {
  text?: string
  language?: string
  /** Some providers echo back segment-level data; unused here but tolerated. */
  segments?: Array<{ text: string }>
}

/**
 * Sends recorded audio to the transcription endpoint and returns the text.
 *
 * Uses the multipart/form-data shape OpenAI's Whisper API and most
 * compatible providers accept: field "file" is the audio, "model" is the
 * model id, "language" is an optional ISO-639-1 hint.
 */
async function transcribeAudio(
  blob: Blob,
  mimeType: string,
): Promise<{ text: string; raw: WhisperResponse }> {
  const proxy = proxyUrl()
  const target = proxy ?? cloudConfig?.endpoint

  if (!target) throw new Error('No cloud speech endpoint is configured.')
  if (!proxy && !cloudConfig?.apiKey) throw new Error('No API key is configured for cloud speech.')

  const form = new FormData()
  const extension = mimeType.includes('webm') ? 'webm' : mimeType.includes('ogg') ? 'ogg' : 'mp4'
  form.append('file', blob, `utterance.${extension}`)
  form.append('model', cloudConfig?.model || 'whisper-1')
  if (cloudConfig?.languageHint) form.append('language', cloudConfig.languageHint)

  const response = await fetch(target, {
    method: 'POST',
    headers: proxy ? undefined : { Authorization: `Bearer ${cloudConfig?.apiKey}` },
    body: form,
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`Cloud transcription failed (${response.status}). ${detail.slice(0, 200)}`)
  }

  const data = (await response.json()) as WhisperResponse
  return { text: (data.text ?? '').trim(), raw: data }
}

/**
 * Records real audio and sends it to a multilingual transcription model.
 *
 * "Continuous" here means turn-based, not streaming: each utterance is
 * recorded start-to-silence, transcribed, and if the session is still
 * desired, recording begins again for the next one. True low-latency
 * streaming ASR needs a WebSocket to a streaming-capable backend, which is
 * out of scope for a static hackathon front end; this is documented as such
 * rather than pretended away.
 */
export const cloudSpeechProvider: SpeechProvider = {
  id: 'cloud',
  label: 'Cloud Speech-to-Text (multilingual, needs configuration)',
  requiresConfig: true,

  isSupported() {
    return (
      typeof navigator !== 'undefined' &&
      !!navigator.mediaDevices?.getUserMedia &&
      typeof MediaRecorder !== 'undefined'
    )
  },

  startContinuous(handlers: SpeechContinuousHandlers): SpeechContinuousSession {
    let desired = true
    let paused = false
    const signal = { cancelled: false }
    let restartCount = 0
    let currentLang = handlers.langs[0] ?? 'en'

    async function loop() {
      while (desired) {
        if (paused) {
          await new Promise((r) => setTimeout(r, 200))
          continue
        }
        if (!hasCloudSpeechConfig()) {
          handlers.onError?.({ kind: 'unknown', message: 'Cloud speech is not configured yet.' })
          desired = false
          handlers.onStopped?.('unsupported')
          return
        }

        handlers.onListeningChange?.(true)
        signal.cancelled = false
        try {
          const startedAt = Date.now()
          const { blob, mimeType, durationMs } = await recordUtterance(signal)
          handlers.onListeningChange?.(false)

          if (!desired) return
          if (durationMs < 500) {
            // Essentially just silence and the recorder's own start-up noise.
            handlers.onSilence?.()
            restartCount += 1
            continue
          }

          const { text } = await transcribeAudio(blob, mimeType)
          const latencyMs = Date.now() - startedAt
          if (!text) {
            handlers.onSilence?.()
          } else {
            handlers.onFinal({
              transcript: text,
              alternatives: [{ transcript: text, confidence: 0 }],
              confidence: 0,
              language: currentLang,
              latencyMs,
            })
          }
        } catch (error) {
          handlers.onListeningChange?.(false)
          if ((error as SpeechError)?.kind === 'aborted') {
            // Paused or stopped mid-recording; not a real error.
          } else {
            handlers.onError?.({
              kind: 'unknown',
              message: (error as Error)?.message || 'Cloud transcription failed.',
            })
          }
        }
        restartCount += 1
      }
    }

    void loop()

    return {
      stop: () => {
        desired = false
        signal.cancelled = true
        handlers.onStopped?.('user')
      },
      pause: () => {
        paused = true
        signal.cancelled = true
      },
      resume: () => {
        paused = false
        signal.cancelled = false
      },
      setLanguage: (lang: string) => {
        currentLang = lang
      },
      get isRunning() {
        return desired
      },
      get isPaused() {
        return paused
      },
      get activeLanguage() {
        return currentLang
      },
      get restartCount() {
        return restartCount
      },
    }
  },

  async listenOnce({ lang, onOutcome }: SpeechOneShotOptions): Promise<RecognitionOutcome> {
    const signal = { cancelled: false }
    const startedAt = Date.now()
    const { blob, mimeType } = await recordUtterance(signal)
    const { text } = await transcribeAudio(blob, mimeType)
    const outcome: RecognitionOutcome = {
      transcript: text,
      alternatives: [{ transcript: text, confidence: 0 }],
      confidence: 0,
      language: lang,
      latencyMs: Date.now() - startedAt,
    }
    onOutcome?.(outcome)
    if (!text) throw toSpeechError('no_speech')
    return outcome
  },

  cancelOneShot() {
    // The in-flight recordUtterance promise checks `signal.cancelled` itself;
    // startContinuous's loop owns that signal. A bare listenOnce call has no
    // running session to cancel here by design — it is a single short recording.
  },

  async checkConnection() {
    if (proxyUrl()) return { ok: true, detail: `Using proxy at ${proxyUrl()}. No key needed in the browser.` }
    if (!cloudConfig?.apiKey) return { ok: false, detail: 'No API key configured for this session.' }
    if (!cloudConfig.endpoint) return { ok: false, detail: 'No endpoint configured.' }
    try {
      // A HEAD/OPTIONS ping is not part of the Whisper API surface, so this
      // check is structural rather than a live round trip: it confirms the
      // fields are present and the endpoint URL is well-formed. A true
      // end-to-end check happens the first time the Voice Test Lab records
      // a real phrase, which is the safer place to spend API quota.
      new URL(cloudConfig.endpoint)
      return { ok: true, detail: `Configured for ${cloudConfig.model} at ${cloudConfig.endpoint}. Record a phrase in the Voice Test Lab to verify it end to end.` }
    } catch {
      return { ok: false, detail: 'The endpoint is not a valid URL.' }
    }
  },
}

// ------------------------------------------------------------- registry

const PROVIDERS: Record<SpeechProviderId, SpeechProvider> = {
  browser: browserSpeechProvider,
  cloud: cloudSpeechProvider,
}

let activeProviderId: SpeechProviderId = 'browser'

export function setActiveSpeechProvider(id: SpeechProviderId): void {
  if (PROVIDERS[id]) activeProviderId = id
}

export function getActiveSpeechProviderId(): SpeechProviderId {
  return activeProviderId
}

export function getActiveSpeechProvider(): SpeechProvider {
  return PROVIDERS[activeProviderId]
}

export function listSpeechProviders(): SpeechProvider[] {
  return Object.values(PROVIDERS)
}

export function getSpeechProvider(id: SpeechProviderId): SpeechProvider {
  return PROVIDERS[id]
}

export { requestMicrophoneAccess }
