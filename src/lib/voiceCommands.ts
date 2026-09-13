/**
 * Deprecated shim. Intent parsing now lives in
 * src/services/intentService.ts; this file re-exports the pieces older
 * screens imported.
 */
import { verifyChallengeResponse } from '../engines/securityEngine'

export {
  parseIntent,
  parseTranscript,
  parseTranscriptSync,
  normalizeTranscript,
  containsWakePhrase,
  stripWakePhrase,
  extractAmount,
  extractRecipient,
  extractMobileNumber,
  isAffirmative,
  isNegative,
  WAKE_PHRASE,
} from '../services/intentService'
export type { VoiceIntent } from '../types/voice'

/** @deprecated Use securityEngine.verifyChallengeResponse. */
export function validateSecurityPhrase(raw: string, secretWord: string, challenge: string): boolean {
  return verifyChallengeResponse(raw, secretWord, {
    id: 'legacy',
    number: Number(challenge),
    createdAt: Date.now(),
  })
}
