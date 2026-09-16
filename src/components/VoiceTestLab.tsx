import { useEffect, useState } from 'react'
import { AccessibleButton } from './AccessibleButton'
import { normalizeForIntent } from '../services/normalizationService'
import { parseTranscriptSync } from '../services/intentService'
import { getSpeechProvider, listSpeechProviders, type RecognitionOutcome } from '../services/speechProvider'
import type { SpeechProviderId } from '../services/diagnosticsService'
import { subscribeMicLevel } from '../services/voiceSessionController'

/**
 * Developer-only Voice Test Lab.
 *
 * This is the tool for answering one question directly: "which speech
 * provider, and which language, actually understands my accent?" It records
 * one utterance at a time against a chosen provider, and shows raw
 * transcript, normalized transcript, detected intent, confidence and latency
 * side by side, so two providers can be compared on the exact same phrase.
 *
 * It does not touch the live always-on assistant session; it talks to a
 * speech provider directly, one utterance at a time, the same way a
 * transaction flow's slot question does.
 */
const TEST_PHRASES: Array<{ label: string; text: string }> = [
  { label: 'English', text: 'Hello AwazPay' },
  { label: 'English', text: 'Tell me my balance' },
  { label: 'English', text: 'Send five thousand rupees to Ahmed' },
  { label: 'Roman Urdu', text: 'Mera balance batao' },
  { label: 'Roman Urdu', text: 'Ahmed ko paanch hazaar rupay bhejo' },
  { label: 'Roman Urdu', text: 'Mobile load karna hai' },
  { label: 'Roman Urdu', text: 'Mujhe meri transaction history batao' },
  { label: 'Mixed', text: 'Ahmed ko 5000 rupees send karo' },
  { label: 'Mixed', text: 'Mera balance check karo' },
  { label: 'Mixed', text: 'Mobile ka 1000 rupees load kar do' },
]

const LANGUAGE_OPTIONS = [
  { value: 'en-PK', label: 'Pakistani English (en-PK)' },
  { value: 'ur-PK', label: 'Pakistani Urdu (ur-PK)' },
  { value: 'en-IN', label: 'Indian English (en-IN)' },
  { value: 'en-US', label: 'English US (en-US)' },
]

interface TestRun {
  id: string
  provider: SpeechProviderId
  language: string
  expected: string | null
  rawTranscript: string
  normalized: string
  intent: string
  confidence: number
  latencyMs: number | null
  error: string | null
  at: number
}

