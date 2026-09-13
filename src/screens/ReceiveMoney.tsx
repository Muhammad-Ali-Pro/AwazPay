import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { StageLayout } from '../components/StageLayout'
import { AccessibleButton } from '../components/AccessibleButton'
import { PrivacyCurtain } from '../components/PrivacyCurtain'
import { useAnnouncer } from '../state/announcer'
import { useAppDispatch, useAppState } from '../state/store'
import { simulateIncoming } from '../services/transactionService'
import { amountToSpeech } from '../lib/currency'
import { vibrate } from '../lib/haptics'

const DEMO_SENDER = 'Ahmed Khan'
const DEMO_AMOUNT = 5000

/**
 * Receive money. Incoming funds are announced privately rather than shown.
 *
 * PROTOTYPE: nothing is actually received. The button fabricates a demo credit.
 */
export function ReceiveMoney() {
  const navigate = useNavigate()
  const { announce } = useAnnouncer()
  const dispatch = useAppDispatch()
  const state = useAppState()
  const [received, setReceived] = useState(false)
  const spokenRef = useRef(false)

  useEffect(() => {
    if (spokenRef.current) return
    spokenRef.current = true
    announce('Receive money. Waiting for an incoming payment. Any amount received will be read to you privately.')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function simulateIncomingPayment() {
    const result = simulateIncoming(state, DEMO_AMOUNT, DEMO_SENDER)
    if (!result.ok || !result.transaction) return
    dispatch({ type: 'ADD_TRANSACTION', transaction: result.transaction, balanceDelta: result.balanceDelta })
    vibrate('success', state.settings.vibrationEnabled)
    announce(
      `You have received ${amountToSpeech(DEMO_AMOUNT)} from ${DEMO_SENDER}. Your new balance is ${amountToSpeech(result.newBalance)}. This was a simulated payment.`,
    )
    setReceived(true)
  }

  if (received) {
    return (
      <StageLayout
        orbState="success"
        eyebrow="Money Received"
        heading="Money Received"
        icon="✓"
        caption="Your private receipt is being delivered by voice."
      >
        <div className="flex flex-col gap-3">
          <PrivacyCurtain
            message="Your receipt is private"
            detail="The sender, amount and new balance were read to you privately. They are not shown on screen."
          />
          <AccessibleButton onClick={() => navigate('/home')}>Go Home</AccessibleButton>
        </div>
      </StageLayout>
    )
  }

  return (
    <StageLayout
      orbState="listening"
      eyebrow="Receive Money"
      heading="Receive Money"
      caption="Waiting for an incoming payment."
    >
      <div className="flex flex-col gap-3">
        <PrivacyCurtain
          message="Please listen privately"
          detail="When money arrives, the sender and amount are spoken to you instead of appearing on screen."
        />
        <AccessibleButton onClick={simulateIncomingPayment}>Simulate Incoming Payment (Demo)</AccessibleButton>
        <AccessibleButton variant="ghost" onClick={() => navigate('/home')}>
          Go Home
        </AccessibleButton>
      </div>
    </StageLayout>
  )
}
