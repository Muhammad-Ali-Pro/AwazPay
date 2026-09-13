/**
 * securityEngine — transaction limits, verification challenges and the
 * high-value authorization path.
 *
 * PROTOTYPE NOTICE: this is a demonstration of a security *design*, not a
 * security *implementation*. It performs no cryptography, contacts no bank,
 * sends no SMS and makes no OTP call.
 *
 * FUTURE: VOICE BIOMETRICS
 * -------------------------------------------------------------------------
 * The MVP verifies a spoken secret word plus a one-time random number. That
 * proves the speaker knows a shared secret; it does not prove *who* is
 * speaking. A production build would replace `verifyChallengeResponse` with a
 * speaker-verification model that scores the captured audio against an
 * enrolled voiceprint, and keep the random number as an anti-replay nonce so
 * a recording of a previous confirmation cannot be reused. The call site
 * contract stays the same: audio or transcript in, pass or fail out.
 */
import type { SecurityChallenge, VerificationTier } from '../types/voice'
import type { TrustedContact } from '../types/wallet'
import { STANDARD_TRANSACTION_LIMIT } from '../data/demoWallet'
import { numberToWords } from '../lib/currency'

export { STANDARD_TRANSACTION_LIMIT }

/** Maximum verification attempts before a transaction is abandoned. */
export const MAX_VERIFICATION_ATTEMPTS = 3

/**
 * Recently issued challenge numbers, so no two consecutive transactions ever
 * present the same one. Persisted so the guarantee survives a page refresh.
 */
const RECENT_KEY = 'awazpay_recent_challenges_v1'
const RECENT_MEMORY = 8

/**
 * Held in memory as well as in storage, so uniqueness still holds when
 * localStorage is unavailable, as in private browsing.
 */
let recentInMemory: number[] | null = null

function loadRecent(): number[] {
  if (recentInMemory) return recentInMemory
  let stored: number[] = []
  if (typeof window !== 'undefined') {
    try {
      const raw = window.localStorage.getItem(RECENT_KEY)
      const parsed = raw ? (JSON.parse(raw) as unknown) : []
      if (Array.isArray(parsed)) stored = parsed.filter((n): n is number => typeof n === 'number')
    } catch {
      stored = []
    }
  }
  recentInMemory = stored
  return recentInMemory
}

function saveRecent(values: number[]): void {
  recentInMemory = values.slice(-RECENT_MEMORY)
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(RECENT_KEY, JSON.stringify(recentInMemory))
  } catch {
    // Storage can be unavailable; the in-memory list still guarantees that
    // no two challenges in a session repeat.
  }
}

/** Monotonic counter so two challenges in the same millisecond differ. */
let challengeCounter = 0

function randomInt(min: number, max: number): number {
  const range = max - min + 1
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const buffer = new Uint32Array(1)
    crypto.getRandomValues(buffer)
    return min + (buffer[0] % range)
  }
  return min + Math.floor(Math.random() * range)
}

/**
 * Issues a fresh two-digit verification challenge.
 *
 * The number is different from every recently used one, so each transaction
 * carries its own unique challenge and no static password is ever reused.
 */
export function generateChallenge(): SecurityChallenge {
  const recent = loadRecent()
  let value = randomInt(10, 99)
  let guard = 0
  while (recent.includes(value) && guard < 50) {
    value = randomInt(10, 99)
    guard += 1
  }
  saveRecent([...recent, value])
  challengeCounter += 1
  return { id: `chal-${Date.now()}-${challengeCounter}-${value}`, number: value, createdAt: Date.now() }
}

const DIGIT_WORDS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine']

/** The sentence the assistant speaks to present a challenge. */
export function describeChallenge(challenge: SecurityChallenge): string {
  return `For security, please say your secret word followed by the number ${challenge.number}.`
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[.,!?;:'"()-]/g, ' ').replace(/\s+/g, ' ').trim()
}

/**
 * Checks a spoken response against the secret word and the challenge number.
 *
 * The number is accepted as digits ("47"), as a whole word ("forty seven") or
 * spoken digit by digit ("four seven"), because recognisers differ.
 */
export function verifyChallengeResponse(
  transcript: string,
  secretWord: string,
  challenge: SecurityChallenge,
): boolean {
  const text = normalize(transcript)
  if (!text) return false

  const wordOk = text.includes(secretWord.toLowerCase().trim())

  const value = String(challenge.number)
  const asWords = numberToWords(challenge.number).toLowerCase()
  const digitByDigit = value
    .split('')
    .map((d) => DIGIT_WORDS[Number(d)])
    .join(' ')
  const hyphenated = asWords.replace(/\s+/g, '-')

  const numberOk =
    text.includes(value) ||
    text.includes(asWords) ||
    text.includes(hyphenated) ||
    text.includes(digitByDigit)

  return wordOk && numberOk
}

/** Which verification tier an amount falls into. */
export function getVerificationTier(amount: number, limit = STANDARD_TRANSACTION_LIMIT): VerificationTier {
  return amount > limit ? 'high_value' : 'standard'
}

export function requiresTrustedCircle(amount: number, limit = STANDARD_TRANSACTION_LIMIT): boolean {
  return getVerificationTier(amount, limit) === 'high_value'
}

export interface TrustedApprovalRequest {
  id: string
  approver: TrustedContact
  amount: number
  requestedAt: number
}

/**
 * Opens a simulated Trusted Circle authorization request.
 *
 * DESIGN NOTE: deliberately, the trusted person never reads an OTP aloud to
 * the user. A shared-secret-over-the-phone flow trains people to hand codes
 * to whoever asks, which is exactly how social-engineering fraud works, and
 * it is a particularly poor fit for a user who depends on someone else's
 * help. The production architecture is an approval prompt on the trusted
 * person's own device: they see the amount and payee and approve or decline
 * there, and nothing secret ever crosses the conversation. This function
 * stands in for that remote approval so the flow can be demonstrated offline.
 */
export function requestTrustedApproval(approver: TrustedContact, amount: number): TrustedApprovalRequest {
  return { id: `tca-${Date.now()}`, approver, amount, requestedAt: Date.now() }
}

/** How long the simulated approval takes to come back, in milliseconds. */
export const SIMULATED_APPROVAL_MS = 3200

export const TRUSTED_AUTHORIZATION_LABEL = 'Simulated Trusted Circle Authorization'

/** Resolves the simulated approval. Always approves in the demo. */
export function resolveTrustedApproval(request: TrustedApprovalRequest): { approved: boolean; approver: string } {
  return { approved: true, approver: request.approver.name }
}
