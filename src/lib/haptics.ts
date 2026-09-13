export type HapticPattern = 'tap' | 'detect' | 'success' | 'error'

const PATTERNS: Record<HapticPattern, number | number[]> = {
  tap: 15,
  detect: [40, 60, 40],
  success: [30, 40, 30, 40, 80],
  error: [80, 50, 80],
}

export function vibrate(pattern: HapticPattern, enabled: boolean): void {
  if (!enabled) return
  if (typeof navigator === 'undefined' || !navigator.vibrate) return
  navigator.vibrate(PATTERNS[pattern])
}
