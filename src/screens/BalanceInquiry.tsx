import { useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { StageLayout } from '../components/StageLayout'
import { AccessibleButton } from '../components/AccessibleButton'
import { PrivacyCurtain } from '../components/PrivacyCurtain'
import { useAnnouncer } from '../state/announcer'
import { useAppState } from '../state/store'
import { amountToSpeech, formatPKR } from '../lib/currency'

/**
 * Balance inquiry.
 *
 * The balance is spoken and never printed. The only exception is when the
 * user has switched off "Hide sensitive screen information" in Settings,
 * which is a deliberate, remembered choice for a user with partial sight or a
 * trusted setting; the default keeps the figure off the screen entirely.
 */
export function BalanceInquiry() {
  const navigate = useNavigate()
  const { announce } = useAnnouncer()
  const { balance, settings } = useAppState()
  const spokenRef = useRef(false)

  const speakBalance = useCallback(() => {
    announce(`Your available AwazPay balance is ${amountToSpeech(balance)}. This is simulated demo data.`)
  }, [announce, balance])

  useEffect(() => {
    if (spokenRef.current) return
    spokenRef.current = true
    speakBalance()
  }, [speakBalance])

  return (
    <StageLayout
      orbState="secure"
      eyebrow="Balance Request"
      heading="Balance Request"
      caption="Please listen to your private financial information."
    >
      <div className="flex flex-col gap-3">
        <PrivacyCurtain
          message="Please listen privately"
          detail="Your balance is being delivered through voice guidance and is not shown on screen."
        />

        <AccessibleButton variant="secondary" onClick={speakBalance}>
          🔊 Say It Again
        </AccessibleButton>

        {/* Only available when the user has turned privacy off themselves. */}
        {!settings.hideSensitiveOnScreen && (
          <p className="rounded-2xl border border-white/10 bg-midnight-800 px-6 py-4 text-2xl font-bold text-white">
            {formatPKR(balance)}
          </p>
        )}

        <AccessibleButton onClick={() => navigate('/home')}>Go Home</AccessibleButton>
      </div>
    </StageLayout>
  )
}
