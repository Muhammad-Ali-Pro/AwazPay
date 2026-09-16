import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useVoiceSession } from '../state/voiceSession'

/**
 * Sends the user back to the spoken main menu when a task finishes.
 *
 * Every screen in AwazPay is a dead end without this. A blind user who has
 * just heard "payment complete" has no way to get back to the menu except by
 * finding a "Done" button, which is exactly the tapping this app exists to
 * avoid. So each flow calls this once its final sentence has been spoken, and
 * the home screen reads the options out again.
 *
 * It also clears the session state. Leaving it on 'transaction' was why the
 * home screen could come back showing "Secure verification in progress" with
 * a padlock, long after the transaction had been cancelled.
 */
export function useReturnToMenu(): (delayMs?: number) => void {
  const navigate = useNavigate()
  const { setSessionState } = useVoiceSession()

  return useCallback(
    (delayMs = 0) => {
      const go = () => {
        setSessionState('ready')
        // `replace` so the back gesture does not drop the user into a
        // finished transaction screen.
        navigate('/home', { replace: true })
      }
      if (delayMs > 0) setTimeout(go, delayMs)
      else go()
    },
    [navigate, setSessionState],
  )
}
