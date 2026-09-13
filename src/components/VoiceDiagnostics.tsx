import { useEffect, useState } from 'react'
import { AccessibleButton } from './AccessibleButton'
import {
  clearEntries,
  subscribeDiagnostics,
  type ConfidenceBand,
  type DiagnosticEntry,
} from '../services/diagnosticsService'

/**
 * Developer-only view of what the microphone actually heard.
 *
 * This is the tool for debugging accent recognition: it shows each stage's
 * output side by side, so a failure can be attributed to the right layer
 * instead of guessed at. If the raw transcript is wrong, the problem is the
 * speech engine and no amount of parsing will fix it. If the raw transcript is
 * right but the intent is wrong, the problem is in the rules.
 *
 * It is rendered only when Developer Mode and Voice Diagnostics are both on,
 * so it never intrudes on the privacy-first experience. The data is in-memory
 * only and never leaves the device.
 */
const BAND_LABEL: Record<ConfidenceBand, string> = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
  unknown: 'Not reported',
}

const BAND_TONE: Record<ConfidenceBand, string> = {
  high: 'text-success',
  medium: 'text-cyan-light',
  low: 'text-danger',
  unknown: 'text-white/50',
}

function Row({ label, value, tone = 'text-white' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="grid grid-cols-[7.5rem_1fr] gap-2 py-1">
      <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-white/40">{label}</dt>
      <dd className={`break-words text-sm ${tone}`}>{value || '—'}</dd>
    </div>
  )
}

function Entry({ entry }: { entry: DiagnosticEntry }) {
  const time = new Date(entry.at).toLocaleTimeString()

  if (entry.error) {
    return (
      <li className="rounded-2xl border border-danger/40 bg-danger/5 p-4">
        <p className="text-xs text-white/40">{time}</p>
        <p className="mt-1 text-sm text-danger">Recognition error: {entry.error}</p>
        <p className="mt-1 text-xs text-white/40">Language: {entry.language}</p>
      </li>
    )
  }

  return (
    <li className="rounded-2xl border border-white/10 bg-midnight-800 p-4">
      <p className="text-xs text-white/40">{time}</p>
      <dl className="mt-2">
        <Row label="Raw heard" value={entry.rawTranscript} tone="text-white font-medium" />
        <Row label="Language" value={entry.language} />
        <Row
          label="Confidence"
          value={`${BAND_LABEL[entry.confidenceBand]}${entry.confidence > 0 ? ` (${entry.confidence.toFixed(2)})` : ''}`}
          tone={BAND_TONE[entry.confidenceBand]}
        />
        <Row label="Normalized" value={entry.normalized} tone="text-cyan-light" />
        <Row label="Intent" value={entry.intent} tone="text-violet-light font-medium" />
        <Row label="Handled by" value={entry.handledBy === 'ai' ? 'AI intelligence layer' : entry.handledBy} />
        {entry.confirmationRequired && <Row label="Confirmed" value="Asked the user before acting" />}
      </dl>

      {entry.corrections.length > 0 && (
        <div className="mt-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-white/40">Corrections</p>
          <ul className="mt-1 space-y-0.5">
            {entry.corrections.map((correction) => (
              <li key={correction} className="text-xs text-white/70">
                {correction}
              </li>
            ))}
          </ul>
        </div>
      )}

      {entry.alternatives.length > 1 && (
        <div className="mt-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2">
          <p className="text-[0.65rem] font-semibold uppercase tracking-[0.12em] text-white/40">
            Alternatives the engine offered
          </p>
          <ol className="mt-1 space-y-0.5">
            {entry.alternatives.map((alternative, index) => (
              <li
                key={`${alternative.transcript}-${index}`}
                className={`text-xs ${index === entry.chosenIndex ? 'font-semibold text-cyan-light' : 'text-white/55'}`}
              >
                {index + 1}. {alternative.transcript}
                {alternative.confidence > 0 && ` (${alternative.confidence.toFixed(2)})`}
                {index === entry.chosenIndex && ' ← used'}
              </li>
            ))}
          </ol>
        </div>
      )}
    </li>
  )
}

export function VoiceDiagnostics() {
  const [entries, setEntries] = useState<DiagnosticEntry[]>([])

  useEffect(() => subscribeDiagnostics(setEntries), [])

  return (
    <div className="mt-4">
      <p className="text-xs leading-relaxed text-white/45">
        Every recognition turn is recorded here while this is on. Compare &ldquo;raw heard&rdquo; with what you
        actually said: if they differ, the speech engine misheard you and the language profile is the thing to
        change. If they match but the intent is wrong, the command rules need a new alias.
      </p>

      {entries.length === 0 ? (
        <p className="mt-4 rounded-2xl border border-dashed border-white/15 p-4 text-sm text-white/40">
          Nothing recorded yet. Say &ldquo;Hey AwazPay&rdquo; and a command, then come back here.
        </p>
      ) : (
        <>
          <ul className="mt-4 flex flex-col gap-3">
            {entries.map((entry) => (
              <Entry key={entry.id} entry={entry} />
            ))}
          </ul>
          <AccessibleButton className="mt-4" variant="ghost" onClick={clearEntries}>
            Clear diagnostics log
          </AccessibleButton>
        </>
      )}
    </div>
  )
}
