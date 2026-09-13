/**
 * normalizationService — cleans up what the recogniser heard before the intent
 * parser sees it.
 *
 * Two jobs, deliberately kept apart from each other and from intent detection:
 *
 *   1. VARIANT FOLDING. Pakistani Roman Urdu has no fixed spelling. "batao",
 *      "bata do" and "btao" are the same word; "rupay", "rupees" and "rupiya"
 *      are the same unit. Folding them onto canonical tokens means the intent
 *      rules stay small instead of listing every spelling.
 *
 *   2. TRANSCRIPTION CORRECTION. English speech models mis-hear Urdu words in
 *      consistent ways: "batao" comes back as "potato", "bhejo" as "bhajo" or
 *      "beige o". These are corrected only where the misheard token is close
 *      to a known command word.
 *
 * FINANCIAL SAFETY RULE: correction only ever touches command vocabulary.
 * Digits, amounts and names are never corrected, never inferred and never
 * invented. A misheard amount must fail and be asked again, because silently
 * "fixing" 5000 into 50000 would be far worse than admitting confusion.
 */

export interface NormalizationResult {
  /** Text for the intent parser: lower-cased, folded, corrected. */
  normalized: string
  /** Human-readable "heard -> used" pairs, for the diagnostics panel. */
  corrections: string[]
  /** True when at least one fuzzy correction was applied. */
  corrected: boolean
}

/**
 * Canonical command vocabulary.
 *
 * Key is the canonical token the intent rules match on. Values are the
 * spellings and mishearings that fold onto it.
 */
const VARIANTS: Record<string, string[]> = {
  // ---- "tell me" / balance enquiry
  batao: ['batao', 'bata', 'btao', 'bta', 'batado', 'bataao', 'batayen', 'bataye', 'batayein', 'bataiye'],
  balance: ['balance', 'balans', 'balence', 'ballance', 'bailans', 'bailance'],
  check: ['check', 'chek', 'cheque'],

  // ---- send / pay
  bhejo: ['bhejo', 'bhej', 'bhejna', 'bhejne', 'bhejdo', 'bhejdena', 'bejo', 'bhajo', 'bhejoo', 'behjo'],
  // Only true spellings of "karo". "kar" and "karna" are separate words that
  // appear inside phrase patterns, so folding them here corrupted sentences
  // such as "tum kya kar sakte ho".
  karo: ['karo', 'kro', 'karro', 'kardo'],
  paise: ['paise', 'paisay', 'paisa', 'pese', 'pesay', 'peasay'],
  rupay: ['rupay', 'rupaye', 'rupee', 'rupees', 'rupey', 'rupiya', 'rupiye', 'rupya', 'rs', 'pkr', 'rupaiya'],
  bhejna: ['bhejna', 'bhejni'],

  // ---- top-up
  load: ['load', 'lod', 'lode', 'loud'],
  mobile: ['mobile', 'mobail', 'moblie', 'mobil'],
  recharge: ['recharge', 'richarge', 'rechrge', 'richarge'],

  // ---- deposit
  jama: ['jama', 'jamma', 'jamaa'],
  deposit: ['deposit', 'depozit', 'diposit'],

  // ---- NFC
  nfc: ['nfc', 'n f c', 'ntc', 'nfz', 'enefsee', 'and if see', 'anfc'],
  contactless: ['contactless', 'contact less', 'tap'],

  // ---- confirmation and control
  confirm: ['confirm', 'confrm', 'konfirm', 'confirmed'],
  tasdeeq: ['tasdeeq', 'tasdiq', 'tasdik'],
  cancel: ['cancel', 'cancal', 'cansel', 'kensal'],
  haan: ['haan', 'han', 'hanji', 'haanji', 'ha'],
  nahi: ['nahi', 'nahin', 'nai', 'nahee'],

  // ---- navigation
  kholo: ['kholo', 'kholna', 'kholen', 'kholein', 'khol'],
  wapas: ['wapas', 'wapis', 'vapas', 'wapass'],

  // ---- greetings and small talk
  salam: ['salam', 'salaam', 'assalam', 'assalamualaikum', 'asalam', 'aslam', 'slam', 'salamalaikum'],
  madad: ['madad', 'madat', 'maddad'],
  shukriya: ['shukriya', 'shukria', 'shukrya', 'sukria'],

  // ---- misc filler that helps rules match
  mera: ['mera', 'mere', 'meri', 'mira'],
  mujhe: ['mujhe', 'muje', 'mujay', 'mujhy'],
  chahiye: ['chahiye', 'chahye', 'chaiye', 'chahiyay'],
  hazaar: ['hazaar', 'hazar', 'hazzar', 'hzar', 'hajar', 'hazara'],
  sau: ['sau', 'so hundred'],
  kitne: ['kitne', 'kitna', 'kitni'],
}

