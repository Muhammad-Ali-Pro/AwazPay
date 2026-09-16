/**
 * intentService — natural language understanding.
 *
 * Converts a raw speech transcript into a structured {@link ParsedIntent}.
 *
 * The MVP ships a fully local, dependency-free parser: keyword and pattern
 * rules plus slot extraction for amounts, recipients and mobile numbers. It
 * needs no API key and no network, so the hackathon demo works offline.
 *
 * It handles four input shapes, because Chrome returns different scripts
 * depending on the recognition language in use:
 *
 *   1. Urdu script          میرا بیلنس بتاؤ
 *   2. Roman Urdu           mera balance batao
 *   3. English              what is my balance
 *   4. Mixed                Ahmed ko 5000 rupay bhejo
 *
 * It does NOT claim to understand every phrasing, accent or dialect. When a
 * hosted multilingual model is available later, implement
 * {@link IntentProvider} and register it with {@link setIntentProvider}; every
 * caller goes through {@link parseTranscript} and needs no change.
 */
import type { IntentProvider, IntentSlots, ParsedIntent, VoiceIntent } from '../types/voice'
import { DEMO_RECIPIENTS } from '../data/demoWallet'
import { normalizeForIntent } from './normalizationService'
import type { RecognitionAlternative } from './diagnosticsService'

export const WAKE_PHRASE = 'Hey AwazPay'

/**
 * Wake-phrase spellings.
 *
 * Recognisers mangle "AwazPay" in predictable ways, and the Urdu recogniser
 * returns Urdu script, so both are matched. The greeting word is optional:
 * a bare "AwazPay" wakes the assistant too.
 */
const WAKE_PATTERNS = [
  /\b(hey|hi|hello|ok|okay|hay)\s*,?\s*(awaz\s*pay|awaaz\s*pay|awazpay|awaazpay|a\s*was\s*pay|aawaz\s*pay|avaz\s*pay|our\s*was\s*pay|was\s*pay|award\s*pay)\b/g,
  /\b(awaz\s*pay|awaaz\s*pay|awazpay|awaazpay|aawaz\s*pay|avaz\s*pay)\b/g,
  /(ہے|ہائے|اے)?\s*(آواز\s*پے|اواز\s*پے|آوازپے)/g,
]

const ENGLISH_UNITS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
  seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50,
  sixty: 60, seventy: 70, eighty: 80, ninety: 90,
}

/** Roman Urdu numerals, with the spelling variants people actually say. */
const URDU_UNITS: Record<string, number> = {
  ek: 1, aik: 1, do: 2, teen: 3, tean: 3, char: 4, chaar: 4, panch: 5, paanch: 5, panj: 5,
  che: 6, chay: 6, cheh: 6, chhe: 6, saat: 7, aath: 8, nau: 9,
  das: 10, dus: 10, bees: 20, bis: 20, tees: 30, chalees: 40, pachas: 50, pachaas: 50,
}

/** Urdu-script numerals. */
const URDU_SCRIPT_UNITS: Record<string, number> = {
  'ایک': 1, 'دو': 2, 'تین': 3, 'چار': 4, 'پانچ': 5, 'چھ': 6, 'چھے': 6, 'سات': 7,
  'آٹھ': 8, 'نو': 9, 'دس': 10, 'بیس': 20, 'تیس': 30, 'چالیس': 40, 'پچاس': 50,
}

const SCALES: Record<string, number> = {
  hundred: 100, sau: 100,
  thousand: 1000, hazaar: 1000, hazar: 1000, hazzar: 1000, k: 1000,
  lakh: 100000, lac: 100000, lakhs: 100000,
  million: 1000000,
  'سو': 100, 'ہزار': 1000, 'لاکھ': 100000,
}

/** Words that mark a nearby number as a money amount. */
const CURRENCY_WORDS = /(\b(rupees?|rupay|rupaye|rs|pkr|paisay?|paise|amount)\b|روپے|روپیہ|پیسے|رقم)/

/**
 * Eastern Arabic-Indic and Persian digits, as returned by Urdu recognition,
 * mapped to ASCII so one number path handles every script.
 */
const DIGIT_MAP: Record<string, string> = {
  '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4', '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
  '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4', '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
}

