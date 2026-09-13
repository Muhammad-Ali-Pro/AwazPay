import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { AccessibleButton } from '../components/AccessibleButton'
import { PrivacyCurtain } from '../components/PrivacyCurtain'
import { StageLayout } from '../components/StageLayout'
import { useAnnouncer } from '../state/announcer'
import { useAppState } from '../state/store'
import { amountToSpeech, formatPKR } from '../lib/currency'
import type { Transaction } from '../types'

function describe(tx: Transaction): string {
  switch (tx.direction) {
    case 'received':
      return `received ${amountToSpeech(tx.amount)} from ${tx.counterparty}`
    case 'sent':
      return `sent ${amountToSpeech(tx.amount)} to ${tx.counterparty}`
    case 'topup':
      return `loaded ${amountToSpeech(tx.amount)} as a mobile top-up`
    case 'deposit':
    default:
      return `deposited ${amountToSpeech(tx.amount)} in cash`
  }
}

/**
 * Transaction history.
 *
 * History is read aloud by default. The on-screen list is available only when
 * the user has switched off "Hide sensitive screen information" in Settings,
 * so amounts and payees are not exposed to anyone glancing at the phone.
 */
export function TransactionHistory() {
  const navigate = useNavigate()
  const { announce } = useAnnouncer()
  const { transactions, settings } = useAppState()
  const [searchParams] = useSearchParams()
  const [revealed, setRevealed] = useState(false)
  const spokenRef = useRef(false)

  const mode = searchParams.get('mode')
  const screenAllowed = !settings.hideSensitiveOnScreen

  function speakHistory(count: number) {
    const recent = transactions.slice(0, count)
    if (!recent.length) {
      announce('You have no transactions yet.')
      return
    }
    const lines = recent.map((tx, i) => `${i + 1}. You ${describe(tx)}.`).join(' ')
    announce(`Please listen to your private financial information. ${lines}`)
  }

  useEffect(() => {
    if (spokenRef.current) return
    spokenRef.current = true
    speakHistory(mode === 'last' ? 1 : 3)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  if (!revealed || !screenAllowed) {
    return (
      <StageLayout
        orbState="secure"
        eyebrow="Activity"
        heading="Transaction History"
        caption="Your recent activity is being delivered privately."
      >
        <div className="flex flex-col gap-3">
          <PrivacyCurtain
            message="Please listen privately"
            detail="Your transactions are read aloud rather than displayed, so nobody nearby can read them."
          />
          <AccessibleButton onClick={() => speakHistory(3)}>🔊 Listen Again</AccessibleButton>
          {screenAllowed ? (
            <AccessibleButton variant="secondary" onClick={() => setRevealed(true)}>
              Show on screen
            </AccessibleButton>
          ) : (
            <p className="text-xs leading-relaxed text-white/40">
              On-screen history is turned off. You can enable it in Settings under Privacy.
            </p>
          )}
          <AccessibleButton variant="ghost" onClick={() => navigate('/home')}>
            Go Home
          </AccessibleButton>
        </div>
      </StageLayout>
    )
  }

  return (
    <div className="text-white">
      <h1 className="text-2xl font-bold">Transaction History</h1>
      <p className="mt-1 text-sm text-white/60">
        Visible because on-screen sensitive information is enabled in Settings.
      </p>

      <ul className="mt-6 flex flex-col gap-3">
        {transactions.map((tx) => (
          <li key={tx.id} className="rounded-2xl border border-white/10 bg-midnight-800 p-4">
            <div className="flex items-center justify-between">
              <span className="font-semibold">{tx.counterparty}</span>
              <span className={tx.direction === 'received' || tx.direction === 'deposit' ? 'text-success' : 'text-white'}>
                {tx.direction === 'received' || tx.direction === 'deposit' ? '+' : '-'}
                {formatPKR(tx.amount)}
              </span>
            </div>
            <div className="mt-1 flex items-center justify-between text-xs text-white/50">
              <span className="capitalize">
                {tx.direction} · {tx.status}
              </span>
              <span>{new Date(tx.timestamp).toLocaleString()}</span>
            </div>
          </li>
        ))}
        {transactions.length === 0 && <p className="text-white/50">No transactions yet.</p>}
      </ul>

      <div className="mt-8 flex flex-col gap-3">
        <AccessibleButton variant="secondary" onClick={() => setRevealed(false)}>
          Hide from screen
        </AccessibleButton>
        <AccessibleButton onClick={() => navigate('/home')}>Go Home</AccessibleButton>
      </div>
    </div>
  )
}
