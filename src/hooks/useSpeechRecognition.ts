/**
 * SUPERSEDED. Speech-to-text now lives in src/services/speechService.ts, and
 * src/hooks/useVoiceAssistant.ts is the React entry point for it.
 *
 * This hook is kept because it is a working, self-contained wrapper that
 * predates the service layer and nothing in the app imports it any more.
 * Prefer the service for new code: it maps error codes to spoken messages,
 * guarantees exactly one resolution per listening turn, and enforces a single
 * live recognition session.
 */
import { useCallback, useEffect, useRef, useState } from 'react'

export type RecognitionStatus = 'idle' | 'listening' | 'processing' | 'unsupported' | 'denied'

interface UseSpeechRecognitionOptions {
  lang?: string
  onFinalResult?: (transcript: string) => void
}

export function useSpeechRecognition({ lang = 'en-US', onFinalResult }: UseSpeechRecognitionOptions = {}) {
  const [status, setStatus] = useState<RecognitionStatus>('idle')
  const [interimTranscript, setInterimTranscript] = useState('')
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const onFinalResultRef = useRef(onFinalResult)
  onFinalResultRef.current = onFinalResult

  const isSupported =
    typeof window !== 'undefined' && !!(window.SpeechRecognition || window.webkitSpeechRecognition)

  useEffect(() => {
    if (!isSupported) {
      setStatus('unsupported')
      return
    }
    const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition
    const recognition = new SpeechRecognitionCtor!()
    recognition.lang = lang
    recognition.continuous = false
    recognition.interimResults = true
    recognition.maxAlternatives = 1

    recognition.onresult = (event) => {
      let interim = ''
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i]
        const transcript = result[0].transcript
        if (result.isFinal) {
          setStatus('processing')
          onFinalResultRef.current?.(transcript)
        } else {
          interim += transcript
        }
      }
      setInterimTranscript(interim)
    }

    recognition.onerror = (event) => {
      const error = (event as Event & { error?: string }).error
      setStatus(error === 'not-allowed' || error === 'permission-denied' ? 'denied' : 'idle')
    }

    recognition.onend = () => {
      setStatus((current) => (current === 'listening' ? 'idle' : current))
    }

    recognitionRef.current = recognition
    return () => {
      recognition.abort()
      recognitionRef.current = null
    }
  }, [isSupported, lang])

  const startListening = useCallback(() => {
    if (!recognitionRef.current) return
    setInterimTranscript('')
    try {
      recognitionRef.current.start()
      setStatus('listening')
    } catch {
      // Recognition already running; ignore.
    }
  }, [])

  const stopListening = useCallback(() => {
    recognitionRef.current?.stop()
  }, [])

  const resetToIdle = useCallback(() => setStatus('idle'), [])

  return { status, interimTranscript, isSupported, startListening, stopListening, resetToIdle }
}
