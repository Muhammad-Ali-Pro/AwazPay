/**
 * commandEngine — routes a parsed intent to an application action.
 *
 * The engine is pure: it reads wallet state and returns a description of what
 * should happen. The `useVoiceAssistant` hook performs the side effects
 * (speaking, navigating, starting a flow), which keeps routing logic testable
 * and free of React.
 *
 * Replies are returned as multilingual {@link Phrase} objects, not strings, so
 * the same route works in Urdu, Roman Urdu and English.
 */
import type { FlowRequest, OrbState, ParsedIntent } from '../types/voice'
import type { AppState, Transaction } from '../types/wallet'
import {
  PHRASES,
  describeTransactionPhrase,
  joinPhrases,
  type Phrase,
} from '../data/voicePhrases'
import { getLastTransaction, getRecentTransactions } from '../services/transactionService'

export type CommandAction =
  /** Speak a reply and stay where we are. */
  | { kind: 'speak'; text: Phrase; orb?: OrbState }
  /** Speak, then move to another screen. */
  | { kind: 'navigate'; to: string; text?: Phrase }
  /** Hand a financial flow, with any slots already filled, to a screen. */
  | { kind: 'start_flow'; to: string; request: FlowRequest; text?: Phrase }
  /** Step back in history. */
  | { kind: 'back'; text?: Phrase }
  /** Close the microphone until the user reopens it. */
  | { kind: 'stop_listening'; text: Phrase }
  /** Nothing matched. */
  | { kind: 'unrecognised'; text: Phrase }

function describe(tx: Transaction): Phrase {
  return describeTransactionPhrase(tx.direction, tx.amount, tx.counterparty)
}

/**
 * Maps a parsed intent to the action the app should take.
 *
 * Balance and history replies are returned as speech only. They are never
 * handed back as screen text, so sensitive figures reach the user through
 * audio alone.
 */
export function routeIntent(parsed: ParsedIntent, state: AppState): CommandAction {
  const { intent, slots } = parsed

  switch (intent) {
    case 'check_balance':
      return { kind: 'navigate', to: '/balance' }

    case 'pay':
      return {
        kind: 'start_flow',
        to: '/payment',
        request: {
          kind: 'payment',
          amount: slots.amount,
          recipient: slots.recipient,
          fromVoice: true,
          createdAt: Date.now(),
        },
      }

    case 'pay_nfc':
      return {
        kind: 'start_flow',
        to: '/nfc',
        request: {
          kind: 'payment',
          amount: slots.amount,
          fromVoice: true,
          createdAt: Date.now(),
        },
      }

    case 'mobile_topup':
      return {
        kind: 'start_flow',
        to: '/topup',
        request: {
          kind: 'topup',
          amount: slots.amount,
          mobileNumber: slots.mobileNumber,
          fromVoice: true,
          createdAt: Date.now(),
        },
      }

    case 'cash_deposit':
      return {
        kind: 'start_flow',
        to: '/cash-assist',
        request: { kind: 'deposit', amount: slots.amount, fromVoice: true, createdAt: Date.now() },
      }

    case 'receive_money':
      return { kind: 'navigate', to: '/receive', text: PHRASES.openingReceive }

    case 'last_transaction': {
      const last = getLastTransaction(state)
      return {
        kind: 'speak',
        orb: 'secure',
        text: last ? joinPhrases(PHRASES.historyPrivate, describe(last)) : PHRASES.noTransactions,
      }
    }

    case 'recent_transactions': {
      const recent = getRecentTransactions(state, 3)
      if (!recent.length) return { kind: 'speak', text: PHRASES.noTransactions }
      return {
        kind: 'speak',
        orb: 'secure',
        text: joinPhrases(PHRASES.historyPrivate, ...recent.map(describe)),
      }
    }

    case 'trusted_circle':
      return { kind: 'navigate', to: '/trusted-circle', text: PHRASES.openingTrusted }

    case 'open_settings':
      return { kind: 'navigate', to: '/settings', text: PHRASES.openingSettings }

    case 'go_home':
      return { kind: 'navigate', to: '/home', text: PHRASES.openingHome }

    case 'go_back':
      return { kind: 'back', text: PHRASES.goingBack }

    // Conversational intents. Answered locally, instantly, with no API and no
    // network, so the assistant is never rude to someone who just said hello.
    case 'greeting':
      return { kind: 'speak', text: PHRASES.greeting }

    case 'how_are_you':
      return { kind: 'speak', text: PHRASES.howAreYou }

    case 'capabilities':
      return { kind: 'speak', text: PHRASES.capabilities }

    case 'thanks':
      return { kind: 'speak', text: PHRASES.thanks }

    case 'help':
    case 'repeat':
      return { kind: 'speak', text: PHRASES.help }

    case 'stop_listening':
      return { kind: 'stop_listening', text: PHRASES.stoppedListening }

    case 'cancel':
      return { kind: 'speak', text: PHRASES.nothingToCancel }

    case 'confirm':
      return { kind: 'speak', text: PHRASES.nothingToCancel }

    case 'unknown':
    default:
      return { kind: 'unrecognised', text: PHRASES.notUnderstood }
  }
}
