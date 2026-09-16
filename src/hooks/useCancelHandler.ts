import { useEffect, useRef } from 'react'
import { useVoiceSession } from '../state/voiceSession'

/**
 * Declares what "cancel" does on the current screen.
 *
 * Cancelling is the one command that works from anywhere with no wake phrase
 * in front of it. Everything else is gated behind "Hey AwazPay" so ambient
 * conversation cannot move money, but a user who wants out must be able to
 * say so plainly and be heard — especially a user who cannot see which
 * screen they are on or find the button.
 *
 * The handler is held in a ref and re-read on every call, so a screen can
 * close over fresh state without re-registering on every render.
 */
export function useCancelHandler(handler: () => void): void {
  const { registerCancelHandler } = useVoiceSession()
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    registerCancelHandler(() => handlerRef.current())
    return () => registerCancelHandler(null)
  }, [registerCancelHandler])
}
