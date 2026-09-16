/**
 * micMonitor — audio level readings for the diagnostics UI.
 *
 * THIS NO LONGER OPENS A MICROPHONE. It used to call `getUserMedia` itself,
 * which meant the level meter competed with speech recognition for the
 * device: two streams, two acquisitions, and a recording indicator that
 * flickered as they fought. That was one of the causes of the microphone
 * opening and closing every few seconds.
 *
 * Now it is a thin read-only view over `voiceSessionController`, which owns
 * the single shared stream and does the metering. This module exists only so
 * existing callers keep a stable import path.
 */
import { subscribeMicLevel, voiceSession } from './voiceSessionController'

export interface MicLevelSample {
  /** 0..1 RMS level for this frame. */
  level: number
  /** Kept for API compatibility; mirrors `level`. */
  peak: number
  at: number
}

export type MicPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown'

export function isMicMonitorSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof (globalThis as { AudioContext?: unknown }).AudioContext !== 'undefined'
  )
}

export async function getMicPermissionState(): Promise<MicPermissionState> {
  if (typeof navigator === 'undefined' || !navigator.permissions?.query) return 'unknown'
  try {
    const status = await navigator.permissions.query({ name: 'microphone' as PermissionName })
    return status.state as MicPermissionState
  } catch {
    return 'unknown'
  }
}

/** Human-readable label of the input device the shared session is using. */
export function getActiveDeviceLabel(): string | null {
  return voiceSession.getStatus().deviceLabel
}

export function isMicMonitorRunning(): boolean {
  return voiceSession.getStatus().micStreamOpen
}

/**
 * Subscribes to live level samples from the shared session stream.
 *
 * Emits nothing when no voice session is running, which is correct: there is
 * no microphone open to measure, and opening one here is exactly the bug
 * this module was refactored to remove.
 */
export function onMicLevel(listener: (sample: MicLevelSample) => void): () => void {
  return subscribeMicLevel((level) => listener({ level, peak: level, at: Date.now() }))
}

/** The shared stream, owned by the controller. Never opened here. */
export function getMonitorStream(): MediaStream | null {
  return voiceSession.getStream()
}
