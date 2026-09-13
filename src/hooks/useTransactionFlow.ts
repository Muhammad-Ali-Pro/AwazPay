import { useCallback, useEffect, useRef, useState } from 'react'
import type { FlowKind, FlowRequest, OrbState, SecurityChallenge, SpeechError } from '../types/voice'
import type { TransactionResult } from '../types/wallet'
import {
  MAX_VERIFICATION_ATTEMPTS,
  SIMULATED_APPROVAL_MS,
  generateChallenge,
  requestTrustedApproval,
  requiresTrustedCircle,
  resolveTrustedApproval,
  verifyChallengeResponse,
} from '../engines/securityEngine'
import {
  extractAmount,
  extractMobileNumber,
  extractRecipient,
  normalizeTranscript,
  parseTranscriptSync,
  pickBestInterpretation,
} from '../services/intentService'
import { normalizeForIntent } from '../services/normalizationService'
import { recordError, recordRecognition } from '../services/diagnosticsService'
import { getActiveSpeechProvider, type RecognitionOutcome } from '../services/speechProvider'

import { simulateCashDeposit, simulatePayment, simulateTopUp } from '../services/transactionService'
import { vibrate } from '../lib/haptics'
import { useAnnouncer } from '../state/announcer'
import { useAppDispatch, useAppState } from '../state/store'
import { useVoiceSession } from '../state/voiceSession'
import { DEMO_MOBILE_NUMBER } from '../data/demoWallet'
import { PHRASES, fill, money, type Phrase } from '../data/voicePhrases'

/**
 * The voice-profile setting is a user-facing choice; the recogniser needs a
 * real BCP-47 tag. Auto / Mixed resolves to Pakistani English, which handles
 * code-mixed Urdu-English speech best.
 */
function recognitionLanguage(profile: string): string {
  return profile === 'auto' ? 'en-PK' : profile
}

/**
 * Stages of the SPEAK -> LISTEN -> VERIFY -> CONFIRM journey.
 *
 * Every stage that reveals a figure does so through speech only. The screen
 * shows a privacy message, never the amount, payee or challenge number.
 */
export type FlowStage =
  | 'intro'
  | 'ask_amount'
  | 'ask_recipient'
  | 'review'
  | 'challenge'
  | 'trusted_pending'
  | 'confirm'
  | 'processing'
  | 'success'
  | 'failed'
  | 'cancelled'

export interface FlowState {
  stage: FlowStage
  orbState: OrbState
  /** Privacy-safe caption for the screen. Never contains a figure. */
  caption: string
  isListening: boolean
  amount?: number
  recipient?: string
  mobileNumber?: string
  /** Only surfaced for the manual keypad fallback, never rendered by default. */
  challenge: SecurityChallenge | null
  attempts: number
  trustedApprover?: string
  /** Spoken explanation of a failure. Never rendered on screen. */
  failureReasonSpoken?: Phrase
  result?: TransactionResult
}

export interface UseTransactionFlowResult extends FlowState {
  isSpeechSupported: boolean
  /** Re-opens the microphone for the current question. */
  listenAgain: () => void
  /** Touch fallback: supply the amount without speaking. */
  submitAmount: (amount: number) => void
  /** Touch fallback: supply the payee without speaking. */
  submitRecipient: (name: string) => void
  /** Touch fallback: type the secret word and challenge number. */
  submitChallenge: (secretWord: string, digits: string) => void
  /** Touch fallback for the final confirmation. */
  confirm: () => void
  cancel: (reason?: Phrase) => void
  restart: () => void
}

const CAPTIONS: Record<FlowStage, string> = {
  intro: 'Please listen to private voice guidance through your earphones.',
  ask_amount: 'Please listen. AwazPay is asking for the amount.',
  ask_recipient: 'Please listen. AwazPay is asking who to pay.',
  review: 'Your transaction details are being delivered privately.',
  challenge: 'Secure verification in progress. Please listen for your challenge.',
  trusted_pending: 'Awaiting Simulated Trusted Circle Authorization.',
  confirm: 'Please listen carefully, then confirm.',
  processing: 'Processing securely...',
  success: 'Complete. Your private receipt is being delivered by voice.',
  failed: 'Please listen to the explanation.',
  cancelled: 'This transaction was cancelled.',
}

const ORB_BY_STAGE: Record<FlowStage, OrbState> = {
  intro: 'speaking',
  ask_amount: 'listening',
  ask_recipient: 'listening',
  review: 'secure',
  challenge: 'verifying',
  trusted_pending: 'verifying',
  confirm: 'listening',
  processing: 'processing',
  success: 'success',
  failed: 'error',
  cancelled: 'error',
}

