import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { AccessibleButton } from './AccessibleButton'
import { PrivacyCurtain } from './PrivacyCurtain'
import { StageLayout } from './StageLayout'
import type { UseTransactionFlowResult } from '../hooks/useTransactionFlow'
import { TRUSTED_AUTHORIZATION_LABEL } from '../engines/securityEngine'
import { formatPKR } from '../lib/currency'
import { useAppState } from '../state/store'

interface TransactionStageProps {
  flow: UseTransactionFlowResult
  /** Screen title, e.g. "Payment". Contains no financial values. */
  title: string
  /** Quick-pick amounts offered as a touch fallback. */
  amountPresets?: number[]
  /** Recipient suggestions offered as a touch fallback. */
  recipientPresets?: string[]
  successTitle?: string
}

/**
 * Renders every stage of a transaction flow.
 *
 * The rule this component enforces: amounts, payees, balances and challenge
 * numbers are spoken, never displayed. The only place a figure appears on
 * screen is inside an explicitly-labelled touch fallback the user opened
 * themselves, because a user who cannot use voice still needs a way through.
 */
export function TransactionStage({
  flow,
  title,
  amountPresets = [500, 1000, 2500, 5000],
  recipientPresets = [],
  successTitle = 'Transaction Complete',
}: TransactionStageProps) {
  const navigate = useNavigate()
  const { devMode, secretWord } = useAppState()
  const [manualOpen, setManualOpen] = useState(false)
  const [manualWord, setManualWord] = useState('')
  const [manualDigits, setManualDigits] = useState('')
  const [customAmount, setCustomAmount] = useState('')
  const [customRecipient, setCustomRecipient] = useState('')

  // The flow opens the microphone on its own after each question; this is a
  // retry for when a answer was missed, not the way the user is meant to speak.
  const micButton = flow.isSpeechSupported && (
    <AccessibleButton variant="secondary" onClick={flow.listenAgain}>
      {flow.isListening ? '🎙️ Listening...' : '🎙️ Speak again'}
    </AccessibleButton>
  )

  const cancelButton = (
    <AccessibleButton variant="danger" onClick={() => flow.cancel()}>
      Cancel Transaction
    </AccessibleButton>
  )

  if (flow.stage === 'success') {
    return (
      <StageLayout orbState="success" eyebrow={successTitle} heading={successTitle} icon="✓" caption={flow.caption}>
        <div className="flex flex-col gap-3">
          <PrivacyCurtain
            message="Your receipt is private"
            detail="The amount and remaining balance were read to you privately. They are not shown on screen."
          />
          <AccessibleButton onClick={() => navigate('/home')}>Done</AccessibleButton>
        </div>
      </StageLayout>
    )
  }

  if (flow.stage === 'failed' || flow.stage === 'cancelled') {
    const heading = flow.stage === 'failed' ? 'Transaction Unavailable' : 'Transaction Cancelled'
    return (
      <StageLayout orbState="error" eyebrow={heading} heading={heading} icon="🎧" caption={flow.caption}>
        <div className="flex flex-col gap-3">
          <PrivacyCurtain
            message="Please listen to the explanation"
            detail="The reason was delivered privately through voice guidance."
          />
          <AccessibleButton onClick={flow.restart}>Try Again</AccessibleButton>
          <AccessibleButton variant="ghost" onClick={() => navigate('/home')}>
            Go Home
          </AccessibleButton>
        </div>
      </StageLayout>
    )
  }

  if (flow.stage === 'processing') {
    return <StageLayout orbState="processing" heading="Processing securely..." caption={flow.caption} />
  }

  if (flow.stage === 'trusted_pending') {
    return (
      <StageLayout
        orbState="verifying"
        eyebrow="Trusted Circle"
        heading="Additional Verification Required"
        icon="🔒"
        caption={flow.caption}
      >
        <div className="flex flex-col gap-3">
          <p className="rounded-2xl border border-dashed border-cyan/40 bg-cyan/5 px-4 py-3 text-sm text-cyan-light">
            {TRUSTED_AUTHORIZATION_LABEL}
          </p>
          <PrivacyCurtain
            message="Awaiting trusted approval"
            detail="Your trusted contact approves on their own device. No code is ever read aloud or shared between you."
          />
          {cancelButton}
        </div>
      </StageLayout>
    )
  }

  if (flow.stage === 'ask_amount') {
    return (
      <StageLayout orbState={flow.isListening ? 'listening' : 'speaking'} eyebrow={title} heading="How much?" caption={flow.caption}>
        <div className="flex flex-col gap-3">
          {micButton}
          <div className="grid grid-cols-2 gap-3" role="group" aria-label="Choose an amount">
            {amountPresets.map((value) => (
              <AccessibleButton key={value} variant="secondary" onClick={() => flow.submitAmount(value)}>
                {formatPKR(value)}
              </AccessibleButton>
            ))}
          </div>
          <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-midnight-800 p-4 text-left">
            <label htmlFor="custom-amount" className="text-xs text-white/60">
              Or enter an amount in rupees
            </label>
            <input
              id="custom-amount"
              inputMode="numeric"
              value={customAmount}
              onChange={(e) => setCustomAmount(e.target.value.replace(/[^\d]/g, ''))}
              className="rounded-xl border border-white/15 bg-midnight-700 px-4 py-3 text-white"
            />
            <AccessibleButton
              disabled={!customAmount}
              onClick={() => flow.submitAmount(Number(customAmount))}
            >
              Use this amount
            </AccessibleButton>
          </div>
          {cancelButton}
        </div>
      </StageLayout>
    )
  }

  if (flow.stage === 'ask_recipient') {
    return (
      <StageLayout
        orbState={flow.isListening ? 'listening' : 'speaking'}
        eyebrow={title}
        heading="Who are you paying?"
        caption={flow.caption}
      >
        <div className="flex flex-col gap-3">
          {micButton}
          {recipientPresets.length > 0 && (
            <div className="flex flex-col gap-3" role="group" aria-label="Choose a recipient">
              {recipientPresets.map((name) => (
                <AccessibleButton key={name} variant="secondary" onClick={() => flow.submitRecipient(name)}>
                  {name}
                </AccessibleButton>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-midnight-800 p-4 text-left">
            <label htmlFor="custom-recipient" className="text-xs text-white/60">
              Or type a name
            </label>
            <input
              id="custom-recipient"
              value={customRecipient}
              onChange={(e) => setCustomRecipient(e.target.value)}
              className="rounded-xl border border-white/15 bg-midnight-700 px-4 py-3 text-white"
            />
            <AccessibleButton disabled={!customRecipient.trim()} onClick={() => flow.submitRecipient(customRecipient)}>
              Use this name
            </AccessibleButton>
          </div>
          {cancelButton}
        </div>
      </StageLayout>
    )
  }

  if (flow.stage === 'challenge') {
    return (
      <StageLayout orbState="verifying" eyebrow="Identity Verification" heading="Identity Verification" caption={flow.caption}>
        <div className="flex flex-col gap-3">
          <PrivacyCurtain
            message="Listen for your security challenge"
            detail="Your challenge number is spoken, not shown. It is different for every transaction."
          />

          {/*
            Developer mode reveals the challenge on screen.

            Without this there is no way out of this step if the speech output
            cannot be heard: the number exists only in audio, so a silent
            device means a transaction that can never be completed or
            debugged. Hidden behind developer mode, so the privacy-first
            experience is unchanged for a real user.
          */}
          {devMode && flow.challenge && (
            <div className="rounded-2xl border border-dashed border-cyan/40 bg-cyan/5 p-4 text-left">
              <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-cyan">
                Developer mode — spoken challenge
              </p>
              <p className="mt-2 text-sm text-white/80">
                Say: <span className="font-bold text-cyan-light">{secretWord}</span>{' '}
                <span className="font-bold text-cyan-light">{flow.challenge.number}</span>
              </p>
              <p className="mt-1 text-xs leading-relaxed text-white/45">
                The number is random and changes on every transaction. Hidden from real users, who hear it instead.
              </p>
            </div>
          )}

          {micButton}
          {cancelButton}
          <button
            type="button"
            onClick={() => setManualOpen((v) => !v)}
            aria-expanded={manualOpen}
            className="min-h-[44px] text-sm text-white/60 underline underline-offset-4 focus-visible:outline focus-visible:outline-4 focus-visible:outline-cyan"
          >
            Trouble speaking? Enter your verification manually
          </button>
          {manualOpen && (
            <div className="flex flex-col gap-2 rounded-2xl border border-white/10 bg-midnight-800 p-4 text-left">
              <p className="text-xs leading-relaxed text-white/40">
                Shown only because you opened this fallback. The number alone proves nothing without your secret
                word, which is never displayed.
              </p>
              {flow.challenge && (
                <p className="rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/80">
                  This transaction&rsquo;s number is{' '}
                  <span className="font-bold text-cyan-light">{flow.challenge.number}</span>
                </p>
              )}
              <label htmlFor="manual-word" className="text-xs text-white/60">
                Secret word
              </label>
              <input
                id="manual-word"
                value={manualWord}
                autoComplete="off"
                onChange={(e) => setManualWord(e.target.value)}
                className="rounded-xl border border-white/15 bg-midnight-700 px-4 py-3 text-white"
              />
              <label htmlFor="manual-digits" className="text-xs text-white/60">
                Security number
              </label>
              <input
                id="manual-digits"
                value={manualDigits}
                inputMode="numeric"
                onChange={(e) => setManualDigits(e.target.value.replace(/[^\d]/g, ''))}
                className="rounded-xl border border-white/15 bg-midnight-700 px-4 py-3 text-white"
              />
              <AccessibleButton
                onClick={() => {
                  flow.submitChallenge(manualWord, manualDigits)
                  setManualWord('')
                  setManualDigits('')
                }}
              >
                Verify
              </AccessibleButton>
            </div>
          )}
        </div>
      </StageLayout>
    )
  }

  if (flow.stage === 'confirm') {
    return (
      <StageLayout
        orbState={flow.isListening ? 'listening' : 'speaking'}
        eyebrow="Ready To Confirm"
        heading="Ready To Confirm"
        caption={flow.caption}
      >
        <div className="flex flex-col gap-3">
          <PrivacyCurtain
            message="Please listen before confirming"
            detail="The amount and payee were read to you privately. They are not shown on screen."
          />
          {micButton}
          <AccessibleButton onClick={flow.confirm}>Confirm</AccessibleButton>
          {cancelButton}
        </div>
      </StageLayout>
    )
  }

  // intro / review
  return (
    <StageLayout orbState={flow.orbState} eyebrow={title} heading={title} caption={flow.caption}>
      <div className="flex flex-col gap-3">
        <PrivacyCurtain />
        {cancelButton}
      </div>
    </StageLayout>
  )
}
