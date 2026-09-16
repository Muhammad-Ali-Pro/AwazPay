import { useEffect, useState } from 'react'
import { getMicPermissionState, type MicPermissionState } from '../services/micMonitor'
import {
  subscribeMicLevel,
  subscribeVoiceStatus,
  voiceSession,
  type ControllerStatus,
} from '../services/voiceSessionController'

/**
 * Live view of the one shared microphone session.
 *
 * Reads the controller's status rather than opening a microphone of its own;
 * mounting this panel no longer costs a second `getUserMedia` stream, which
 * is what used to make the recording indicator flicker while diagnostics
 * were open.
 */
export function MicStatusPanel() {
  const [status, setStatus] = useState<ControllerStatus>(() => voiceSession.getStatus())
  const [level, setLevel] = useState(0)
  const [permission, setPermission] = useState<MicPermissionState>('unknown')

  useEffect(() => subscribeVoiceStatus(setStatus), [])
  useEffect(() => subscribeMicLevel(setLevel), [])

  useEffect(() => {
    let cancelled = false
    void getMicPermissionState().then((next) => {
      if (!cancelled) setPermission(next)
    })
    return () => {
      cancelled = true
    }
  }, [status.micStreamOpen])

  const permissionTone =
    permission === 'granted' ? 'text-success' : permission === 'denied' ? 'text-danger' : 'text-white/60'

  return (
    <div className="rounded-2xl border border-white/10 bg-midnight-900/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">Live microphone status</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-white/40">Session state</dt>
        <dd className="font-medium text-white">{status.state}</dd>
        <dt className="text-white/40">Permission</dt>
        <dd className={permissionTone}>{permission}</dd>
        <dt className="text-white/40">Mic stream open</dt>
        <dd className={status.micStreamOpen ? 'text-success' : 'text-white/60'}>
          {status.micStreamOpen ? 'Yes (held open)' : 'No'}
        </dd>
        <dt className="text-white/40">Recognition active</dt>
        <dd className={status.recognitionActive ? 'text-success' : 'text-white/60'}>
          {status.recognitionActive ? 'Yes' : 'No'}
        </dd>
        <dt className="text-white/40">Language</dt>
        <dd className="text-white">{status.language || '—'}</dd>
        <dt className="text-white/40">Auto-restart</dt>
        <dd className="text-white">{status.autoRestart ? 'On' : 'Off'}</dd>
        <dt className="text-white/40">Recognition restarts</dt>
        <dd className="text-white">{status.restartCount}</dd>
        <dt className="text-white/40">Device</dt>
        <dd className="truncate text-white/70">{status.deviceLabel || '—'}</dd>
      </dl>

      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <div
          className="h-full rounded-full bg-cyan transition-[width] duration-75"
          style={{ width: `${Math.round(level * 100)}%` }}
        />
      </div>
      <p className="mt-1 text-[0.65rem] leading-relaxed text-white/35">
        The level bar reads the same shared stream the recogniser uses. If it stays flat while you speak, the fault
        is the microphone or its permission, not the accuracy of the transcription.
      </p>
      {status.lastError && <p className="mt-2 text-xs text-danger">{status.lastError}</p>}
    </div>
  )
}
