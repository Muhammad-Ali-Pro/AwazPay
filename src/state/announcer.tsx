import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { resolvePhrase, speak, stopSpeaking } from '../services/voiceOutputService'
import type { Phrase } from '../data/voicePhrases'
import { useAppState } from './store'

interface AnnounceOptions {
  interrupt?: boolean
  /** Skip the visible/screen-reader live region and speak only. */
  speakOnly?: boolean
  onEnd?: () => void
}

/**
 * Anything speakable: a plain string, or a multilingual phrase whose Urdu,
 * Roman Urdu or English variant is chosen from the current voice setting.
 */
export type Speakable = string | Phrase

interface AnnouncerContextValue {
  /** Speaks text and mirrors it to an assertive live region. */
  announce: (text: Speakable, options?: AnnounceOptions) => void
  /** Promise form; resolves when the utterance has finished playing. */
  announceAsync: (text: Speakable, options?: Omit<AnnounceOptions, 'onEnd'>) => Promise<void>
  liveText: string
  silence: () => void
  /** True while voice guidance is playing, used to drive the orb. */
  isSpeaking: boolean
}

const AnnouncerContext = createContext<AnnouncerContextValue | null>(null)

export function AnnouncerProvider({ children }: { children: ReactNode }) {
  const { settings } = useAppState()
  const [liveText, setLiveText] = useState('')
  const [isSpeaking, setIsSpeaking] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(
    () => () => {
      if (resetTimer.current) clearTimeout(resetTimer.current)
      if (showTimer.current) clearTimeout(showTimer.current)
      stopSpeaking()
    },
    [],
  )

  const announce = useCallback(
    (input: Speakable, options: AnnounceOptions = {}) => {
      const { interrupt = true, speakOnly = false, onEnd } = options
      const text = resolvePhrase(input, settings.voiceLanguage)
      if (!speakOnly) {
        // Force a DOM change even if the text repeats, so screen readers
        // re-announce it.
        setLiveText('')
        if (showTimer.current) clearTimeout(showTimer.current)
        showTimer.current = setTimeout(() => setLiveText(text), 30)
        if (resetTimer.current) clearTimeout(resetTimer.current)
        resetTimer.current = setTimeout(() => setLiveText(''), 10000)
      }
      setIsSpeaking(true)
      speak(text, {
        rate: settings.voiceSpeed,
        lang: settings.voiceLanguage,
        interrupt,
        onEnd: () => {
          setIsSpeaking(false)
          onEnd?.()
        },
      })
    },
    [settings.voiceSpeed, settings.voiceLanguage],
  )

  const announceAsync = useCallback(
    (text: Speakable, options: Omit<AnnounceOptions, 'onEnd'> = {}) =>
      new Promise<void>((resolve) => {
        announce(text, { ...options, onEnd: resolve })
      }),
    [announce],
  )

  const silence = useCallback(() => {
    stopSpeaking()
    setIsSpeaking(false)
    setLiveText('')
  }, [])

  return (
    <AnnouncerContext.Provider value={{ announce, announceAsync, liveText, silence, isSpeaking }}>
      {children}
      <div aria-live="assertive" role="status" className="sr-only">
        {liveText}
      </div>
    </AnnouncerContext.Provider>
  )
}

export function useAnnouncer(): AnnouncerContextValue {
  const context = useContext(AnnouncerContext)
  if (!context) throw new Error('useAnnouncer must be used within AnnouncerProvider')
  return context
}
