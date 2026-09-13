import { useEffect, useState } from 'react'
import { getMicStatus, subscribeMicStatus, type MicStatus } from '../services/diagnosticsService'
import { getMicPermissionState, onMicLevel, startMicMonitor, stopMicMonitor } from '../services/micMonitor'

/**
 * Answers, at a glance, the questions that used to require guessing:
 * is the microphone on, is it actually receiving sound, what provider and
 * language is it using, and how many times has the session had to restart
 * itself. This is the first thing to check before blaming an accent.
 */
export function MicStatusPanel() {
  const [status, setStatus] = useState<MicStatus>(getMicStatus)
  const [level, setLevel] = useState(0)

  useEffect(() => subscribeMicStatus(setStatus), [])

  useEffect(() => {
    let cancelled = false
    void startMicMonitor()
    void getMicPermissionState().then((permission) => {
      if (!cancelled) setStatus((prev) => ({ ...prev, permission }))
    })
    const unsubscribe = onMicLevel((sample) => setLevel(sample.level))
    return () => {
      cancelled = true
      unsubscribe()
      stopMicMonitor()
    }
  }, [])

  const permissionTone =
    status.permission === 'granted' ? 'text-success' : status.permission === 'denied' ? 'text-danger' : 'text-white/60'

  return (
    <div className="rounded-2xl border border-white/10 bg-midnight-900/60 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">Live microphone status</p>
      <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
        <dt className="text-white/40">Permission</dt>
        <dd className={permissionTone}>{status.permission}</dd>
        <dt className="text-white/40">Recording</dt>
        <dd className={status.isCapturing ? 'text-success' : 'text-white/60'}>{status.isCapturing ? 'Yes' : 'No'}</dd>
        <dt className="text-white/40">Provider</dt>
        <dd className="text-white">{status.provider}</dd>
        <dt className="text-white/40">Language</dt>
        <dd className="text-white">{status.language || '—'}</dd>
        <dt className="text-white/40">Session restarts</dt>
        <dd className="text-white">{status.restartCount}</dd>
      </dl>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-white/10" aria-hidden="true">
        <div className="h-full rounded-full bg-cyan transition-[width] duration-75" style={{ width: `${Math.round(level * 100)}%` }} />
      </div>
      <p className="mt-1 text-[0.65rem] leading-relaxed text-white/35">
        This level bar reads the microphone directly, independent of speech recognition. If it stays flat while you
        speak, the fault is the microphone or its permission, not the accuracy of the transcription.
      </p>
    </div>
  )
}