interface UseTransactionFlowOptions {
  kind: FlowKind
  /** Slots already filled by the voice command that opened this screen. */
  request: FlowRequest | null
}

const MAX_SLOT_ATTEMPTS = 2

/**
 * Drives one simulated financial transaction from spoken request through
 * verification to a private spoken receipt.
 *
 * Payments and top-ups always pass through the security engine: a unique
 * one-time challenge, then a Trusted Circle authorization when the amount is
 * above the standard limit. Cash deposits are a credit rather than a debit,
 * so they take the guidance-and-confirm path without a challenge.
 */
export function useTransactionFlow({ kind, request }: UseTransactionFlowOptions): UseTransactionFlowResult {
  const dispatch = useAppDispatch()
  const state = useAppState()
  const { announce, silence } = useAnnouncer()
  const { suspendListening, resumeListening } = useVoiceSession()
  const isSpeechSupported = getActiveSpeechProvider().isSupported()

  /**
   * A transaction owns the microphone while it is asking questions.
   *
   * The browser allows only one live recogniser, and an answer like "five
   * hundred" must reach this flow rather than being parsed as a fresh
   * top-level command. So the always-on wake-word session stands down for the
   * duration.
   *
   * It is handed back as soon as the flow reaches a terminal stage, not on
   * unmount, so the user can say "Hey AwazPay, home kholo" from the success
   * screen instead of having to reach for a button.
   */
  const holdingMic = useRef(false)

  const [flow, setFlow] = useState<FlowState>(() => ({
    stage: 'intro',
    orbState: 'speaking',
    caption: CAPTIONS.intro,
    isListening: false,
    amount: request?.amount,
    recipient: request?.recipient,
    mobileNumber: request?.mobileNumber ?? (kind === 'topup' ? DEMO_MOBILE_NUMBER : undefined),
    challenge: null,
    attempts: 0,
  }))

  const flowRef = useRef(flow)
  flowRef.current = flow
  // Guards against React StrictMode running a stage effect twice.
  const executedRef = useRef<string>('')
  const slotAttemptsRef = useRef(0)
  /**
   * Incremented on every prompt and on cancel. Speech synthesis fires its
   * end callback even for an utterance that was interrupted, so a prompt that
   * has been superseded must not open the microphone for a stage we have
   * already left.
   */
  const askSeqRef = useRef(0)
  const settingsRef = useRef(state.settings)
  settingsRef.current = state.settings

  const releaseMic = useCallback(() => {
    if (!holdingMic.current) return
    holdingMic.current = false
    resumeListening()
  }, [resumeListening])

  const patch = useCallback((next: Partial<FlowState>) => {
    setFlow((current) => {
      const stage = next.stage ?? current.stage
      return {
        ...current,
        ...next,
        stage,
        orbState: next.orbState ?? ORB_BY_STAGE[stage],
        caption: next.caption ?? CAPTIONS[stage],
      }
    })
  }, [])

  // Take the microphone while questions are being asked; give it back the
  // moment the flow finishes, so the assistant is reachable again by voice.
  const isTerminal = flow.stage === 'success' || flow.stage === 'failed' || flow.stage === 'cancelled'
  useEffect(() => {
    if (isTerminal) {
      releaseMic()
      return
    }
    if (!holdingMic.current) {
      holdingMic.current = true
      suspendListening()
    }
  }, [isTerminal, releaseMic, suspendListening])

  useEffect(
    () => () => {
      getActiveSpeechProvider().cancelOneShot()
      releaseMic()
    },
    [releaseMic],
  )

  const cancel = useCallback(
    (reason?: Phrase) => {
      getActiveSpeechProvider().cancelOneShot()
      askSeqRef.current += 1
      executedRef.current = 'cancelled'
      vibrate('error', settingsRef.current.vibrationEnabled)
      patch({ stage: 'cancelled', failureReasonSpoken: reason })
      announce(reason ?? PHRASES.cancelled)
    },
    [announce, patch],
  )

  /**
   * Speaks a prompt, then opens the microphone once the prompt has finished.
   *
   * Goes through the active SpeechProvider, not any one engine directly, so
   * a slot-filling question is answered by Cloud Speech-to-Text exactly the
   * same way it is answered by the browser engine — this function does not
   * know or care which one is running.
   */
  const ask = useCallback(
    (prompt: Phrase, onAnswer: (transcript: string) => void) => {
      askSeqRef.current += 1
      const seq = askSeqRef.current
      announce(prompt, {
        onEnd: () => {
          if (!isSpeechSupported) return
          if (seq !== askSeqRef.current) return
          patch({ isListening: true })

          const provider = getActiveSpeechProvider()
          let latestOutcome: RecognitionOutcome | null = null

          provider
            .listenOnce({
              lang: recognitionLanguage(settingsRef.current.voiceLanguage),
              // Every ranked reading is captured, so an answer like "paanch
              // hazaar" is still found when the engine's top guess mangles it.
              onOutcome: (result) => {
                latestOutcome = result
              },
            })
            .then((outcome) => {
              if (seq !== askSeqRef.current) return
              patch({ isListening: false })
              const resolved = latestOutcome ?? outcome

              const alternatives = resolved.alternatives.length
                ? resolved.alternatives
                : [{ transcript: resolved.transcript, confidence: resolved.confidence }]
              const best = pickBestInterpretation(alternatives)
              const chosen = best ? alternatives[best.index].transcript : resolved.transcript
              const normalization = normalizeForIntent(chosen)

              recordRecognition({
                rawTranscript: resolved.transcript,
                alternatives,
                chosenIndex: best?.index ?? 0,
                language: resolved.language,
                confidence: best?.recognitionConfidence ?? resolved.confidence,
                normalized: normalization.normalized,
                corrections: normalization.corrections,
                intent: best?.parsed.intent ?? 'slot_answer',
                handledBy: 'local',
                provider: provider.id,
                latencyMs: resolved.latencyMs,
              })

              if (parseTranscriptSync(chosen).intent === 'cancel') {
                cancel()
                return
              }
              onAnswer(chosen)
            })
            .catch((error: SpeechError) => {
              if (seq !== askSeqRef.current) return
              patch({ isListening: false })
              recordError(`${error.kind}: ${error.message}`, settingsRef.current.voiceLanguage, provider.id)
              announce(PHRASES.lowConfidence)
            })
        },
      })
    },
    [announce, cancel, isSpeechSupported, patch],
  )

  const listenRef = useRef<(() => void) | null>(null)
  const listenAgain = useCallback(() => {
    listenRef.current?.()
  }, [])

  // ---------------------------------------------------------------- commit

  const commit = useCallback(() => {
    const { amount, recipient, mobileNumber } = flowRef.current
    if (!amount) {
      cancel(PHRASES.invalidAmount)
      return
    }

    patch({ stage: 'processing' })

    const result =
      kind === 'payment'
        ? simulatePayment(state, amount, recipient ?? 'Unknown recipient')
        : kind === 'topup'
          ? simulateTopUp(state, amount, mobileNumber ?? DEMO_MOBILE_NUMBER)
          : simulateCashDeposit(state, amount)

    if (!result.ok || !result.transaction) {
      vibrate('error', settingsRef.current.vibrationEnabled)
      const message =
        result.error === 'insufficient_balance' ? PHRASES.insufficient : PHRASES.invalidAmount
      patch({ stage: 'failed', failureReasonSpoken: message, result })
      announce(message)
      return
    }

    dispatch({ type: 'ADD_TRANSACTION', transaction: result.transaction, balanceDelta: result.balanceDelta })
    vibrate('success', settingsRef.current.vibrationEnabled)

    const values = {
      name: recipient ?? '',
      number: mobileNumber ?? '',
      amount: money(amount),
      balance: money(result.newBalance),
    }
    const receipt =
      kind === 'payment'
        ? fill(PHRASES.paymentSuccess, values)
        : kind === 'topup'
          ? fill(PHRASES.topUpSuccess, values)
          : fill(PHRASES.depositSuccess, values)

    // A short delay lets the success state land before the receipt plays.
    setTimeout(() => {
      patch({ stage: 'success', result })
      announce(receipt)
    }, 700)
  }, [announce, cancel, dispatch, kind, patch, state])

  // The stage runner is keyed by the stage token, not by callback identity,
  // so it holds the commit function through a ref to avoid reading a stale
  // wallet balance if state changed since the stage was entered.
  const commitRef = useRef(commit)
  commitRef.current = commit

  // ------------------------------------------------------------ stage runner

  useEffect(() => {
    const { stage, amount, recipient, attempts, challenge } = flow
    const token = `${stage}:${attempts}:${challenge?.id ?? ''}:${amount ?? ''}:${recipient ?? ''}`
    if (executedRef.current === token) return
    executedRef.current = token

    switch (stage) {
      case 'intro': {
        const intro =
          kind === 'payment'
            ? PHRASES.paymentIntro
            : kind === 'topup'
              ? PHRASES.topUpProcessing
              : PHRASES.depositGuidance
        announce(intro, {
          onEnd: () => {
            if (!flowRef.current.amount) patch({ stage: 'ask_amount' })
            else if (kind === 'payment' && !flowRef.current.recipient) patch({ stage: 'ask_recipient' })
            else patch({ stage: 'review' })
          },
        })
        break
      }

      case 'ask_amount': {
        const prompt =
          slotAttemptsRef.current === 0
            ? kind === 'payment'
              ? PHRASES.askAmountPay
              : kind === 'topup'
                ? PHRASES.askAmountLoad
                : PHRASES.askAmountDeposit
            : PHRASES.askAmountRetry

        const run = () =>
          ask(prompt, (transcript) => {
            const value = extractAmount(normalizeTranscript(transcript))
            if (value) {
              slotAttemptsRef.current = 0
              patch({ amount: value, stage: kind === 'payment' && !flowRef.current.recipient ? 'ask_recipient' : 'review' })
              return
            }
            slotAttemptsRef.current += 1
            if (slotAttemptsRef.current > MAX_SLOT_ATTEMPTS) {
              cancel(PHRASES.amountGiveUp)
              return
            }
            // Clearing the guard lets the same stage run its prompt again.
            executedRef.current = ''
            setFlow((c) => ({ ...c }))
          })

        listenRef.current = run
        run()
        break
      }

      case 'ask_recipient': {
        const prompt = slotAttemptsRef.current === 0 ? PHRASES.askRecipient : PHRASES.askRecipientRetry

        const run = () =>
          ask(prompt, (transcript) => {
            const name = extractRecipient(normalizeTranscript(transcript)) ?? cleanSpokenName(transcript)
            if (name) {
              slotAttemptsRef.current = 0
              patch({ recipient: name, stage: 'review' })
              return
            }
            slotAttemptsRef.current += 1
            if (slotAttemptsRef.current > MAX_SLOT_ATTEMPTS) {
              cancel(PHRASES.nameGiveUp)
              return
            }
            executedRef.current = ''
            setFlow((c) => ({ ...c }))
          })

        listenRef.current = run
        run()
        break
      }

      case 'review': {
        if (!amount) {
          patch({ stage: 'ask_amount' })
          break
        }
        if (amount > state.balance && kind !== 'deposit') {
          patch({ stage: 'failed', failureReasonSpoken: PHRASES.insufficient })
          announce(PHRASES.insufficient)
          break
        }

        const reviewValues = {
          name: recipient ?? '',
          number: flow.mobileNumber ?? '',
          amount: money(amount),
        }
        const summary =
          kind === 'payment'
            ? fill(PHRASES.reviewPayment, reviewValues)
            : kind === 'topup'
              ? fill(PHRASES.reviewTopUp, reviewValues)
              : fill(PHRASES.reviewDeposit, reviewValues)

        announce(summary, {
          onEnd: () => {
            // Deposits are a credit, so they skip the debit challenge and go
            // straight to explicit confirmation.
            patch({ stage: kind === 'deposit' ? 'confirm' : 'challenge', challenge: null })
          },
        })
        break
      }

      case 'challenge': {
        if (!challenge) {
          // Seeding the challenge changes the stage token, which re-runs this
          // case with the challenge in hand.
          patch({ challenge: generateChallenge() })
          break
        }
        const active = challenge

        const run = () =>
          ask(fill(PHRASES.challenge, { number: active.number }), (transcript) => {
            const ok = verifyChallengeResponse(transcript, state.secretWord, active)
            if (ok) {
              vibrate('detect', settingsRef.current.vibrationEnabled)
              const highValue = requiresTrustedCircle(amount ?? 0, state.settings.transactionLimit)
              patch({ stage: highValue ? 'trusted_pending' : 'confirm' })
              return
            }
            const nextAttempts = flowRef.current.attempts + 1
            if (nextAttempts >= MAX_VERIFICATION_ATTEMPTS) {
              cancel(PHRASES.challengeFailed)
              return
            }
            // A brand-new challenge is issued on every retry.
            announce(PHRASES.challengeRetry, {
              onEnd: () => patch({ attempts: nextAttempts, challenge: generateChallenge() }),
            })
          })

        listenRef.current = run
        run()
        break
      }

      case 'trusted_pending': {
        const approver = state.trustedCircle[0]
        if (!approver) {
          patch({ stage: 'failed', failureReasonSpoken: PHRASES.trustedMissing })
          announce(PHRASES.trustedMissing)
          break
        }

        const approvalRequest = requestTrustedApproval(approver, amount ?? 0)
        announce(fill(PHRASES.trustedRequested, { name: approver.name }))
        const timer = setTimeout(() => {
          const { approved, approver: name } = resolveTrustedApproval(approvalRequest)
          if (!approved) {
            cancel(PHRASES.cancelled)
            return
          }
          patch({ stage: 'confirm', trustedApprover: name })
          announce(fill(PHRASES.trustedApproved, { name }))
        }, SIMULATED_APPROVAL_MS)
        return () => clearTimeout(timer)
      }

      case 'confirm': {
        const confirmValues = { name: recipient ?? '', amount: money(amount ?? 0) }
        const summary =
          kind === 'payment'
            ? fill(PHRASES.confirmPayment, confirmValues)
            : kind === 'topup'
              ? fill(PHRASES.confirmTopUp, confirmValues)
              : fill(PHRASES.confirmDeposit, confirmValues)

        const run = () =>
          ask(summary, (transcript) => {
            const parsed = parseTranscriptSync(transcript)
            if (parsed.intent === 'confirm') {
              commitRef.current()
              return
            }
            announce(PHRASES.confirmNotHeard)
          })

        listenRef.current = run
        run()
        break
      }

      default:
        break
    }
    return undefined
    // The runner is keyed by the stage token computed above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow.stage, flow.attempts, flow.challenge, flow.amount, flow.recipient])

  // ----------------------------------------------------------- touch fallbacks

  const submitAmount = useCallback(
    (amount: number) => {
      getActiveSpeechProvider().cancelOneShot()
      slotAttemptsRef.current = 0
      patch({ amount, stage: kind === 'payment' && !flowRef.current.recipient ? 'ask_recipient' : 'review' })
    },
    [kind, patch],
  )

  const submitRecipient = useCallback(
    (name: string) => {
      getActiveSpeechProvider().cancelOneShot()
      slotAttemptsRef.current = 0
      if (!name.trim()) return
      patch({ recipient: name.trim(), stage: 'review' })
    },
    [patch],
  )

  const submitChallenge = useCallback(
    (secretWord: string, digits: string) => {
      getActiveSpeechProvider().cancelOneShot()
      const active = flowRef.current.challenge
      if (!active) return
      const ok = verifyChallengeResponse(`${secretWord} ${digits}`, state.secretWord, active)
      if (ok) {
        const highValue = requiresTrustedCircle(flowRef.current.amount ?? 0, state.settings.transactionLimit)
        patch({ stage: highValue ? 'trusted_pending' : 'confirm' })
        return
      }
      const nextAttempts = flowRef.current.attempts + 1
      if (nextAttempts >= MAX_VERIFICATION_ATTEMPTS) {
        cancel(PHRASES.challengeFailed)
        return
      }
      announce(PHRASES.challengeRetry)
      patch({ attempts: nextAttempts, challenge: generateChallenge() })
    },
    [announce, cancel, patch, state.secretWord, state.settings.transactionLimit],
  )

  const confirmNow = useCallback(() => {
    getActiveSpeechProvider().cancelOneShot()
    askSeqRef.current += 1
    commitRef.current()
  }, [])

  const restart = useCallback(() => {
    getActiveSpeechProvider().cancelOneShot()
    silence()
    slotAttemptsRef.current = 0
    askSeqRef.current += 1
    executedRef.current = ''
    setFlow({
      stage: 'intro',
      orbState: 'speaking',
      caption: CAPTIONS.intro,
      isListening: false,
      amount: undefined,
      recipient: undefined,
      mobileNumber: kind === 'topup' ? DEMO_MOBILE_NUMBER : undefined,
      challenge: null,
      attempts: 0,
    })
  }, [kind, silence])

  return {
    ...flow,
    isSpeechSupported,
    listenAgain,
    submitAmount,
    submitRecipient,
    submitChallenge,
    confirm: confirmNow,
    cancel,
    restart,
  }
}

/** Last-resort payee cleanup when no known name matched. */
function cleanSpokenName(transcript: string): string | undefined {
  const words = transcript
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 1 && !['pay', 'to', 'send', 'the', 'please', 'name', 'is'].includes(w))
  if (!words.length) return undefined
  return words
    .slice(0, 3)
    .join(' ')
    .replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Re-exported so screens can offer a mobile-number fallback field. */
export { extractMobileNumber }
