import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { FlowRequest, VoiceSessionState, VoiceStopReason } from '../types/voice'

const VOICE_MODE_KEY = 'awazpay_voice_mode_v1'

/**
 * Shared state for the voice session.
 *
 * Two jobs:
 *
 *  1. Carry a financial flow request from wherever it was spoken to the
 *     screen that runs it, so "pay two thousand to Ahmed" arrives at the
 *     payment screen with its slots already filled.
 *
 *  2. Hold the session status and the microphone suspend/resume controls, so
 *     a transaction flow can take the microphone for its own questions and
 *     hand it back when it finishes. Only one recogniser may be live at a
 *     time, so this hand-off has to be explicit.
 */
interface VoiceSessionContextValue {
  pendingFlow: FlowRequest | null
  setPendingFlow: (request: FlowRequest) => void
  /** Reads and clears the pending request. */
  consumeFlow: () => FlowRequest | null
  clearFlow: () => void

  /** The last transcript recognised, shown as non-sensitive UI feedback. */
  lastTranscript: string
  setLastTranscript: (text: string) => void

  /** True once the user has granted the microphone through the one-time gesture. */
  voiceModeEnabled: boolean
  setVoiceModeEnabled: (enabled: boolean) => void

  sessionState: VoiceSessionState
  setSessionState: (state: VoiceSessionState) => void
  stopReason: VoiceStopReason
  setStopReason: (reason: VoiceStopReason) => void

  /** Registered by the assistant so any screen can hand the mic over. */
  registerMicControls: (controls: MicControls | null) => void

  /**
   * Registers what "cancel" means on the current screen.
   *
   * Cancelling is the one command that must always work, from anywhere,
   * without a wake phrase in front of it. A user who has lost track of where
   * they are needs a way out that does not depend on remembering anything.
   */
  registerCancelHandler: (handler: (() => void) | null) => void
  /** True when some screen has something cancellable right now. */
  canCancel: () => boolean
  /** Runs the registered cancel handler. Returns false if there was none. */
  requestCancel: () => boolean
  /** Called by a transaction flow taking over the microphone. */
  suspendListening: () => void
  /** Called when a transaction flow gives the microphone back. */
  resumeListening: () => void
  /** Reopens the microphone after the user stopped it. */
  restartListening: () => void
}

export interface MicControls {
  suspend: () => void
  resume: () => void
  restart: () => void
}

const VoiceSessionContext = createContext<VoiceSessionContextValue | null>(null)

function loadVoiceMode(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(VOICE_MODE_KEY) === 'true'
  } catch {
    return false
  }
}

export function VoiceSessionProvider({ children }: { children: ReactNode }) {
  const [pendingFlow, setPendingFlowState] = useState<FlowRequest | null>(null)
  const [lastTranscript, setLastTranscript] = useState('')
  const [voiceModeEnabled, setVoiceModeEnabledState] = useState(loadVoiceMode)
  const [sessionState, setSessionState] = useState<VoiceSessionState>('off')
  const [stopReason, setStopReason] = useState<VoiceStopReason>(null)
  const flowRef = useRef<FlowRequest | null>(null)
  const micRef = useRef<MicControls | null>(null)
  const cancelRef = useRef<(() => void) | null>(null)
  /** Counts nested suspends so two overlapping screens cannot fight. */
  const suspendDepth = useRef(0)

  const setPendingFlow = useCallback((request: FlowRequest) => {
    flowRef.current = request
    setPendingFlowState(request)
  }, [])

  const consumeFlow = useCallback(() => {
    const current = flowRef.current
    flowRef.current = null
    if (current) setPendingFlowState(null)
    return current
  }, [])

  const clearFlow = useCallback(() => {
    flowRef.current = null
    setPendingFlowState(null)
  }, [])

  const setVoiceModeEnabled = useCallback((enabled: boolean) => {
    setVoiceModeEnabledState(enabled)
    try {
      window.localStorage.setItem(VOICE_MODE_KEY, String(enabled))
    } catch {
      // Storage can be unavailable; voice mode then lasts for this session.
    }
  }, [])

  const registerMicControls = useCallback((controls: MicControls | null) => {
    micRef.current = controls
  }, [])

  const registerCancelHandler = useCallback((handler: (() => void) | null) => {
    cancelRef.current = handler
  }, [])

  const canCancel = useCallback(() => cancelRef.current !== null, [])

  const requestCancel = useCallback(() => {
    const handler = cancelRef.current
    if (!handler) return false
    handler()
    return true
  }, [])

  const suspendListening = useCallback(() => {
    suspendDepth.current += 1
    micRef.current?.suspend()
  }, [])

  const resumeListening = useCallback(() => {
    suspendDepth.current = Math.max(0, suspendDepth.current - 1)
    if (suspendDepth.current === 0) micRef.current?.resume()
  }, [])

  const restartListening = useCallback(() => {
    suspendDepth.current = 0
    micRef.current?.restart()
  }, [])

  useEffect(() => () => registerMicControls(null), [registerMicControls])

  const value = useMemo(
    () => ({
      pendingFlow,
      setPendingFlow,
      consumeFlow,
      clearFlow,
      lastTranscript,
      setLastTranscript,
      voiceModeEnabled,
      setVoiceModeEnabled,
      sessionState,
      setSessionState,
      stopReason,
      setStopReason,
      registerMicControls,
      registerCancelHandler,
      canCancel,
      requestCancel,
      suspendListening,
      resumeListening,
      restartListening,
    }),
    [
      pendingFlow,
      setPendingFlow,
      consumeFlow,
      clearFlow,
      lastTranscript,
      voiceModeEnabled,
      setVoiceModeEnabled,
      sessionState,
      stopReason,
      registerMicControls,
      registerCancelHandler,
      canCancel,
      requestCancel,
      suspendListening,
      resumeListening,
      restartListening,
    ],
  )

  return <VoiceSessionContext.Provider value={value}>{children}</VoiceSessionContext.Provider>
}

export function useVoiceSession(): VoiceSessionContextValue {
  const context = useContext(VoiceSessionContext)
  if (!context) throw new Error('useVoiceSession must be used within VoiceSessionProvider')
  return context
}
