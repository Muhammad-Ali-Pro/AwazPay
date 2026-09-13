import { createContext, useContext, useEffect, useMemo, useReducer, type ReactNode } from 'react'
import type { AppSettings, AppState, Transaction, TrustedContact } from '../types'
import { loadWallet, resetWallet, saveWallet } from '../services/transactionService'

type Action =
  | { type: 'COMPLETE_ONBOARDING'; secretWord: string }
  | { type: 'ADD_TRANSACTION'; transaction: Transaction; balanceDelta: number }
  | { type: 'UPDATE_SETTINGS'; settings: Partial<AppSettings> }
  | { type: 'ADD_TRUSTED_CONTACT'; contact: TrustedContact }
  | { type: 'REMOVE_TRUSTED_CONTACT'; id: string }
  | { type: 'SET_DEV_MODE'; enabled: boolean }
  /** Wipes saved demo state and reseeds the wallet. Used by Settings. */
  | { type: 'RESET_DEMO' }
  | { type: 'RESET' }

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case 'COMPLETE_ONBOARDING':
      return { ...state, onboardingComplete: true, secretWord: action.secretWord || state.secretWord }
    case 'ADD_TRANSACTION':
      return {
        ...state,
        balance: state.balance + action.balanceDelta,
        transactions: [action.transaction, ...state.transactions],
      }
    case 'UPDATE_SETTINGS':
      return { ...state, settings: { ...state.settings, ...action.settings } }
    case 'ADD_TRUSTED_CONTACT':
      return { ...state, trustedCircle: [...state.trustedCircle, action.contact] }
    case 'REMOVE_TRUSTED_CONTACT':
      return { ...state, trustedCircle: state.trustedCircle.filter((c) => c.id !== action.id) }
    case 'SET_DEV_MODE':
      return { ...state, devMode: action.enabled }
    case 'RESET_DEMO':
    case 'RESET':
      // resetWallet clears storage; the persistence effect then writes the
      // fresh seed back on the next render.
      return { ...resetWallet(), onboardingComplete: state.onboardingComplete, secretWord: state.secretWord }
    default:
      return state
  }
}

const StateContext = createContext<AppState | null>(null)
const DispatchContext = createContext<React.Dispatch<Action> | null>(null)

export function AppStateProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadWallet)

  useEffect(() => {
    saveWallet(state)
  }, [state])

  const value = useMemo(() => state, [state])

  return (
    <StateContext.Provider value={value}>
      <DispatchContext.Provider value={dispatch}>{children}</DispatchContext.Provider>
    </StateContext.Provider>
  )
}

export function useAppState(): AppState {
  const context = useContext(StateContext)
  if (!context) throw new Error('useAppState must be used within AppStateProvider')
  return context
}

export function useAppDispatch(): React.Dispatch<Action> {
  const context = useContext(DispatchContext)
  if (!context) throw new Error('useAppDispatch must be used within AppStateProvider')
  return context
}