/** Rewrites non-ASCII digits to ASCII. */
export function normalizeDigits(text: string): string {
  return text.replace(/[٠-٩۰-۹]/g, (d) => DIGIT_MAP[d] ?? d)
}

interface Rule {
  intent: VoiceIntent
  patterns: RegExp[]
}

/**
 * Rules are evaluated top to bottom, so the more specific financial flows come
 * before the generic ones: "mobile load" must win over "pay".
 *
 * Each intent lists English, Roman Urdu and Urdu-script forms together, so a
 * new command alias only ever has to be added in one place.
 */
const RULES: Rule[] = [
  // Conversational rules come first. They are unambiguous, they never move
  // money, and answering "hello" with "I didn't understand" is the single
  // rudest thing a voice assistant can do to someone relying on it.
  {
    intent: 'greeting',
    patterns: [
      /\b(salam|salaam|assalam|hello|hallo|hi|hey there)\b/,
      /\bgood\s*(morning|afternoon|evening)\b/,
      /(السلام|سلام|ہیلو)/,
    ],
  },
  {
    intent: 'how_are_you',
    patterns: [
      /\bhow\s*(are\s*you|r\s*u|is\s*it\s*going)\b/,
      /\b(kya\s*haal|kaise\s*ho|kaisay\s*ho|kese\s*ho|sab\s*theek)\b/,
      /(کیا\s*حال|کیسے\s*ہو)/,
    ],
  },
  {
    intent: 'capabilities',
    patterns: [
      /\bwhat\s*can\s*you\s*(do|help)\b/,
      /\bwho\s*are\s*you\b/,
      /\b(tum|aap)\s*kya\s*kar\s*sakt/,
      /\btum\s*kaun\s*ho\b/,
      /(کیا\s*کر\s*سکتے|تم\s*کون\s*ہو|آپ\s*کون)/,
    ],
  },
  {
    intent: 'thanks',
    patterns: [/\b(thanks|thank\s*you|shukriya)\b/, /(شکریہ)/],
  },
  {
    intent: 'cancel',
    patterns: [
      /\b(cancel|abort|never\s*mind|nevermind)\b/,
      /\bstop\s+(the\s+)?(transaction|payment)\b/,
      /\b(band\s*kar|rehne\s*do|rok\s*do|chhod\s*do)\b/,
      /(منسوخ|بند\s*کر|رہنے\s*دو|روک\s*دو)/,
    ],
  },
  {
    intent: 'stop_listening',
    patterns: [
      /\b(stop\s*listening|go\s*to\s*sleep)\b/,
      /\b(sunna\s*band|khamosh\s*ho\s*ja|chup\s*ho\s*ja)\b/,
      /(سننا\s*بند|خاموش\s*ہو|چپ\s*ہو)/,
    ],
  },
  {
    intent: 'confirm',
    patterns: [
      /\b(confirm|proceed|approve|go\s*ahead)\b/,
      /\b(haan|han|ji\s*haan|theek\s*hai|thik\s*hai|tasdeeq)\b/,
      /(تصدیق|جی\s*ہاں|ٹھیک\s*ہے|منظور)/,
      // "kar do" alone is deliberately excluded: it is a generic Urdu verb
      // suffix ("load kar do", "bhej kar do"), not a confirmation on its
      // own, and matching it here swallowed real commands that happen to
      // end that way. The app's own prompts always ask for "confirm" or
      // "tasdeeq" specifically, never bare "kar do".
    ],
  },
  {
    intent: 'repeat',
    patterns: [
      /\b(repeat|say\s*(that\s*)?again|pardon)\b/,
      /\b(dobara|phir\s*se)\b/,
      /(دوبارہ|پھر\s*سے)/,
    ],
  },
  {
    intent: 'pay_nfc',
    patterns: [
      /\b(nfc|n\s*f\s*c|tap\s*to\s*pay|tap\s*payment|contactless)\b/,
      /\bnfc\s*se\s*(pay|payment|paisay?)/,
      /\b(terminal|card\s*machine)\b/,
      /(این\s*ایف\s*سی|ٹرمینل)/,
    ],
  },
  {
    intent: 'mobile_topup',
    patterns: [
      /\b(mobile|phone|cell)\s*(top\s*up|topup|load|recharge)\b/,
      /\b(top\s*up|topup|recharge)\b/,
      /\bload\s*(karna|kar|karo|kardo|chahiye|krna|kro)\b/,
      /\bload\b[\s\S]*\b(mobile|phone|number|karna|kar)\b/,
      /\b(mobile|phone)\b[\s\S]*\bload\b/,
      /\bmujhe\b[\s\S]*\bload\b/,
      /\b(easyload|easy\s*load)\b/,
      /(موبائل\s*لوڈ|لوڈ\s*کر|بیلنس\s*لوڈ|ریچارج)/,
    ],
  },
  {
    intent: 'cash_deposit',
    patterns: [
      /\b(cash\s*deposit|deposit\s*cash|deposit\s*money)\b/,
      /\b(paisay?\s*jama|paise\s*jama|jama\s*kar|cash\s*jama)\b/,
      /\bdeposit\b/,
      /(کیش\s*ڈپازٹ|جمع\s*کر|رقم\s*جمع)/,
    ],
  },
  {
    intent: 'check_balance',
    patterns: [
      /\bbalance\b/,
      /\bhow\s*much\s*(money|do\s*i\s*have)\b/,
      /\b(kitne?\s*paisay?|kitna\s*paisa|mere?\s*pass\s*kitna)\b/,
      /(بیلنس|کتنے\s*پیسے|کتنا\s*پیسہ)/,
    ],
  },
  {
    intent: 'last_transaction',
    patterns: [
      /\b(last|latest|previous)\s*(transaction|payment)\b/,
      /\b(akhri|pichli)\s*(transaction|payment)\b/,
      /(آخری\s*ٹرانزیکشن|پچھلی\s*ادائیگی)/,
    ],
  },
  {
    intent: 'recent_transactions',
    patterns: [
      /\b(recent\s*transaction|transaction\s*history|my\s*(transactions|history)|statement|activity)\b/,
      /\b(history\s*batao|activity\s*kholo)\b/,
      // Bare "transactions batao/dikhao" without "my"/"history" in front, as
      // in "Kal ki transactions batao" (yesterday's transactions). AwazPay
      // does not filter by date in this MVP, so this still opens the general
      // transaction history rather than leaving the phrase unrecognised.
      /\btransactions?\s*(batao|dikhao|bata\s*do)\b/,
      /(ٹرانزیکشن\s*ہسٹری|حالیہ\s*ٹرانزیکشن|ایکٹیویٹی|ٹرانزیکشنز\s*بتاؤ)/,
    ],
  },
  {
    intent: 'receive_money',
    patterns: [
      /\b(receive\s*money|receive\s*payment|get\s*paid)\b/,
      /\b(paisay?\s*wasool|paise\s*lene)\b/,
      /(پیسے\s*وصول|رقم\s*وصول)/,
      /^receive$/,
    ],
  },
  {
    intent: 'trusted_circle',
    patterns: [
      /\btrusted\s*(circle|contact|person)\b/,
      /(ٹرسٹڈ\s*سرکل|بھروسے\s*کا\s*فرد)/,
    ],
  },
  {
    intent: 'open_settings',
    patterns: [/\b(settings|preferences)\b/, /(سیٹنگز|ترتیبات)/],
  },
  {
    intent: 'go_home',
    patterns: [
      /\b(go\s*home|main\s*menu|home\s*screen)\b/,
      /\bhome\s*(kholo|par\s*jao|chalo)\b/,
      /^home$/,
      /(ہوم\s*کھولو|مرکزی\s*صفحہ)/,
    ],
  },
  {
    intent: 'go_back',
    patterns: [
      /\b(go\s*back|back|previous\s*screen)\b/,
      /\b(wapas|wapis)\b/,
      /(واپس|پیچھے)/,
    ],
  },
  {
    intent: 'help',
    patterns: [
      /\b(help|commands)\b/,
      /\bwhat\s*can\s*(you|i)\s*(do|say)\b/,
      /\b(madad|kya\s*keh\s*sakta)\b/,
      /(مدد|کیا\s*کہہ\s*سکتا)/,
    ],
  },
  {
    intent: 'pay',
    patterns: [
      /\b(pay|send|transfer|payment)\b/,
      /\b(bhej|bhejna|bhejo|bhejne|de\s*do|dena\s*hai|transfer\s*kar|ada\s*kar)\b/,
      /\b(paisay?|paise)\s*(bhej|de)\b/,
      /(بھیجو|بھیجنا|ادائیگی|منتقل)/,
    ],
  },
]

