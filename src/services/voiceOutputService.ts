/**
 * voiceOutputService — Text-to-Speech.
 *
 * Wraps the browser SpeechSynthesis API. Voice is the primary output channel
 * in AwazPay, so this service is the single place that speaks: sensitive
 * figures are delivered here rather than rendered on screen.
 *
 * Output is English by default. Urdu remains available by choosing the Urdu
 * profile in Settings, which uses Urdu script when a real Urdu voice is
 * installed and Roman Urdu when one is not.
 *
 * Voices are chosen by quality, not by list order — see `voiceQuality`. That
 * one change is the difference between the flat legacy desktop voices and the
 * modern neural ones most machines also have installed.
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

/** Spoken output language when a caller does not specify one. */
export const DEFAULT_LANG = 'en-US'

/** Tried in order when the requested language has no installed voice. */
const VOICE_FALLBACKS: Record<string, string[]> = {
  // 'auto' speaks English. Recognition still accepts Roman Urdu and Urdu,
  // but the reply comes back in English so the voice and the words match.
  auto: ['en-US', 'en-GB', 'en-IN', 'en-PK'],
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

/**
 * Scores a voice on how natural it is likely to sound.
 *
 * The old picker just took the first voice whose language tag matched. On
 * Windows that is almost always "Microsoft David/Zira Desktop", the legacy
 * SAPI5 voices, which sound flat and robotic — and were the reason speech
 * output sounded synthetic. Modern browsers ship far better voices alongside
 * them; they simply are not first in the list.
 *
 * Ranking, highest first:
 *   +100  Microsoft "Natural" / "Neural" voices (by far the best on Windows)
 *   +80   Google voices (Chrome's own, consistently good)
 *   +40   any other network-backed voice (localService === false)
 *   -60   known legacy desktop voices, which are the robotic ones
 */
function voiceQuality(voice: SpeechSynthesisVoice): number {
  const name = voice.name.toLowerCase()
  let score = 0

  if (name.includes('natural') || name.includes('neural')) score += 100
  if (name.includes('google')) score += 80
  if (name.includes('online')) score += 30
  if (!voice.localService) score += 40
  // Legacy SAPI5 desktop voices: intelligible, but unmistakably synthetic.
  if (name.includes('desktop') || /\b(david|zira|mark|hazel)\b/.test(name)) score -= 60
  if (voice.default) score += 5

  return score
}

/** Best available voice for a tag, by quality rather than list order. */
function findVoice(tag: string): SpeechSynthesisVoice | null {
  const voices = loadVoices()
  if (!voices.length) return null
  const wanted = tag.toLowerCase()
  const base = wanted.split('-')[0]

  const exact = voices.filter((v) => v.lang.toLowerCase().replace('_', '-') === wanted)
  const sameLanguage = voices.filter((v) => v.lang.toLowerCase().startsWith(base))
  const pool = exact.length ? exact : sameLanguage
  if (!pool.length) return null

  return pool.slice().sort((a, b) => voiceQuality(b) - voiceQuality(a))[0]
}

/** Every installed voice, ranked, for the Settings diagnostics readout. */
export function listRankedVoices(lang: string): Array<{ name: string; lang: string; score: number }> {
  const base = lang.toLowerCase().split('-')[0]
  return loadVoices()
    .filter((v) => v.lang.toLowerCase().startsWith(base))
    .map((v) => ({ name: v.name, lang: v.lang, score: voiceQuality(v) }))
    .sort((a, b) => b.score - a.score)
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

  // Urdu script is only ever spoken by a genuine Urdu voice; no English voice
  // can pronounce it at all.
  if (tag.startsWith('ur')) {
    return isUrduVoiceAvailable() ? input.ur : input.roman
  }

  // Everything else, including the 'auto' profile, speaks English.
  //
  // This used to return Roman Urdu for 'auto', which meant an English voice
  // was reading "Aapka balance private audio ke zariye bataya ja raha hai"
  // phonetically. That is the main reason output sounded wrong: the voice was
  // fine, the text simply was not English. Urdu output stays available by
  // choosing the Urdu profile explicitly in Settings.
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

/**
 * Light touch-ups that make synthesised speech sound less mechanical.
 *
 * Speech engines read punctuation as prosody, so a few substitutions buy a
 * lot of naturalness for free: currency read as words rather than a symbol,
 * digit groups spaced so they are grouped rather than rattled off, and a
 * comma inserted after an opening clause so the sentence has a breath in it.
 */
function humanise(text: string): string {
  return (
    text
      // "PKR 5,000" reads better as "5000 rupees" than as letters plus commas.
      .replace(/\bPKR\s*([\d,]+)/gi, (_, amount: string) => `${amount.replace(/,/g, '')} rupees`)
      .replace(/\bRs\.?\s*([\d,]+)/gi, (_, amount: string) => `${amount.replace(/,/g, '')} rupees`)
      // Thousands separators make engines pause oddly mid-number.
      .replace(/(\d),(\d{3})\b/g, '$1$2')
      // Give a short breath after a leading discourse word.
      .replace(/^(Sorry|Okay|Right|Well|Yes|No)\s+/i, '$1, ')
      // Collapse the double spaces those rules can leave behind.
      .replace(/\s{2,}/g, ' ')
      .trim()
  )
}

export function speak(text: string, options: SpeakOptions = {}): void {
  const { rate, lang = DEFAULT_LANG, pitch = 1, interrupt = true, onStart, onEnd, onError } = options

  if (!isSpeechSynthesisSupported() || !text.trim()) {
    // Without synthesis the caller still needs its continuation to run.
    onEnd?.()
    return
  }

  if (interrupt) window.speechSynthesis.cancel()

  const spoken = humanise(text)
  const utterance = new SpeechSynthesisUtterance(spoken)
  // Slightly under real time reads as measured and calm rather than rushed,
  // which matters more here than usual: this is the only channel the user
  // has, and every figure in it is financial.
  utterance.rate = rate ?? 0.97
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
  const guardMs = Math.max(4000, spoken.length * 95)
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
