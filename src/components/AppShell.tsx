import { useRef } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { PrivacyBadge } from './PrivacyBadge'
import { VoiceAssistantProvider, useVoiceAssistantContext } from '../state/assistantContext'
import { useAppDispatch, useAppState } from '../state/store'

const NAV_ITEMS = [
  { to: '/home', label: 'Home', icon: '🏠' },
  { to: '/history', label: 'Activity', icon: '📜' },
  { to: '/trusted-circle', label: 'Trusted Circle', icon: '🤝' },
  { to: '/settings', label: 'Settings', icon: '⚙️' },
]

/**
 * A always-visible indicator that the assistant is awake.
 *
 * On every screen except Home the orb is not on show, so this is how the user
 * (or a sighted helper) can tell the microphone is still open. It doubles as
 * the recovery control if the session was stopped.
 */
function VoiceIndicator() {
  const assistant = useVoiceAssistantContext()
  const live = assistant.sessionState !== 'off'

  return (
    <button
      type="button"
      onClick={() => (live ? assistant.stopListening() : assistant.restartListening())}
      aria-label={
        live
          ? `${assistant.statusText}. Activate to stop voice mode.`
          : 'Voice mode is off. Activate to start listening again.'
      }
      className="flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-2 text-xs font-medium text-white/70 focus-visible:outline focus-visible:outline-4 focus-visible:outline-cyan"
    >
      <span
        className={`h-2.5 w-2.5 rounded-full ${
          live ? (assistant.micOpen ? 'bg-cyan animate-pulse' : 'bg-cyan/50') : 'bg-white/30'
        }`}
        aria-hidden="true"
      />
      <span aria-hidden="true">{live ? 'Voice on' : 'Voice off'}</span>
    </button>
  )
}

function ShellChrome() {
  const { devMode } = useAppState()
  const dispatch = useAppDispatch()
  const tapCount = useRef(0)
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  function handleLogoTap() {
    tapCount.current += 1
    if (tapTimer.current) clearTimeout(tapTimer.current)
    tapTimer.current = setTimeout(() => {
      tapCount.current = 0
    }, 1500)
    if (tapCount.current >= 5) {
      tapCount.current = 0
      dispatch({ type: 'SET_DEV_MODE', enabled: !devMode })
    }
  }

  return (
    <div className="flex min-h-dvh flex-col bg-midnight-950 text-white">
      <header className="flex items-center justify-between gap-3 px-5 pt-6">
        <button type="button" onClick={handleLogoTap} className="flex items-center gap-2" aria-label="AwazPay">
          <img src="/awazpay-icon.png" alt="" className="h-8 w-8" aria-hidden="true" />
          <span className="text-lg font-bold tracking-tight">
            Awaz<span className="text-cyan">Pay</span>
          </span>
        </button>
        <VoiceIndicator />
      </header>

      <div className="flex justify-center px-5 pt-3">
        <PrivacyBadge />
      </div>

      <main className="flex-1 px-5 pb-28 pt-5">
        <Outlet />
      </main>

      <nav
        aria-label="Primary"
        className="fixed inset-x-0 bottom-0 z-20 border-t border-white/10 bg-midnight-900/95 backdrop-blur"
      >
        <ul className="mx-auto flex max-w-md justify-between px-2 py-2">
          {NAV_ITEMS.map((item) => (
            <li key={item.to} className="flex-1">
              <NavLink
                to={item.to}
                className={({ isActive }) =>
                  `flex flex-col items-center gap-1 rounded-xl px-2 py-2 text-xs font-medium focus-visible:outline focus-visible:outline-4 focus-visible:outline-cyan ${
                    isActive ? 'text-violet-light' : 'text-white/60 hover:text-white'
                  }`
                }
              >
                <span className="text-xl" aria-hidden="true">
                  {item.icon}
                </span>
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  )
}

/**
 * The shell owns the voice session, so the microphone stays open as the user
 * moves between screens.
 */
export function AppShell() {
  return (
    <VoiceAssistantProvider>
      <ShellChrome />
    </VoiceAssistantProvider>
  )
}
