import { useAppState } from '../state/store'

export function PrivacyBadge() {
  const { settings } = useAppState()

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70">
      <span aria-hidden="true">{settings.privateAudioMode ? '🔒🎧' : '🔒'}</span>
      <span>{settings.privateAudioMode ? 'Private Audio Mode Active' : 'Private Financial Session'}</span>
    </div>
  )
}
