import { useMemo } from 'react'
import { TransactionStage } from '../components/TransactionStage'
import { useTransactionFlow } from '../hooks/useTransactionFlow'
import { useVoiceSession } from '../state/voiceSession'
import { DEMO_RECIPIENTS } from '../data/demoWallet'

/**
 * Voice-first payment.
 *
 * Reached either from a spoken command ("pay two thousand rupees to Ahmed",
 * with the slots already filled) or from the Pay button, in which case the
 * assistant asks for the amount and payee by voice. All security, limit and
 * Trusted Circle handling lives in useTransactionFlow and the security engine.
 *
 * PROTOTYPE: no money moves. The payment is simulated against demo data.
 */
export function PaymentFlow() {
  const { consumeFlow } = useVoiceSession()
  // Consumed once on mount so a refresh does not replay a stale voice request.
  const request = useMemo(() => consumeFlow(), [consumeFlow])

  const flow = useTransactionFlow({ kind: 'payment', request })

  return (
    <TransactionStage
      flow={flow}
      title="Payment"
      successTitle="Payment Complete"
      amountPresets={[500, 1000, 2500, 30000]}
      recipientPresets={DEMO_RECIPIENTS.slice(0, 4)}
    />
  )
}
