/**
 * micMonitor — answers the question no part of the app could answer before:
 * "is the microphone actually receiving audio?"
 *
 * This is independent of SpeechRecognition entirely. It opens its own
 * getUserMedia stream and reads raw signal level through a Web Audio
 * AnalyserNode, so it can tell a muted microphone, a wrong input device, or a
 * silent room apart from "the speech engine misheard an accent" — three
 * failure modes that were previously indistinguishable from the outside.
 *
 * SAFE TO RUN ALONGSIDE SpeechRecognition: a second getUserMedia stream to
 * the same physical device does not interfere with the browser's own speech
 * capture; Chrome allows multiple consumers of one input device.
 */

export interface MicLevelSample {
  /** 0..1 RMS level for this frame. */
  level: number
  /** 0..1 peak level for this frame, more responsive to short sounds. */
  peak: number
  at: number
}

export type MicPermissionState = 'granted' | 'denied' | 'prompt' | 'unknown'

let stream: MediaStream | null = null
let audioContext: AudioContext | null = null
let analyser: AnalyserNode | null = null
let rafId: number | null = null
let dataArray: Uint8Array<ArrayBuffer> | null = null
const listeners = new Set<(sample: MicLevelSample) => void>()

export function isMicMonitorSupported(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof (window as unknown as { AudioContext?: unknown }).AudioContext !== 'undefined'
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

/** Human-readable label of the input device currently in use, if known. */
export function getActiveDeviceLabel(): string | null {
  const track = stream?.getAudioTracks()[0]
  return track?.label || null
}

function tick() {
  if (!analyser || !dataArray) return
  analyser.getByteTimeDomainData(dataArray)

  let sumSquares = 0
  let peak = 0
  for (let i = 0; i < dataArray.length; i++) {
    // Byte data centres on 128; normalise to -1..1.
    const value = (dataArray[i] - 128) / 128
    sumSquares += value * value
    peak = Math.max(peak, Math.abs(value))
  }
  const rms = Math.sqrt(sumSquares / dataArray.length)

  const sample: MicLevelSample = { level: Math.min(1, rms * 4), peak: Math.min(1, peak), at: Date.now() }
  listeners.forEach((listener) => listener(sample))

  rafId = requestAnimationFrame(tick)
}

/**
 * Opens the microphone and starts emitting level samples.
 *
 * Returns a stop function. Safe to call multiple times; the second caller
 * shares the already-open stream rather than prompting again.
 */
export async function startMicMonitor(): Promise<{ ok: boolean; error?: string }> {
  if (!isMicMonitorSupported()) return { ok: false, error: 'Audio level metering is not supported in this browser.' }
  if (stream && audioContext) return { ok: true }

  try {
    stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    audioContext = new Ctor()
    const source = audioContext.createMediaStreamSource(stream)
    analyser = audioContext.createAnalyser()
    analyser.fftSize = 512
    dataArray = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount))
    source.connect(analyser)

    rafId = requestAnimationFrame(tick)
    return { ok: true }
  } catch (error) {
    const name = (error as { name?: string })?.name
    const message =
      name === 'NotAllowedError'
        ? 'Microphone permission was denied.'
        : name === 'NotFoundError'
          ? 'No microphone was found.'
          : `Could not open the microphone. ${(error as Error).message}`
    stopMicMonitor()
    return { ok: false, error: message }
  }
}

export function stopMicMonitor(): void {
  if (rafId !== null) {
    cancelAnimationFrame(rafId)
    rafId = null
  }
  if (audioContext) {
    void audioContext.close().catch(() => {})
    audioContext = null
  }
  if (stream) {
    stream.getTracks().forEach((track) => track.stop())
    stream = null
  }
  analyser = null
  dataArray = null
}

export function isMicMonitorRunning(): boolean {
  return !!stream && !!audioContext
}

/** Subscribes to live level samples. Returns an unsubscribe function. */
export function onMicLevel(listener: (sample: MicLevelSample) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * Gives back the raw MediaStream, so a cloud recorder can reuse the same
 * open microphone rather than requesting getUserMedia a second time.
 *
 * Returns null unless the monitor is currently running.
 */
export function getMonitorStream(): MediaStream | null {
  return stream
}
