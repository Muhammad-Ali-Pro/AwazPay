/// <reference types="vite/client" />

interface SpeechRecognitionAlternativeLike {
  transcript: string
  /** 0..1. Chrome populates this on final results; some engines report 0. */
  confidence: number
}

/**
 * One recognised phrase. Indexable because the engine returns several ranked
 * alternatives per result when `maxAlternatives` is above one, and for
 * accented speech the correct reading is frequently not the first.
 */
interface SpeechRecognitionResultLike {
  isFinal: boolean
  length: number
  readonly [index: number]: SpeechRecognitionAlternativeLike
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number
  results: ArrayLike<SpeechRecognitionResultLike>
}

interface SpeechRecognitionLike extends EventTarget {
  lang: string
  continuous: boolean
  interimResults: boolean
  maxAlternatives: number
  start: () => void
  stop: () => void
  abort: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: Event & { error?: string }) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
  /** Fires when the engine opens the audio device for this pass. */
  onaudiostart: (() => void) | null
  /** Fires when the engine first detects a human voice, not just sound. */
  onspeechstart: (() => void) | null
}

interface Window {
  SpeechRecognition?: new () => SpeechRecognitionLike
  webkitSpeechRecognition?: new () => SpeechRecognitionLike
}