/**
 * Lower-cases, strips punctuation, normalises digits and collapses
 * whitespace. Urdu script is preserved; only its punctuation is removed.
 */
export function normalizeTranscript(raw: string): string {
  return normalizeDigits(raw)
    .toLowerCase()
    // Hyphens become spaces so "top-up" matches the same rules as "top up".
    .replace(/[.,!?;:'"()\-_/،۔؟]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function containsWakePhrase(raw: string): boolean {
  const text = normalizeTranscript(raw)
  return WAKE_PATTERNS.some((pattern) => {
    pattern.lastIndex = 0
    return pattern.test(text)
  })
}

/** Removes the wake phrase so the remaining words are the command itself. */
export function stripWakePhrase(raw: string): string {
  let text = normalizeTranscript(raw)
  for (const pattern of WAKE_PATTERNS) {
    pattern.lastIndex = 0
    text = text.replace(pattern, ' ')
  }
  return text.replace(/\s+/g, ' ').trim()
}

/** Extracts a Pakistani mobile number, tolerating spaces and dashes. */
export function extractMobileNumber(text: string): string | undefined {
  const compact = normalizeDigits(text).replace(/[\s-]/g, '')
  const match = compact.match(/(^|\D)(0?3\d{9})(\D|$)/)
  if (!match) return undefined
  const raw = match[2]
  const digits = raw.startsWith('0') ? raw : `0${raw}`
  return `${digits.slice(0, 4)} ${digits.slice(4)}`
}

/**
 * Extracts a money amount from digits ("500", "۵۰۰", "2,500", "2k") or from
 * spoken words in English ("five hundred"), Roman Urdu ("do hazaar",
 * "paanch sau") or Urdu script ("پانچ ہزار").
 */
export function extractAmount(text: string): number | undefined {
  // Strip any mobile number first so its digits are never read as an amount.
  const cleaned = normalizeDigits(text).replace(/\b0?3[\d\s-]{9,13}\b/g, ' ')

  const shorthand = cleaned.match(/\b(\d+(?:\.\d+)?)\s*(k|hazaar|hazar|thousand|lakh|lac)\b/)
  if (shorthand) {
    const scale = SCALES[shorthand[2]] ?? 1000
    const value = Math.round(Number(shorthand[1]) * scale)
    if (value > 0) return value
  }
  // Same shorthand with an Urdu-script scale word: "5 ہزار".
  const urduShorthand = cleaned.match(/(\d+(?:\.\d+)?)\s*(سو|ہزار|لاکھ)/)
  if (urduShorthand) {
    const value = Math.round(Number(urduShorthand[1]) * (SCALES[urduShorthand[2]] ?? 1000))
    if (value > 0) return value
  }

  const digits = cleaned.match(/(\d[\d,]*)/)
  if (digits) {
    const value = Number(digits[1].replace(/,/g, ''))
    if (Number.isFinite(value) && value > 0) return value
  }

  // Spoken-word numbers: accumulate units, multiply out on each scale word.
  const tokens = cleaned.split(' ')
  let total = 0
  let current = 0
  let sawNumberWord = false
  let sawScale = false

  for (const token of tokens) {
    const unit = ENGLISH_UNITS[token] ?? URDU_UNITS[token] ?? URDU_SCRIPT_UNITS[token]
    if (unit !== undefined) {
      current += unit
      sawNumberWord = true
      continue
    }
    const scale = SCALES[token]
    if (scale !== undefined) {
      current = Math.max(current, 1) * scale
      total += current
      current = 0
      sawNumberWord = true
      sawScale = true
    }
  }
  total += current

  // Several Roman Urdu numerals are also ordinary words: "do" is both "two"
  // and the English verb. A bare word-number is only trusted when a scale
  // word or a currency word is present, so "do a mobile top-up" is not read
  // as an amount of two rupees.
  const hasCurrencyWord = CURRENCY_WORDS.test(cleaned)
  if (sawNumberWord && total > 0 && (sawScale || hasCurrencyWord)) return total
  return undefined
}

const RECIPIENT_STOPWORDS = new Set([
  'rupees', 'rupee', 'rupay', 'rupaye', 'rs', 'pkr', 'paisay', 'paise', 'ka', 'ki', 'ke',
  'please', 'now', 'today', 'account', 'my', 'the', 'a', 'an', 'mobile', 'number', 'load',
  'karna', 'hai', 'hain', 'kardo', 'karo', 'do', 'chahiye', 'bhejo', 'bhej', 'bhejne', 'dena',
  'want', 'i', 'mujhe', 'main',
])

function cleanRecipient(candidate: string): string | undefined {
  const words = candidate
    .split(' ')
    .map((w) => w.trim())
    .filter((w) => w && !/^\d+$/.test(w) && !RECIPIENT_STOPWORDS.has(w))
  if (!words.length) return undefined
  const name = words.slice(0, 3).join(' ')
  if (name.length < 2) return undefined
  return name.replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Urdu-script spellings of the demo recipients, for Urdu recognition. */
const URDU_NAME_ALIASES: Record<string, string> = {
  'احمد': 'Ahmed Khan',
  'فاطمہ': 'Fatima Noor',
  'بلال': 'Bilal Raza',
  'ثنا': 'Sana Malik',
}

/** Extracts a payee from "pay X to Ahmed", "Ahmed ko bhejo" or a known name. */
export function extractRecipient(text: string): string | undefined {
  for (const [urdu, name] of Object.entries(URDU_NAME_ALIASES)) {
    if (text.includes(urdu)) return name
  }

  const known = DEMO_RECIPIENTS.find((name) => text.includes(name.toLowerCase()))
  if (known) return known

  const byFirstName = DEMO_RECIPIENTS.find((name) => {
    const first = name.split(' ')[0].toLowerCase()
    return new RegExp(`\\b${first}\\b`).test(text)
  })
  if (byFirstName) return byFirstName

  const toMatch = text.match(/\b(?:to|for)\s+([a-z][a-z\s]{1,30})$/)
  if (toMatch) {
    const cleaned = cleanRecipient(toMatch[1])
    if (cleaned) return cleaned
  }

  // Roman Urdu marks the payee with a trailing "ko".
  const koMatch = text.match(/\b([a-z][a-z\s]{1,24}?)\s+ko\b/)
  if (koMatch) {
    const cleaned = cleanRecipient(koMatch[1])
    if (cleaned) return cleaned
  }

  return undefined
}

function scoreConfidence(intent: VoiceIntent, slots: IntentSlots): number {
  if (intent === 'unknown') return 0
  let score = 0.7
  if (slots.amount) score += 0.15
  if (slots.recipient) score += 0.1
  return Math.min(score, 0.99)
}

/** Intents that move money, and so must never run on a shaky transcript. */
const FINANCIAL_INTENTS: ReadonlySet<VoiceIntent> = new Set<VoiceIntent>([
  'pay',
  'pay_nfc',
  'mobile_topup',
  'cash_deposit',
])

export function isFinancialIntent(intent: VoiceIntent): boolean {
  return FINANCIAL_INTENTS.has(intent)
}

/** The offline parser that backs the MVP. */
export const localIntentProvider = {
  name: 'local-multilingual-parser' as const,
  parse(transcript: string): ParsedIntent {
    const raw = transcript ?? ''
    const wakeWordDetected = containsWakePhrase(raw)
    // Roman Urdu spelling variants and known mishearings are folded onto
    // canonical words before any rule runs, so the rules below stay small.
    const stripped = stripWakePhrase(raw)
    const normalized = normalizeForIntent(stripped).normalized

    let intent: VoiceIntent = 'unknown'
    for (const rule of RULES) {
      if (rule.patterns.some((pattern) => pattern.test(normalized))) {
        intent = rule.intent
        break
      }
    }

    const slots: IntentSlots = {}
    if (intent === 'pay' || intent === 'pay_nfc' || intent === 'mobile_topup' || intent === 'cash_deposit') {
      const amount = extractAmount(normalized)
      if (amount) slots.amount = amount
    }
    if (intent === 'pay') {
      const recipient = extractRecipient(normalized)
      if (recipient) slots.recipient = recipient
    }
    if (intent === 'mobile_topup') {
      const mobileNumber = extractMobileNumber(normalized)
      if (mobileNumber) slots.mobileNumber = mobileNumber
    }

    // "Hi AwazPay" and "Salam AwazPay" leave nothing behind once the wake
    // phrase is stripped, but the user did greet us and deserves a greeting
    // back. "hey" and "ok" are excluded: those are wake words, not greetings.
    if (intent === 'unknown' && !normalized) {
      const bare = normalizeTranscript(raw)
      if (/\b(hi|hello|hallo|salam|salaam|assalam)\b/.test(bare) || /(سلام|ہیلو)/.test(bare)) {
        intent = 'greeting'
      }
    }

    // "2000 rupees" with no recognised verb is most likely a payment.
    if (intent === 'unknown' && CURRENCY_WORDS.test(normalized)) {
      const amount = extractAmount(normalized)
      if (amount) {
        intent = 'pay'
        slots.amount = amount
        const recipient = extractRecipient(normalized)
        if (recipient) slots.recipient = recipient
      }
    }

    return { intent, slots, confidence: scoreConfidence(intent, slots), raw, normalized, wakeWordDetected }
  },
} satisfies IntentProvider

let provider: IntentProvider = localIntentProvider

/**
 * Swaps in a different understanding engine, for example a hosted
 * multilingual model. Falls back to the local parser if the provider throws.
 */
export function setIntentProvider(next: IntentProvider): void {
  provider = next
}

export function getIntentProvider(): IntentProvider {
  return provider
}

export async function parseTranscript(transcript: string): Promise<ParsedIntent> {
  try {
    return await provider.parse(transcript)
  } catch {
    return localIntentProvider.parse(transcript)
  }
}

/** Synchronous parse against the local provider, for simple callers. */
export function parseTranscriptSync(transcript: string): ParsedIntent {
  return localIntentProvider.parse(transcript)
}

/** Back-compatible helper that returns only the intent name. */
export function parseIntent(transcript: string): VoiceIntent {
  return localIntentProvider.parse(transcript).intent
}

/** One candidate reading of an utterance, scored. */
export interface Interpretation {
  parsed: ParsedIntent
  /** Index into the alternatives array the engine returned. */
  index: number
  /** The recogniser's own confidence for this reading, 0 when not reported. */
  recognitionConfidence: number
  /** Combined score used to pick a winner. */
  score: number
}

/**
 * Picks the best reading of one utterance from the engine's ranked alternatives.
 *
 * This is the core accuracy fix for accented speech. Recognisers rank purely on
 * acoustic likelihood against a general accent model, so for a Pakistani
 * speaker the intended sentence often sits at position two or three while
 * position one is nonsense like "mera balance potato". Only this app knows
 * which readings are meaningful commands, so it re-ranks: a lower alternative
 * that forms a real command beats a top alternative that forms none.
 *
 * The engine's own confidence still counts, so a high-confidence reading is not
 * discarded on a weak pattern match.
 */
export function pickBestInterpretation(alternatives: RecognitionAlternative[]): Interpretation | null {
  if (!alternatives.length) return null

  const scored: Interpretation[] = alternatives.map((alternative, index) => {
    const parsed = localIntentProvider.parse(alternative.transcript)
    const recognitionConfidence = alternative.confidence ?? 0

    // A reading that yields an intent is worth far more than one that does not.
    let score = parsed.intent === 'unknown' ? 0 : 1
    score += parsed.confidence * 0.6
    // Filled slots are strong evidence the reading is the intended one.
    if (parsed.slots.amount) score += 0.35
    if (parsed.slots.recipient) score += 0.25
    if (parsed.wakeWordDetected) score += 0.3
    // The engine's ranking is still a real signal, just not the only one.
    score += recognitionConfidence * 0.5
    score -= index * 0.08

    return { parsed, index, recognitionConfidence, score }
  })

  scored.sort((a, b) => b.score - a.score)
  return scored[0]
}

/** Reads a plain yes/no answer during a slot-filling question. */
/**
 * The spoken main menu.
 *
 * Numbers are the shortest thing a person can say and the most reliably
 * recognised, which matters more than expressiveness when the user cannot
 * see the screen and every mis-hear costs them a retry.
 */
export interface MenuOption {
  number: number
  /** The intent this option triggers, routed through the normal engine. */
  intent: VoiceIntent
  /** Short label for the on-screen mirror of the menu. */
  label: string
}

export const MENU_OPTIONS: MenuOption[] = [
  { number: 1, intent: 'pay_nfc', label: 'NFC payment' },
  { number: 2, intent: 'pay', label: 'Transfer money to someone' },
  { number: 3, intent: 'check_balance', label: 'Check your balance' },
  { number: 4, intent: 'recent_transactions', label: 'Account activity' },
  { number: 5, intent: 'cash_deposit', label: 'Cash deposit' },
]

/** Spoken forms of 1 to 5, in English, Roman Urdu and Urdu script. */
const MENU_NUMBER_WORDS: Record<string, number> = {
  one: 1, won: 1, ek: 1, aik: 1, 'ایک': 1,
  two: 2, to: 2, too: 2, do: 2, 'دو': 2,
  three: 3, tree: 3, teen: 3, tean: 3, 'تین': 3,
  four: 4, for: 4, fore: 4, char: 4, chaar: 4, 'چار': 4,
  five: 5, panch: 5, paanch: 5, panj: 5, 'پانچ': 5,
}

/**
 * Reads a menu choice out of an utterance.
 *
 * Accepts a bare digit, a spoken number in any of the three scripts, and the
 * natural phrasings around them ("option two", "number 3", "press four").
 * Also accepts the option's own name, because a user who remembers "balance"
 * should not be forced to remember that balance is number three.
 *
 * Returns null when the utterance is not a menu choice, so callers can fall
 * through to normal command parsing.
 */
export function parseMenuSelection(transcript: string): MenuOption | null {
  const text = normalizeForIntent(stripWakePhrase(transcript)).normalized
  if (!text) return null

  // A bare digit, or one wrapped in the usual menu phrasing.
  const digit = text.match(/(?:^|\b)(?:option|number|press|say|choice)?\s*([1-5])(?:\b|$)/)
  if (digit) {
    const option = MENU_OPTIONS.find((o) => o.number === Number(digit[1]))
    if (option) return option
  }

  // A spoken number word. Checked token by token so "two" inside a longer
  // sentence does not hijack a real command.
  const tokens = text.split(/\s+/)
  for (let i = 0; i < tokens.length; i++) {
    const value = MENU_NUMBER_WORDS[tokens[i]]
    if (value === undefined) continue
    // Only trust a number word when the utterance is short, or when it is
    // introduced by a menu word. "Send two thousand to Ahmed" is not a menu
    // choice even though it contains "two".
    const introduced = i > 0 && /^(option|number|press|say|choice)$/.test(tokens[i - 1])
    if (introduced || tokens.length <= 2) {
      const option = MENU_OPTIONS.find((o) => o.number === value)
      if (option) return option
    }
  }

  return null
}

/** True when the user asked to hear the menu again. */
export function isMenuRequest(transcript: string): boolean {
  const text = normalizeForIntent(stripWakePhrase(transcript)).normalized
  return /\b(menu|options|list|choices|what\s*can\s*i\s*say|dobara|phir\s*se)\b/.test(text) || /(مینو|فہرست)/.test(text)
}

export function isAffirmative(transcript: string): boolean {
  const text = normalizeTranscript(transcript)
  return /\b(yes|yeah|yep|sure|ok|okay|correct|right|haan|han|ji|theek|thik)\b/.test(text) || /(ہاں|جی|ٹھیک)/.test(text)
}

export function isNegative(transcript: string): boolean {
  const text = normalizeTranscript(transcript)
  return /\b(no|nope|nah|wrong|incorrect|nahi|nahin|galat)\b/.test(text) || /(نہیں|غلط)/.test(text)
}