/**
 * Mishearings that are NOT close enough for fuzzy matching but are common and
 * unambiguous. Each maps a whole heard phrase onto its intended one.
 *
 * These are the ones observed from English speech models hearing Urdu.
 */
const PHRASE_CORRECTIONS: Array<[RegExp, string, string]> = [
  [/\bpotato\b/g, 'batao', 'potato'],
  [/\bpotatoes\b/g, 'batao', 'potatoes'],
  [/\bbut\s*ao\b/g, 'batao', 'but ao'],
  [/\bbata\s*oh\b/g, 'batao', 'bata oh'],
  [/\bbeige\s*o\b/g, 'bhejo', 'beige o'],
  [/\bbhai\s*jo\b/g, 'bhejo', 'bhai jo'],
  [/\bbage\s*o\b/g, 'bhejo', 'bage o'],
  [/\bmera\s*balance\s*bata\s*do\b/g, 'mera balance batao', 'bata do'],
  [/\bcurrent\s*karo\b/g, 'kar do', 'current karo'],
  [/\bkar\s*doe\b/g, 'kar do', 'kar doe'],
  [/\bmobile\s*lord\b/g, 'mobile load', 'mobile lord'],
  [/\bmobile\s*loud\b/g, 'mobile load', 'mobile loud'],
  [/\bload\s*corner\b/g, 'load karna', 'load corner'],
  [/\bpanch\s*hazard\b/g, 'paanch hazaar', 'panch hazard'],
  [/\bhazard\b/g, 'hazaar', 'hazard'],
  [/\bhazzard\b/g, 'hazaar', 'hazzard'],
  [/\bthousand\s*rupay\b/g, 'thousand rupay', 'thousand rupay'],
  [/\bawards\s*pay\b/g, 'awazpay', 'awards pay'],
  [/\bhey\s*was\s*pay\b/g, 'hey awazpay', 'hey was pay'],
  [/\ba\s*wash\s*pay\b/g, 'awazpay', 'a wash pay'],
  [/\bhow\s*was\s*pay\b/g, 'hey awazpay', 'how was pay'],
  [/\bnfc\s*se\b/g, 'nfc se', 'nfc se'],
  [/\bassalam\s*[uo]\s*alaikum\b/g, 'salam', 'assalam o alaikum'],
  [/\bassalamu\s*alaikum\b/g, 'salam', 'assalamu alaikum'],
  [/\bwalaikum\s*[ua]s?\s*salam\b/g, 'salam', 'walaikum assalam'],
  [/\bkya\s*haal\b/g, 'kya haal', 'kya haal'],
  [/\bkya\s*hal\b/g, 'kya haal', 'kya hal'],
]

/** Reverse index: variant spelling to canonical token. */
const VARIANT_INDEX = new Map<string, string>()
for (const [canonical, spellings] of Object.entries(VARIANTS)) {
  VARIANT_INDEX.set(canonical, canonical)
  for (const spelling of spellings) {
    if (!spelling.includes(' ')) VARIANT_INDEX.set(spelling, canonical)
  }
}

/** Multi-word variants have to be replaced before tokenising. */
const MULTIWORD_VARIANTS: Array<[string, string]> = Object.entries(VARIANTS).flatMap(([canonical, spellings]) =>
  spellings.filter((s) => s.includes(' ')).map((s) => [s, canonical] as [string, string]),
)

/** Levenshtein distance, capped for speed: returns `max + 1` once exceeded. */
function editDistance(a: string, b: string, max: number): number {
  if (Math.abs(a.length - b.length) > max) return max + 1
  let previous = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const current = [i]
    let rowMin = i
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      const value = Math.min(previous[j] + 1, current[j - 1] + 1, previous[j - 1] + cost)
      current.push(value)
      if (value < rowMin) rowMin = value
    }
    if (rowMin > max) return max + 1
    previous = current
  }
  return previous[b.length]
}

