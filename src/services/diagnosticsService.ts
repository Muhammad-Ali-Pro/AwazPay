/**
 * diagnosticsService — a developer-only record of what the microphone heard.
 *
 * This exists because accent problems are invisible from the outside: the user
 * says one thing, the app does another, and without the raw transcript there
 * is no way to tell whether the fault was recognition, normalisation or
 * routing. Every recognition turn is recorded here with each stage's output,
 * so the failing stage can be identified in one glance.
 *
 * PRIVACY: this buffer holds spoken text, which can include a payee or an
 * amount. It lives in memory only, is never written to storage, is never sent
 * anywhere, and is only rendered when the user has switched on Developer Mode
 * and Voice Diagnostics. It is cleared when the tab closes.
 */

export interface RecognitionAlternative {
  transcript: string
  confidence: number
}

export type ConfidenceBand = 'high' | 'medium' | 'low' | 'unknown'

/** Which speech-to-text engine produced a recognition entry. */
export type SpeechProviderId = 'browser' | 'cloud'

export interface DiagnosticEntry {
  id: string
  at: number
  /** Exactly what the speech engine returned, before any processing. */
  rawTranscript: string
  /** The ranked alternatives the engine offered for the same audio. */
  alternatives: RecognitionAlternative[]
  /** Which alternative the app ended up acting on, by index. */
  chosenIndex: number
  /** BCP-47 tag the recogniser was actually running in. */
  language: string
  confidence: number
  confidenceBand: ConfidenceBand
  /** After Roman Urdu normalisation and transcription correction. */
  normalized: string
  /** Corrections the normaliser applied, as "heard -> used" pairs. */
  corrections: string[]
  intent: string
  /** Which layer produced the outcome. */
  handledBy: 'local' | 'ai' | 'unhandled'
  /** Recognition or processing error, when one occurred. */
  error?: string
  /** Whether the app asked the user to confirm before acting. */
  confirmationRequired?: boolean
  /** Which speech-to-text engine transcribed this turn. */
  provider?: SpeechProviderId
  /**
   * Milliseconds from the first sign of speech to the final transcript.
   * Browser provider: a wall-clock approximation, since the engine is a
   * remote black box. Cloud provider: the real time the network request took.
   */
  latencyMs?: number
  /** True when this entry records "recognition heard nothing", not a phrase. */
  isSilence?: boolean
}

const MAX_ENTRIES = 30

let entries: DiagnosticEntry[] = []
let enabled = false
const listeners = new Set<(entries: DiagnosticEntry[]) => void>()

function emit() {
  const snapshot = entries.slice()
  listeners.forEach((listener) => listener(snapshot))
}

/** Diagnostics only records while switched on, so it costs nothing when off. */
export function setDiagnosticsEnabled(value: boolean): void {
  enabled = value
  if (!value) {
    entries = []
    emit()
  }
}

export function isDiagnosticsEnabled(): boolean {
  return enabled
}

export function bandFor(confidence: number): ConfidenceBand {
  if (!Number.isFinite(confidence) || confidence <= 0) return 'unknown'
  if (confidence >= 0.8) return 'high'
  if (confidence >= 0.55) return 'medium'
  return 'low'
}

export function recordRecognition(entry: Omit<DiagnosticEntry, 'id' | 'at' | 'confidenceBand'>): string | null {
  if (!enabled) return null
  const id = `diag-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
  const full: DiagnosticEntry = {
    ...entry,
    id,
    at: Date.now(),
    confidenceBand: bandFor(entry.confidence),
  }
  entries = [full, ...entries].slice(0, MAX_ENTRIES)
  emit()
  return id
}

/** Fills in fields that are only known after routing finishes. */
export function updateRecognition(id: string | null, patch: Partial<DiagnosticEntry>): void {
  if (!id || !enabled) return
  entries = entries.map((entry) =>
    entry.id === id
      ? { ...entry, ...patch, confidenceBand: patch.confidence !== undefined ? bandFor(patch.confidence) : entry.confidenceBand }
      : entry,
  )
  emit()
}

export function recordError(message: string, language: string, provider: SpeechProviderId = 'browser'): void {
  if (!enabled) return
  recordRecognition({
    rawTranscript: '',
    alternatives: [],
    chosenIndex: -1,
    language,
    confidence: 0,
    normalized: '',
    corrections: [],
    intent: 'none',
    handledBy: 'unhandled',
    error: message,
    provider,
  })
}

export function getEntries(): DiagnosticEntry[] {
  return entries.slice()
}

export function clearEntries(): void {
  entries = []
  emit()
}

export function subscribeDiagnostics(listener: (entries: DiagnosticEntry[]) => void): () => void {
  listeners.add(listener)
  listener(entries.slice())
  return () => listeners.delete(listener)
}

/**
 * Records that recognition ran and heard absolutely nothing.
 *
 * This used to be discarded silently inside the speech engine, which hid the
 * single most useful signal for telling "the microphone isn't working" apart
 * from "the microphone works but the transcription is wrong". A run of these
 * in a row, with the live mic level also flat, points at the microphone or
 * permission; a run of these with the mic level clearly moving points at the
 * recognition language being wrong for what is being said.
 */
export function recordSilence(language: string, provider: SpeechProviderId): void {
  if (!enabled) return
  recordRecognition({
    rawTranscript: '',
    alternatives: [],
    chosenIndex: -1,
    language,
    confidence: 0,
    normalized: '',
    corrections: [],
    intent: 'none',
    handledBy: 'unhandled',
    provider,
    isSilence: true,
  })
}

// -------------------------------------------------------------- mic status

/**
 * Live status of the microphone right now, independent of any one
 * recognition turn. This is what answers "is the mic actually on" at a
 * glance, rather than after the fact from a transcript log.
 */
export interface MicStatus {
  permission: 'granted' | 'denied' | 'prompt' | 'unknown'
  /** True while a continuous or one-shot recognition session is open. */
  isCapturing: boolean
  /** 0..1, from the independent audio-level monitor. Null if not measured. */
  level: number | null
  provider: SpeechProviderId
  language: string
  /** How many times the active continuous session has restarted itself. */
  restartCount: number
  deviceLabel: string | null
  updatedAt: number
}

const DEFAULT_MIC_STATUS: MicStatus = {
  permission: 'unknown',
  isCapturing: false,
  level: null,
  provider: 'browser',
  language: '',
  restartCount: 0,
  deviceLabel: null,
  updatedAt: 0,
}

let micStatus: MicStatus = { ...DEFAULT_MIC_STATUS }
const micStatusListeners = new Set<(status: MicStatus) => void>()

export function setMicStatus(patch: Partial<MicStatus>): void {
  micStatus = { ...micStatus, ...patch, updatedAt: Date.now() }
  micStatusListeners.forEach((listener) => listener(micStatus))
}

export function getMicStatus(): MicStatus {
  return micStatus
}

export function subscribeMicStatus(listener: (status: MicStatus) => void): () => void {
  micStatusListeners.add(listener)
  listener(micStatus)
  return () => micStatusListeners.delete(listener)
}
