/**
 * Deprecated shim. Text-to-Speech now lives in
 * src/services/voiceOutputService.ts; this file re-exports it so older
 * imports keep working.
 */
export {
  isSpeechSynthesisSupported,
  speak,
  speakAsync,
  stopSpeaking,
  isSpeaking,
  pickVoice,
  isLanguageVoiceAvailable,
} from '../services/voiceOutputService'
export type { SpeakOptions } from '../services/voiceOutputService'