/** Digits are never touched: an amount must never be "corrected". */
const PROTECTED = /^\d+$/

/**
 * Common Urdu and English function words, never fuzzy-corrected.
 *
 * Without this, short grammatical words drift onto command words that happen
 * to be one edit away: "hain" became "haan" (yes) and "haal" became "haan"
 * too, so "kya haal hai" was read as a confirmation. Being one letter from a
 * command word is not evidence of being that command word.
 */
const FUNCTION_WORDS = new Set([
  'hai', 'hain', 'hay', 'ho', 'hoon', 'hun', 'haal', 'hal', 'kya', 'kyun', 'koi', 'kuch',
  'mein', 'main', 'meri', 'mere', 'mera', 'aap', 'tum', 'yeh', 'woh', 'wo', 'is', 'us',
  'se', 'ka', 'ki', 'ke', 'ko', 'aur', 'par', 'bhi', 'nahi', 'sakta', 'sakte', 'sakti',
  'kar', 'karna', 'karne', 'krna', 'chahta', 'chahti', 'raha', 'rahi', 'rahe',
  'the', 'and', 'you', 'are', 'can', 'for', 'with', 'what', 'that', 'this', 'have', 'want',
])

/**
 * Finds the canonical command word a misheard token was probably meant to be.
 *
 * Deliberately conservative: only tokens of four characters or more are
 * considered, the allowed edit distance scales with length, and a token that
 * is already a known word is left alone.
 */
function fuzzyCanonical(token: string): string | null {
  // Five characters minimum. At four, a single edit reaches too many unrelated
  // words to be safe.
  if (token.length < 5 || PROTECTED.test(token)) return null
  if (VARIANT_INDEX.has(token) || FUNCTION_WORDS.has(token)) return null

  const budget = token.length >= 7 ? 2 : 1
  let best: string | null = null
  let bestDistance = budget + 1

  for (const [spelling, canonical] of VARIANT_INDEX) {
    if (Math.abs(spelling.length - token.length) > budget) continue
    const distance = editDistance(token, spelling, budget)
    if (distance < bestDistance) {
      bestDistance = distance
      best = canonical
      if (distance === 0) break
    }
  }

  return bestDistance <= budget ? best : null
}

/**
 * Normalises a transcript for intent detection.
 *
 * `allowFuzzy` should be false when the recogniser reported high confidence:
 * there is no reason to second-guess a transcript the engine was sure about,
 * and every correction is a chance to be wrong.
 */
export function normalizeForIntent(input: string, allowFuzzy = true): NormalizationResult {
  const corrections: string[] = []
  let text = input.toLowerCase()

  // 1. Known whole-phrase mishearings.
  for (const [pattern, replacement, heard] of PHRASE_CORRECTIONS) {
    pattern.lastIndex = 0
    if (pattern.test(text)) {
      pattern.lastIndex = 0
      text = text.replace(pattern, replacement)
      if (heard !== replacement) corrections.push(`${heard} -> ${replacement}`)
    }
  }

  // 2. Multi-word spelling variants.
  for (const [spelling, canonical] of MULTIWORD_VARIANTS) {
    const pattern = new RegExp(`\\b${spelling.replace(/\s+/g, '\\s+')}\\b`, 'g')
    if (pattern.test(text)) {
      text = text.replace(pattern, canonical)
      corrections.push(`${spelling} -> ${canonical}`)
    }
  }

  // 3. Token-level folding, then conservative fuzzy correction.
  let corrected = false
  const tokens = text.split(/\s+/).filter(Boolean)
  const mapped = tokens.map((token) => {
    const bare = token.replace(/[^\p{L}\p{N}]/gu, '')
    if (!bare) return token

    const known = VARIANT_INDEX.get(bare)
    if (known) return known === bare ? token : known

    if (!allowFuzzy) return token
    const guess = fuzzyCanonical(bare)
    if (guess) {
      corrections.push(`${bare} -> ${guess}`)
      corrected = true
      return guess
    }
    return token
  })

  return { normalized: mapped.join(' ').replace(/\s+/g, ' ').trim(), corrections, corrected }
}

/** Exposed for the diagnostics panel and tests. */
export function canonicalTokens(): string[] {
  return Object.keys(VARIANTS)
}
