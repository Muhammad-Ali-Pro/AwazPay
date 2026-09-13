import { useMemo } from 'react'
import { TransactionStage } from '../components/TransactionStage'
import { useTransactionFlow } from '../hooks/useTransactionFlow'
import { useVoiceSession } from '../state/voiceSession'

/**
 * Voice-first prepaid mobile top-up.
 *
 * Handles "load five hundred rupees to my mobile" and the Roman Urdu
 * equivalent "mujhe 1000 ka load karna hai". Runs the same verification
 * challenge and limit checks as a payment.
 *
 * PROTOTYPE: no telecom API is called. The top-up is simulated.
 */
export function MobileTopUp() {
  const { consumeFlow } = useVoiceSession()
  const request = useMemo(() => consumeFlow(), [consumeFlow])

  const flow = useTransactionFlow({ kind: 'topup', request })

  return (
    <TransactionStage
      flow={flow}
      title="Mobile Top-Up"
      successTitle="Top-Up Complete"
      amountPresets={[100, 300, 500, 1000]}
    />
  )
}
