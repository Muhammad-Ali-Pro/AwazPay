import { createContext, useContext, type ReactNode } from 'react'
import { useVoiceAssistant, type UseVoiceAssistantResult } from '../hooks/useVoiceAssistant'

/**
 * Runs the voice assistant exactly once and shares it with the whole shell.
 *
 * The session has to outlive any single screen: if the assistant were mounted
 * inside Home, navigating to a payment would tear down the microphone and the
 * user would have to re-enable voice on every screen. Mounted here, the
 * session survives navigation, which is what makes the app hands-free.
 */
const AssistantContext = createContext<UseVoiceAssistantResult | null>(null)

export function VoiceAssistantProvider({ children }: { children: ReactNode }) {
  const assistant = useVoiceAssistant()
  return <AssistantContext.Provider value={assistant}>{children}</AssistantContext.Provider>
}

export function useVoiceAssistantContext(): UseVoiceAssistantResult {
  const context = useContext(AssistantContext)
  if (!context) throw new Error('useVoiceAssistantContext must be used within VoiceAssistantProvider')
  return context
}
