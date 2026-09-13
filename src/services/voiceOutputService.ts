/**
 * voiceOutputService — Text-to-Speech.
 *
 * Wraps the browser SpeechSynthesis API. Voice is the primary output channel
 * in AwazPay, so this service is the single place that speaks: sensitive
 * figures are delivered here rather than rendered on screen.
 *
 * Urdu is the preferred spoken language. Because a real Urdu voice is absent
 * from most desktops, `resolvePhrase` falls back to Roman Urdu rather than to
 * English, which keeps the Urdu-first experience intact on any machine.
 */
import type { Phrase } from '../data/voicePhrases'

export interface SpeakOptions {
  rate?: number
  lang?: string
  pitch?: number
  /** Cancel anything currently speaking. Default true. */
  interrupt?: boolean
  onStart?: () => void
  onEnd?: () => void
  onError?: () => void
}

export const URDU_LANG = 'ur-PK'

/** Tried in order when the requested language has no installed voice. */
const VOICE_FALLBACKS: Record<string, string[]> = {
  // 'auto' is the code-mixed profile: it speaks Roman Urdu through whichever
  // South Asian English voice is available, which is the closest match most
  // machines actually have installed.
  auto: ['en-IN', 'en-PK', 'ur-PK', 'en-GB', 'en-US'],
  'ur-PK': ['ur-PK', 'ur-IN', 'ur', 'hi-IN', 'en-IN', 'en-PK', 'en-GB', 'en-US'],
  'en-PK': ['en-PK', 'en-IN', 'en-GB', 'en-US'],
  'en-IN': ['en-IN', 'en-GB', 'en-US'],
}

export function isSpeechSynthesisSupported(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window
}

let cachedVoices: SpeechSynthesisVoice[] = []

function loadVoices(): SpeechSynthesisVoice[] {
  if (!isSpeechSynthesisSupported()) return []
  const voices = window.speechSynthesis.getVoices()
  if (voices.length) cachedVoices = voices
  return cachedVoices
}

if (isSpeechSynthesisSupported()) {
  loadVoices()
  window.speechSynthesis.onvoiceschanged = () => loadVoices()
}

function findVoice(tag: string): SpeechSynthesisVoice | null {
  const voices = loadVoices()
  if (!voices.length) return null
  const exact = voices.find((v) => v.lang.toLowerCase().replace('_', '-') === tag.toLowerCase())
  if (exact) return exact
  const base = tag.split('-')[0].toLowerCase()
  return voices.find((v) => v.lang.toLowerCase().startsWith(base)) ?? null
}

/** Picks the closest installed voice, walking the fallback chain. */
export function pickVoice(lang: string): SpeechSynthesisVoice | null {
  const chain = VOICE_FALLBACKS[lang] ?? [lang, 'en-US']
  for (const tag of chain) {
    const voice = findVoice(tag)
    if (voice) return voice
  }
  const voices = loadVoices()
  return voices[0] ?? null
}

/** True when a voice for the requested language itself is installed. */
export function isLanguageVoiceAvailable(lang: string): boolean {
  return findVoice(lang) !== null
}

/** True when a genuine Urdu synthesis voice exists on this machine. */
export function isUrduVoiceAvailable(): boolean {
  return findVoice('ur') !== null
}

/** Human-readable name of the voice that will actually speak. */
export function describeActiveVoice(lang: string): string {
  const voice = pickVoice(lang)
  return voice ? `${voice.name} (${voice.lang})` : 'No voice installed'
}

/**
 * Chooses which written variant of a phrase to speak.
 *
 * Urdu script is only used when a real Urdu voice exists, because an English
 * voice cannot pronounce it at all. Otherwise Urdu mode speaks Roman Urdu,
 * which an English voice renders closely enough to be understood.
 */
export function resolvePhrase(input: string | Phrase, lang: string): string {
  if (typeof input === 'string') return input
  const tag = lang.toLowerCase()
  // Urdu and the code-mixed profile both speak Urdu; only the script differs
  // by whether a real Urdu voice exists to pronounce it.
  if (tag.startsWith('ur') || tag === 'auto') {
    return isUrduVoiceAvailable() && tag.startsWith('ur') ? input.ur : input.roman
  }
  return input.en
}

// ------------------------------------------------------- speaking observers

type SpeakingListener = (speaking: boolean) => void
const speakingListeners = new Set<SpeakingListener>()
let speakingNow = false

function setSpeaking(value: boolean) {
  if (speakingNow === value) return
  speakingNow = value
  speakingListeners.forEach((listener) => listener(value))
}

/**
 * Notifies when speech output starts and stops.
 *
 * The continuous microphone session subscribes to this so it can stand down
 * while AwazPay talks; otherwise recognition transcribes the app's own voice
 * and the assistant answers itself.
 */
export function onSpeakingChange(listener: SpeakingListener): () => void {
  speakingListeners.add(listener)
  return () => speakingListeners.delete(listener)
}

export function isSpeaking(): boolean {
  return speakingNow || (isSpeechSynthesisSupported() && window.speechSynthesis.speaking)
}

// ------------------------------------------------------------------ speaking

let currentUtterance: SpeechSynthesisUtterance | null = null

export function speak(text: string, options: SpeakOptions = {}): void {
  const { rate = 1, lang = URDU_LANG, pitch = 1, interrupt = true, onStart, onEnd, onError } = options

  if (!isSpeechSynthesisSupported() || !text.trim()) {
    // Without synthesis the caller still needs its continuation to run.
    onEnd?.()
    return
  }

  if (interrupt) window.speechSynthesis.cancel()

  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = rate
  utterance.pitch = pitch
  const voice = pickVoice(lang)
  if (voice) {
    utterance.voice = voice
    utterance.lang = voice.lang
  } else {
    utterance.lang = lang
  }

  let finished = false
  const finish = (failed: boolean) => {
    if (finished) return
    finished = true
    currentUtterance = null
    setSpeaking(false)
    if (failed) onError?.()
    onEnd?.()
  }

  utterance.onstart = () => {
    setSpeaking(true)
    onStart?.()
  }
  utterance.onend = () => finish(false)
  utterance.onerror = () => finish(true)

  currentUtterance = utterance
  setSpeaking(true)
  window.speechSynthesis.speak(utterance)

  // Chrome silently drops long utterances when the tab is backgrounded; this
  // guard makes sure a flow waiting on onEnd is never stranded.
  const guardMs = Math.max(4000, text.length * 95)
  setTimeout(() => {
    if (currentUtterance === utterance && !window.speechSynthesis.speaking) finish(false)
  }, guardMs)
}

/** Promise form of {@link speak}; resolves when the utterance finishes. */
export function speakAsync(text: string, options: Omit<SpeakOptions, 'onEnd'> = {}): Promise<void> {
  return new Promise((resolve) => {
    speak(text, { ...options, onEnd: resolve })
  })
}

export function stopSpeaking(): void {
  if (!isSpeechSynthesisSupported()) return
  currentUtterance = null
  window.speechSynthesis.cancel()
  setSpeaking(false)
}
