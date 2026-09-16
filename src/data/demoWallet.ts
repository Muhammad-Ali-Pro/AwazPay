/**
 * Demo wallet seed data.
 *
 * PROTOTYPE NOTICE: these figures are fictional. No bank account, card,
 * payment rail or SMS gateway is involved anywhere in AwazPay.
 */
import type { AppSettings, AppState, Merchant } from '../types/wallet'

/** Transactions above this amount require Trusted Circle authorization. */
export const STANDARD_TRANSACTION_LIMIT = 25000

export const DEMO_MERCHANTS: Merchant[] = [
  { id: 'm1', name: 'ABC Grocery Store', amount: 2500 },
  { id: 'm2', name: 'Karachi Coffee House', amount: 750 },
  { id: 'm3', name: 'City Pharmacy', amount: 1200 },
]

/** Recipients the voice parser recognises by name in a payment command. */
export const DEMO_RECIPIENTS: string[] = [
  'Ahmed Khan',
  'Fatima Noor',
  'Bilal Raza',
  'Sana Malik',
  'ABC Grocery Store',
  'Karachi Coffee House',
  'City Pharmacy',
]

export const DEMO_MOBILE_NUMBER = '0300 1234567'

export const DEFAULT_SETTINGS: AppSettings = {
  voiceSpeed: 1,
  // English is the default spoken language. Recognition still accepts Roman
  // Urdu and code-mixed speech, but replies come back in English so the voice
  // and the words match — an English voice reading Roman Urdu was the reason
  // speech output sounded wrong. Urdu output is a Settings choice away.
  voiceLanguage: 'en-US',
  privateAudioMode: true,
  hideSensitiveOnScreen: true,
  vibrationEnabled: true,
  highContrast: false,
  largeControls: false,
  transactionLimit: STANDARD_TRANSACTION_LIMIT,
}

/** Builds a fresh demo state. Timestamps are relative to "now" on each reset. */
export function createInitialState(): AppState {
  const now = Date.now()
  return {
    onboardingComplete: false,
    balance: 48500,
    secretWord: 'falcon',
    transactions: [
      {
        id: 'seed-1',
        direction: 'received',
        counterparty: 'Ahmed Khan',
        amount: 5000,
        status: 'completed',
        timestamp: now - 1000 * 60 * 60 * 26,
      },
      {
        id: 'seed-2',
        direction: 'sent',
        counterparty: 'Karachi Coffee House',
        amount: 750,
        status: 'completed',
        timestamp: now - 1000 * 60 * 60 * 3,
      },
    ],
    trustedCircle: [{ id: 't1', name: 'Ahmed Khan', relationship: 'Brother' }],
    settings: DEFAULT_SETTINGS,
    devMode: false,
  }
}

export const INITIAL_STATE: AppState = createInitialState()
