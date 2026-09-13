import type { VoiceSessionState } from '../types/voice'

interface VoiceStatusPanelProps {
  sessionState: VoiceSessionState
  statusText: string
  transcript: string
  micOpen: boolean
}

/**
 * Status readout under the orb.
 *
 * State is communicated three ways at once, never by colour alone: a text
 * label, a distinct icon, and a shape change in the indicator dot. That keeps
 * the state legible to a colour-blind user and to a sighted helper watching
 * over the shoulder of a blind one.
 */
const STATE_MARK: Record<VoiceSessionState, { icon: string; tone: string; dot: string }> = {
  off: { icon: '🔇', tone: 'text-white/50', dot: 'bg-white/30' },
  ready: { icon: '🟢', tone: 'text-cyan-light', dot: 'bg-cyan' },
  listening: { icon: '🎙️', tone: 'text-cyan-light', dot: 'bg-cyan animate-pulse' },
  processing: { icon: '⚙️', tone: 'text-violet-light', dot: 'bg-violet-light animate-pulse' },
  speaking: { icon: '🎧', tone: 'text-violet-light', dot: 'bg-violet-light' },
  awaiting_confirmation: { icon: '🔒', tone: 'text-cyan-light', dot: 'bg-cyan' },
  transaction: { icon: '🔒', tone: 'text-cyan-light', dot: 'bg-cyan' },
  success: { icon: '✓', tone: 'text-success', dot: 'bg-success' },
  error: { icon: '⚠️', tone: 'text-danger', dot: 'bg-danger' },
}

export function VoiceStatusPanel({ sessionState, statusText, transcript, micOpen }: VoiceStatusPanelProps) {
  const mark = STATE_MARK[sessionState]

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-3">
      <p
        className={`flex items-center gap-2.5 text-xl font-semibold ${mark.tone}`}
        role="status"
        aria-live="polite"
      >
        <span aria-hidden="true" className="text-base">
          {mark.icon}
        </span>
        {statusText}
      </p>

      <p className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-white/40">
        <span className={`h-2 w-2 rounded-full ${mark.dot}`} aria-hidden="true" />
        {micOpen ? 'Microphone open' : 'Microphone closed'}
      </p>

      {transcript && (
        <p
          className="max-w-xs rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm italic text-white/70"
          aria-hidden="true"
        >
          &ldquo;{transcript}&rdquo;
        </p>
      )}
    </div>
  )
}
