/**
 * transactionService — simulated wallet operations and persistence.
 *
 * PROTOTYPE NOTICE: AwazPay moves no money. Every function here mutates a
 * demo balance held in the browser's localStorage. There is no bank API, no
 * payment rail, no card network and no SMS gateway anywhere in this project.
 *
 * This module owns the storage key and is the single source of truth for
 * reading and writing demo state; the React store in src/state/store.tsx is
 * only a binding over it.
 */
import type { AppState, Transaction, TransactionDirection, TransactionResult } from '../types/wallet'
import { createInitialState } from '../data/demoWallet'

export const STORAGE_KEY = 'awazpay_state_v1'

/**
 * Bumped when stored settings need reshaping.
 *
 * Version 2 made Urdu the primary spoken language. Version 3 moved the default
 * to the Auto / Mixed profile, which recognises Pakistani code-mixed speech far
 * better than an Urdu-only model. Both migrations only replace a default the
 * user never chose; an explicit choice is always left alone.
 */
const SCHEMA_VERSION = 3
const SCHEMA_KEY = 'awazpay_schema_version'

/** Generates a human-readable reference for a simulated transaction. */
export function createReference(): string {
  const random = Math.floor(Math.random() * 9000) + 1000
  return `AWZ-${Date.now().toString().slice(-6)}${random}`
}

function readSchemaVersion(): number {
  try {
    return Number(window.localStorage.getItem(SCHEMA_KEY) ?? '1')
  } catch {
    return 1
  }
}

function writeSchemaVersion(): void {
  try {
    window.localStorage.setItem(SCHEMA_KEY, String(SCHEMA_VERSION))
  } catch {
    // Storage can be unavailable; the migration then reruns next visit,
    // which is harmless because it is idempotent.
  }
}

export function loadWallet(): AppState {
  const fresh = createInitialState()
  if (typeof window === 'undefined') return fresh
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) {
      writeSchemaVersion()
      return fresh
    }
    const parsed = JSON.parse(raw) as Partial<AppState>
    const settings = { ...fresh.settings, ...(parsed.settings ?? {}) }

    // Only superseded defaults are migrated. If the stored value is one this
    // app once shipped as its default, it was never a deliberate choice, so
    // it moves to the current default; anything else is the user's own pick.
    const SUPERSEDED_DEFAULTS = ['en-US', 'ur-PK']
    if (readSchemaVersion() < SCHEMA_VERSION) {
      if (SUPERSEDED_DEFAULTS.includes(settings.voiceLanguage)) {
        settings.voiceLanguage = fresh.settings.voiceLanguage
      }
      writeSchemaVersion()
    }

    return {
      ...fresh,
      ...parsed,
      settings,
      transactions: Array.isArray(parsed.transactions) ? parsed.transactions : fresh.transactions,
      trustedCircle: Array.isArray(parsed.trustedCircle) ? parsed.trustedCircle : fresh.trustedCircle,
    }
  } catch {
    return fresh
  }
}

export function saveWallet(state: AppState): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state))
  } catch {
    // Storage can be unavailable in private browsing; the demo still runs
    // from memory for the rest of the session.
  }
}

/** Clears saved demo state and returns a fresh wallet. */
export function resetWallet(): AppState {
  if (typeof window !== 'undefined') {
    try {
      window.localStorage.removeItem(STORAGE_KEY)
    } catch {
      // Ignore.
    }
  }
  return createInitialState()
}

export function getBalance(state: AppState): number {
  return state.balance
}

export function getRecentTransactions(state: AppState, count = 3): Transaction[] {
  return state.transactions.slice(0, count)
}

export function getLastTransaction(state: AppState): Transaction | undefined {
  return state.transactions[0]
}

function isValidAmount(amount: number): boolean {
  return Number.isFinite(amount) && amount > 0 && amount < 100_000_000
}

function buildResult(
  state: AppState,
  direction: TransactionDirection,
  counterparty: string,
  amount: number,
  signedDelta: number,
): TransactionResult {
  return {
    ok: true,
    balanceDelta: signedDelta,
    newBalance: state.balance + signedDelta,
    transaction: {
      id: createReference(),
      direction,
      counterparty,
      amount,
      status: 'completed',
      timestamp: Date.now(),
    },
  }
}

function failure(state: AppState, error: NonNullable<TransactionResult['error']>): TransactionResult {
  return { ok: false, error, balanceDelta: 0, newBalance: state.balance }
}

/** Simulates an outgoing payment. Debits the demo balance. */
export function simulatePayment(state: AppState, amount: number, recipient: string): TransactionResult {
  if (!isValidAmount(amount)) return failure(state, 'invalid_amount')
  if (amount > state.balance) return failure(state, 'insufficient_balance')
  return buildResult(state, 'sent', recipient, amount, -amount)
}

/** Simulates a prepaid mobile top-up. Debits the demo balance. */
export function simulateTopUp(state: AppState, amount: number, mobileNumber: string): TransactionResult {
  if (!isValidAmount(amount)) return failure(state, 'invalid_amount')
  if (amount > state.balance) return failure(state, 'insufficient_balance')
  return buildResult(state, 'topup', `Mobile Top-Up ${mobileNumber}`.trim(), amount, -amount)
}

/**
 * Simulates a cash deposit confirmation. Credits the demo balance.
 *
 * In a real deployment the credit would come from an agent or branch after
 * physical cash was handed over; nothing here contacts any institution.
 */
export function simulateCashDeposit(state: AppState, amount: number): TransactionResult {
  if (!isValidAmount(amount)) return failure(state, 'invalid_amount')
  return buildResult(state, 'deposit', 'Cash Deposit', amount, amount)
}

/** Simulates an incoming transfer. Credits the demo balance. */
export function simulateIncoming(state: AppState, amount: number, sender: string): TransactionResult {
  if (!isValidAmount(amount)) return failure(state, 'invalid_amount')
  return buildResult(state, 'received', sender, amount, amount)
}

/** Plain-language explanation of a failed operation, for speech output. */
export function describeFailure(error: NonNullable<TransactionResult['error']>): string {
  switch (error) {
    case 'insufficient_balance':
      return 'Your available balance is not sufficient for this transaction. The transaction has been cancelled.'
    case 'limit_exceeded':
      return 'This amount is above the allowed limit for this account.'
    case 'invalid_amount':
    default:
      return "I couldn't read a valid amount. Please say the amount again, for example, five hundred rupees."
  }
}
