/**
 * Wallet / financial domain types.
 *
 * PROTOTYPE NOTICE: every value here is simulated demo data held in
 * localStorage. AwazPay performs no real banking, no real money movement and
 * no real bank verification of any kind.
 */

export type TransactionDirection = 'sent' | 'received' | 'topup' | 'deposit'
export type TransactionStatus = 'completed' | 'failed' | 'cancelled'

export interface Transaction {
  id: string
  direction: TransactionDirection
  counterparty: string
  amount: number
  status: TransactionStatus
  timestamp: number
}

export interface Merchant {
  id: string
  name: string
  amount: number
}

export interface TrustedContact {
  id: string
  name: string
  relationship: string
}

export interface AppSettings {
  voiceSpeed: number
  voiceLanguage: string
  privateAudioMode: boolean
  hideSensitiveOnScreen: boolean
  vibrationEnabled: boolean
  highContrast: boolean
  largeControls: boolean
  transactionLimit: number
}

export interface AppState {
  onboardingComplete: boolean
  balance: number
  secretWord: string
  transactions: Transaction[]
  trustedCircle: TrustedContact[]
  settings: AppSettings
  devMode: boolean
}

/** Outcome of a simulated financial operation. */
export interface TransactionResult {
  ok: boolean
  /** Machine-readable failure reason, present when `ok` is false. */
  error?: 'insufficient_balance' | 'invalid_amount' | 'limit_exceeded'
  transaction?: Transaction
  balanceDelta: number
  newBalance: number
}
