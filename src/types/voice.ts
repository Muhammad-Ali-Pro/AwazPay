/**
 * Voice / assistant domain types.
 */

/**
 * Visual states of the Awaz Orb.
 *
 * `secure` is the original name kept for backwards compatibility with screens
 * written before the assistant existed; `verifying` is its documented alias.
 */
export type OrbState =
  | 'idle'
  | 'listening'
  | 'processing'
  | 'verifying'
  | 'secure'
  | 'speaking'
  | 'success'
  | 'error'

/** Every intent the local parser can produce. */
export type VoiceIntent =
  | 'check_balance'
  | 'pay'
  | 'pay_nfc'
  | 'mobile_topup'
  | 'cash_deposit'
  | 'receive_money'
  | 'last_transaction'
  | 'recent_transactions'
  | 'trusted_circle'
  | 'open_settings'
  | 'go_home'
  | 'go_back'
  | 'help'
  | 'confirm'
  | 'cancel'
  | 'repeat'
  | 'stop_listening'
  // Conversational intents. These never touch money, so they are always
  // answered locally and never require an API.
  | 'greeting'
  | 'how_are_you'
  | 'capabilities'
  | 'thanks'
  | 'unknown'

/**
 * The voice session as the user experiences it.
 *
 * `ready` means the microphone is open and armed for the wake phrase;
 * `listening` means the wake phrase landed and a command window is open.
 */
export type VoiceSessionState =
  | 'off'
  | 'ready'
  | 'listening'
  | 'processing'
  | 'speaking'
  | 'awaiting_confirmation'
  | 'transaction'
  | 'success'
  | 'error'

/** Languages offered for recognition and synthesis. */
export type SpeechLanguage = 'ur-PK' | 'en-PK' | 'en-US' | 'en-GB'

/**
 * A user-facing voice profile.
 *
 * `auto` is not true language auto-detection: the Web Speech API cannot do
 * that. It is a code-mixed profile that runs recognition in Pakistani English,
 * which transcribes Roman Urdu and Urdu-English sentences far better than an
 * Urdu-only model does, and accepts all three scripts when parsing.
 */
export type VoiceProfile = 'auto' | 'ur-PK' | 'en-PK' | 'en-US'

/** How sure the recogniser was, banded for decision-making. */
export type ConfidenceLevel = 'high' | 'medium' | 'low' | 'unknown'

/** Why the continuous session is not currently listening. */
export type VoiceStopReason = 'user' | 'permission' | 'unsupported' | 'restart_limit' | null

/** Slots the parser can fill from a single utterance. */
export interface IntentSlots {
  amount?: number
  recipient?: string
  mobileNumber?: string
}

export interface ParsedIntent {
  intent: VoiceIntent
  slots: IntentSlots
  /** 0..1 heuristic score. The local parser reports pattern strength only. */
  confidence: number
  /** Raw transcript exactly as recognised. */
  raw: string
  /** Transcript with the wake phrase removed and punctuation normalised. */
  normalized: string
  /** True when the utterance contained the "Hey AwazPay" wake phrase. */
  wakeWordDetected: boolean
}

/**
 * Contract for a pluggable natural-language understanding provider.
 *
 * The MVP ships `localIntentProvider`, a dependency-free keyword and pattern
 * parser. A hosted multilingual model can later implement this same interface
 * and be registered with `setIntentProvider` without touching callers.
 */
export interface IntentProvider {
  readonly name: string
  parse(transcript: string): ParsedIntent | Promise<ParsedIntent>
}

export type SpeechErrorKind =
  | 'unsupported'
  | 'permission_denied'
  | 'no_speech'
  | 'audio_capture'
  | 'network'
  | 'aborted'
  | 'unknown'

export interface SpeechError {
  kind: SpeechErrorKind
  message: string
}

/** Which financial flow the assistant handed off to a screen. */
export type FlowKind = 'payment' | 'topup' | 'deposit'

/** A flow request produced by voice and consumed by a screen. */
export interface FlowRequest {
  kind: FlowKind
  amount?: number
  recipient?: string
  mobileNumber?: string
  /** Set when the request came from speech rather than a touch control. */
  fromVoice: boolean
  createdAt: number
}

/** A one-time verification challenge issued by the security engine. */
export interface SecurityChallenge {
  id: string
  /** The random number the user must speak after their secret word. */
  number: number
  createdAt: number
}

export type VerificationTier = 'standard' | 'high_value'
