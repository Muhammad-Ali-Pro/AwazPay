import { useCallback, useEffect, useRef, useState } from 'react'
import { AccessibleButton } from './AccessibleButton'
import {
  clearVoiceLog,
  isVoiceSessionSupported,
  subscribeMicLevel,
  subscribeVoiceLog,
  subscribeVoiceStatus,
  voiceSession,
  type ControllerStatus,
} from '../services/voiceSessionController'

/**
 * MICROPHONE TEST — the smallest possible proof that the microphone works.
 *
 * Deliberately does nothing else. No wake word, no intent parsing, no
 * text-to-speech, no transactions, and above all no auto-restart. It opens
 * the microphone exactly once, runs one recognition pass, and shows what
 * happened at each step:
 *
 *   you speak -> level bar moves -> interim transcript -> final transcript
 *
 * If this works and the full assistant does not, the fault is in the layers
 * above; if this does not work, nothing above it can.
 */
const LANGUAGES = [
  { value: 'en-US', label: 'English (US)' },
  { value: 'en-GB', label: 'English (UK)' },
  { value: 'en-IN', label: 'English (India)' },
  { value: 'en-PK', label: 'English (Pakistan)' },
  { value: 'ur-PK', label: 'Urdu (Pakistan)' },
]

export function MicrophoneTest() {
  const [status, setStatus] = useState<ControllerStatus>(() => voiceSession.getStatus())
  const [level, setLevel] = useState(0)
  const [peakSeen, setPeakSeen] = useState(0)
  const [interim, setInterim] = useState('')
  const [finals, setFinals] = useState<Array<{ text: string; at: number; latencyMs?: number }>>([])
  const [log, setLog] = useState<string[]>([])
  const [language, setLanguage] = useState('en-US')
  const [error, setError] = useState<string | null>(null)
  const startedRef = useRef(false)

  useEffect(() => subscribeVoiceStatus(setStatus), [])
  useEffect(() => subscribeVoiceLog(setLog), [])
  useEffect(
    () =>
      subscribeMicLevel((next) => {
        setLevel(next)
        setPeakSeen((prev) => (next > prev ? next : prev))
      }),
    [],
  )

  // Stop the test session when this panel goes away, so it never leaves the
  // microphone open behind the user's back.
  useEffect(
    () => () => {
      if (startedRef.current) {
        voiceSession.stop('microphone test closed')
        startedRef.current = false
      }
    },
    [],
  )

  const start = useCallback(async () => {
    setError(null)
    setInterim('')
    setFinals([])
    setPeakSeen(0)
    startedRef.current = true

    const ok = await voiceSession.start(
      // autoRestart off is the whole point of this mode: one pass, one
      // result, no churn to muddy what you are looking at.
      { langs: [language], autoRestart: false },
      {
        onInterim: (text) => setInterim(text),
        onFinal: (outcome) => {
          setInterim('')
          setFinals((prev) => [{ text: outcome.transcript, at: Date.now(), latencyMs: outcome.latencyMs }, ...prev])
        },
        onSilence: () => setInterim(''),
        onError: (message) => setError(message),
      },
    )
    if (!ok) startedRef.current = false
  }, [language])

  const stop = useCallback(() => {
    voiceSession.stop('microphone test stopped by user')
    startedRef.current = false
    setInterim('')
  }, [])

  const listenAgain = useCallback(() => {
    setInterim('')
    voiceSession.restartRecognition('microphone test: listen again')
  }, [])

  const running = status.state !== 'stopped' && status.state !== 'error'
  const supported = isVoiceSessionSupported()

  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-white/45">
        Opens the microphone once and runs a single recognition pass. No wake word, no commands, no speech output,
        and no automatic restarting. This is the baseline: if speech does not appear here, nothing else in the app
        can work either.
      </p>

      {!supported && (
        <p className="rounded-xl border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">
          This browser has no Web Speech API or no microphone access. Use Chrome or Edge over localhost or HTTPS.
        </p>
      )}

      <div>
        <label htmlFor="mic-test-lang" className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">
          Recognition language
        </label>
        <select
          id="mic-test-lang"
          value={language}
          disabled={running}
          onChange={(e) => setLanguage(e.target.value)}
          className="mt-2 w-full rounded-xl border border-white/15 bg-midnight-700 px-4 py-3 text-sm text-white disabled:opacity-50"
        >
          {LANGUAGES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Step 1: is the microphone open and receiving sound at all? */}
      <div className="rounded-2xl border border-white/10 bg-midnight-800 p-4">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${status.micStreamOpen ? 'bg-success' : 'bg-white/25'}`}
              aria-hidden="true"
            />
            <span className="text-white/70">Mic stream {status.micStreamOpen ? 'open' : 'closed'}</span>
          </span>
          <span className="flex items-center gap-2">
            <span
              className={`h-2.5 w-2.5 rounded-full ${
                status.recognitionActive ? 'animate-pulse bg-cyan' : 'bg-white/25'
              }`}
              aria-hidden="true"
            />
            <span className="text-white/70">
              Recognition {status.recognitionActive ? 'listening' : 'idle'}
            </span>
          </span>
          <span className="text-white/40">state: {status.state}</span>
          <span className="text-white/40">restarts: {status.restartCount}</span>
        </div>

        <div className="mt-3 h-3 w-full overflow-hidden rounded-full bg-white/10" aria-hidden="true">
          <div
            className="h-full rounded-full bg-cyan transition-[width] duration-75"
            style={{ width: `${Math.round(level * 100)}%` }}
          />
        </div>
        <p className="mt-1 text-[0.65rem] text-white/35">
          Live level {Math.round(level * 100)}%, highest seen {Math.round(peakSeen * 100)}%.
          {peakSeen < 0.05 && status.micStreamOpen
            ? ' Still flat — speak louder, or check the input device in your operating system.'
            : ''}
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        {!running ? (
          <AccessibleButton onClick={() => void start()} disabled={!supported} fullWidth={false}>
            🎙️ Start microphone test
          </AccessibleButton>
        ) : (
          <>
            <AccessibleButton variant="secondary" onClick={listenAgain} fullWidth={false}>
              Listen again
            </AccessibleButton>
            <AccessibleButton variant="danger" onClick={stop} fullWidth={false}>
              Stop
            </AccessibleButton>
          </>
        )}
      </div>

      {error && (
        <p className="rounded-xl border border-danger/40 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>
      )}

      {/* Step 2 and 3: interim, then final. */}
      <div className="rounded-2xl border border-white/10 bg-midnight-800 p-4">
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">Interim transcript</p>
        <p className="mt-1 min-h-[1.5rem] text-sm italic text-cyan-light">{interim || '—'}</p>

        <p className="mt-4 text-xs font-semibold uppercase tracking-[0.12em] text-white/40">Final transcripts</p>
        {finals.length === 0 ? (
          <p className="mt-1 text-sm text-white/40">
            {running ? 'Speak now. Final results appear here.' : 'Press start, then speak.'}
          </p>
        ) : (
          <ul className="mt-1 flex flex-col gap-1.5">
            {finals.map((entry) => (
              <li key={entry.at} className="text-sm">
                <span className="font-medium text-white">{entry.text}</span>
                <span className="ml-2 text-[0.65rem] text-white/35">
                  {new Date(entry.at).toLocaleTimeString()}
                  {entry.latencyMs !== undefined ? ` · ${entry.latencyMs} ms` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Every state transition, with its reason. */}
      <div className="rounded-2xl border border-white/10 bg-midnight-900/60 p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">Lifecycle log</p>
          <button
            type="button"
            onClick={clearVoiceLog}
            className="min-h-[32px] text-[0.65rem] text-white/40 underline underline-offset-2"
          >
            Clear
          </button>
        </div>
        <ul className="mt-2 max-h-64 overflow-y-auto font-mono text-[0.65rem] leading-relaxed text-white/55">
          {log.length === 0 ? <li className="text-white/30">Nothing logged yet.</li> : null}
          {log.map((line, index) => (
            <li key={`${line}-${index}`}>{line}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