export function VoiceTestLab() {
  const [provider, setProvider] = useState<SpeechProviderId>('browser')
  const [language, setLanguage] = useState('en-PK')
  const [expectedPhrase, setExpectedPhrase] = useState<string | null>(null)
  const [recording, setRecording] = useState(false)
  const [micLevel, setMicLevel] = useState(0)
  const [runs, setRuns] = useState<TestRun[]>([])

  // Reads the shared session's level. Deliberately does not open a
  // microphone of its own: the controller owns the only stream.
  useEffect(() => subscribeMicLevel(setMicLevel), [])

  async function runTest() {
    setRecording(true)
    const activeProvider = getSpeechProvider(provider)
    const startedAt = Date.now()

    try {
      const outcome: RecognitionOutcome = await activeProvider.listenOnce({ lang: language })
      const normalization = normalizeForIntent(outcome.transcript)
      const parsed = parseTranscriptSync(outcome.transcript)

      setRuns((prev) => [
        {
          id: `run-${Date.now()}`,
          provider,
          language: outcome.language || language,
          expected: expectedPhrase,
          rawTranscript: outcome.transcript,
          normalized: normalization.normalized,
          intent: parsed.intent,
          confidence: outcome.confidence,
          latencyMs: outcome.latencyMs ?? Date.now() - startedAt,
          error: null,
          at: Date.now(),
        },
        ...prev,
      ].slice(0, 20))
    } catch (error) {
      const message = (error as { message?: string })?.message ?? String(error)
      setRuns((prev) =>
        [
          {
            id: `run-${Date.now()}`,
            provider,
            language,
            expected: expectedPhrase,
            rawTranscript: '',
            normalized: '',
            intent: 'none',
            confidence: 0,
            latencyMs: null,
            error: message,
            at: Date.now(),
          },
          ...prev,
        ].slice(0, 20),
      )
    } finally {
      setRecording(false)
    }
  }

  function stopTest() {
    getSpeechProvider(provider).cancelOneShot()
    setRecording(false)
  }

  return (
    <div className="mt-4 flex flex-col gap-4">
      <p className="text-xs leading-relaxed text-white/45">
        Pick a provider and a language, optionally pick a phrase from the list below to say, press
        &ldquo;Record test phrase&rdquo;, and speak. The result compares what came out at every stage. Run the same
        phrase on both providers to see which one actually understands your accent.
      </p>

      <fieldset>
        <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">Provider</legend>
        {listSpeechProviders().map((p) => (
          <label key={p.id} className="mt-2 flex items-center gap-3 text-sm text-white/80">
            <input
              type="radio"
              name="test-lab-provider"
              value={p.id}
              checked={provider === p.id}
              onChange={() => setProvider(p.id)}
              className="h-5 w-5 accent-violet"
            />
            {p.label}
          </label>
        ))}
      </fieldset>

      <div>
        <label htmlFor="test-lab-language" className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">
          Recognition language
        </label>
        <select
          id="test-lab-language"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
          className="mt-2 w-full rounded-xl border border-white/15 bg-midnight-700 px-4 py-3 text-sm text-white"
        >
          {LANGUAGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      <div>
        <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">
          Test phrase (optional — pick one to compare against what you actually said)
        </p>
        <div className="mt-2 flex flex-col gap-1.5">
          <button
            type="button"
            onClick={() => setExpectedPhrase(null)}
            className={`min-h-[36px] rounded-xl border px-3 py-2 text-left text-xs ${
              expectedPhrase === null ? 'border-cyan/60 bg-cyan/10 text-cyan-light' : 'border-white/10 text-white/60'
            }`}
          >
            No expected phrase — freeform
          </button>
          {TEST_PHRASES.map((phrase) => (
            <button
              key={phrase.text}
              type="button"
              onClick={() => setExpectedPhrase(phrase.text)}
              className={`min-h-[36px] rounded-xl border px-3 py-2 text-left text-xs ${
                expectedPhrase === phrase.text
                  ? 'border-cyan/60 bg-cyan/10 text-cyan-light'
                  : 'border-white/10 text-white/60'
              }`}
            >
              <span className="mr-2 rounded bg-white/10 px-1.5 py-0.5 text-[0.6rem] uppercase tracking-wide text-white/40">
                {phrase.label}
              </span>
              {phrase.text}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-white/10 bg-midnight-800 p-4">
        <div className="flex items-center gap-3">
          <span
            className={`h-3 w-3 rounded-full ${recording ? 'animate-pulse bg-danger' : 'bg-white/20'}`}
            aria-hidden="true"
          />
          <span className="text-sm text-white/70">{recording ? 'Recording... speak now' : 'Idle'}</span>
        </div>
        <div className="mt-2 h-2 w-full overflow-hidden rounded-full bg-white/10" aria-hidden="true">
          <div
            className="h-full rounded-full bg-cyan transition-[width] duration-75"
            style={{ width: `${Math.round(micLevel * 100)}%` }}
          />
        </div>
        <p className="mt-1 text-[0.65rem] text-white/35">
          Live microphone level. If this bar never moves while you speak, the problem is the microphone or its
          permission, not recognition accuracy.
        </p>

        <div className="mt-4 flex gap-3">
          <AccessibleButton onClick={() => void runTest()} disabled={recording}>
            {recording ? 'Listening…' : '🎙️ Record test phrase'}
          </AccessibleButton>
          {recording && (
            <AccessibleButton variant="ghost" onClick={stopTest}>
              Stop
            </AccessibleButton>
          )}
        </div>
      </div>

      {runs.length > 0 && (
        <ul className="flex flex-col gap-3">
          {runs.map((run) => (
            <li key={run.id} className="rounded-2xl border border-white/10 bg-midnight-800 p-4 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-white/40">
                <span>{new Date(run.at).toLocaleTimeString()}</span>
                <span className="rounded bg-white/10 px-2 py-0.5">{run.provider}</span>
                <span className="rounded bg-white/10 px-2 py-0.5">{run.language}</span>
                {run.latencyMs !== null && <span className="rounded bg-white/10 px-2 py-0.5">{run.latencyMs} ms</span>}
              </div>

              {run.expected && (
                <p className="mt-2 text-xs text-white/50">
                  Expected: <span className="text-white/80">&ldquo;{run.expected}&rdquo;</span>
                </p>
              )}

              {run.error ? (
                <p className="mt-2 text-sm text-danger">Error: {run.error}</p>
              ) : (
                <div className="mt-2 grid grid-cols-[6.5rem_1fr] gap-x-2 gap-y-1">
                  <span className="text-[0.65rem] uppercase tracking-wide text-white/40">Raw</span>
                  <span className="font-medium text-white">{run.rawTranscript || '—'}</span>
                  <span className="text-[0.65rem] uppercase tracking-wide text-white/40">Normalized</span>
                  <span className="text-cyan-light">{run.normalized || '—'}</span>
                  <span className="text-[0.65rem] uppercase tracking-wide text-white/40">Intent</span>
                  <span className="font-medium text-violet-light">{run.intent}</span>
                  <span className="text-[0.65rem] uppercase tracking-wide text-white/40">Confidence</span>
                  <span className="text-white/70">{run.confidence > 0 ? run.confidence.toFixed(2) : 'not reported'}</span>
                  {run.expected && (
                    <>
                      <span className="text-[0.65rem] uppercase tracking-wide text-white/40">Match</span>
                      <span className={run.rawTranscript.toLowerCase().includes(run.expected.toLowerCase()) ? 'text-success' : 'text-danger'}>
                        {run.rawTranscript.toLowerCase().includes(run.expected.toLowerCase())
                          ? 'Transcript matches what you were asked to say'
                          : 'Transcript differs from the expected phrase'}
                      </span>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
