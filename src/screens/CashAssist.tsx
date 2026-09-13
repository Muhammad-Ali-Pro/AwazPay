import { useMemo } from 'react'
import { TransactionStage } from '../components/TransactionStage'
import { useTransactionFlow } from '../hooks/useTransactionFlow'
import { useVoiceSession } from '../state/voiceSession'

/**
 * Cash deposit assistance.
 *
 * Physical notes are the one part of this journey software cannot do alone,
 * so the flow opens by saying so plainly: for physical cash deposits, please
 * ensure you have assistance from a trusted person where required. The
 * deposit itself is then confirmed by voice.
 *
 * A deposit is a credit rather than a debit, so it takes the guidance and
 * explicit-confirmation path instead of the debit security challenge.
 *
 * PROTOTYPE: no cash, agent or branch is involved. The credit is simulated.
 */
export function CashAssist() {
  const { consumeFlow } = useVoiceSession()
  const request = useMemo(() => consumeFlow(), [consumeFlow])

  const flow = useTransactionFlow({ kind: 'deposit', request })

  return (
    <TransactionStage
      flow={flow}
      title="Cash Deposit Assistance"
      successTitle="Deposit Confirmed"
      amountPresets={[1000, 3000, 5000, 10000]}
    />
  )
}
