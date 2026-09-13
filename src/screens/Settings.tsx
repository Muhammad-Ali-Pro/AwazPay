import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AccessibleButton } from '../components/AccessibleButton'
import { Toggle } from '../components/Toggle'
import { useAppDispatch, useAppState } from '../state/store'
import { useAnnouncer } from '../state/announcer'
import { isSpeechRecognitionSupported } from '../services/speechService'
import {
  describeActiveVoice,
  isSpeechSynthesisSupported,
  isUrduVoiceAvailable,
} from '../services/voiceOutputService'
import { STANDARD_TRANSACTION_LIMIT } from '../engines/securityEngine'
import { getIntentProvider } from '../services/intentService'
import { PHRASES } from '../data/voicePhrases'
import { VoiceDiagnostics } from '../components/VoiceDiagnostics'
import { VoiceTestLab } from '../components/VoiceTestLab'
import { MicStatusPanel } from '../components/MicStatusPanel'
import { isDiagnosticsEnabled, setDiagnosticsEnabled } from '../services/diagnosticsService'
import {
  describeExternalConfig,
  getActiveProvider,
  listProviders,
  setActiveProvider,
  setExternalConfig,
} from '../services/aiService'
import {
  describeCloudSpeechConfig,
  getActiveSpeechProviderId,
  getSpeechProvider,
  listSpeechProviders,
  setActiveSpeechProvider,
  setCloudSpeechConfig,
} from '../services/speechProvider'
import { useVoiceAssistantContext } from '../state/assistantContext'

function SectionHeading({ children }: { children: string }) {
  return <h2 className="mt-8 text-xs font-semibold uppercase tracking-[0.2em] text-cyan first:mt-0">{children}</h2>
}

export function Settings() {
  const { settings, devMode } = useAppState()
  const dispatch = useAppDispatch()
  const { announce } = useAnnouncer()
  const [confirmReset, setConfirmReset] = useState(false)
  const [diagnostics, setDiagnostics] = useState(isDiagnosticsEnabled)
  const [aiProvider, setAiProvider] = useState(() => getActiveProvider().id)
  const [aiEndpoint, setAiEndpoint] = useState('https://api.openai.com/v1/chat/completions')
  const [aiModel, setAiModel] = useState('gpt-4o-mini')
  const [aiKey, setAiKey] = useState('')
  const [aiStatus, setAiStatus] = useState<string | null>(null)
  const [aiTesting, setAiTesting] = useState(false)
  const [testLabEnabled, setTestLabEnabled] = useState(false)
  const [speechProviderId, setSpeechProviderId] = useState(getActiveSpeechProviderId)
  const [cloudEndpoint, setCloudEndpoint] = useState('https://api.openai.com/v1/audio/transcriptions')
  const [cloudModel, setCloudModel] = useState('whisper-1')
  const [cloudApiKey, setCloudApiKey] = useState('')
  const [cloudLanguageHint, setCloudLanguageHint] = useState('ur')
  const [speechStatus, setSpeechStatus] = useState<string | null>(null)
  const [speechTesting, setSpeechTesting] = useState(false)
  const assistant = useVoiceAssistantContext()

  function toggleDiagnostics(enabled: boolean) {
    setDiagnostics(enabled)
    setDiagnosticsEnabled(enabled)
  }

  function applyAiProvider(id: string) {
    setAiProvider(id)
    setActiveProvider(id)
    setAiStatus(null)
    if (id === 'local') setExternalConfig(null)
  }

  async function testAiConnection() {
    setAiTesting(true)
    setAiStatus(null)
    if (aiProvider === 'external') {
      setExternalConfig({ endpoint: aiEndpoint.trim(), model: aiModel.trim(), apiKey: aiKey.trim() })
    }
    const result = await getActiveProvider().checkConnection()
    setAiStatus(`${result.ok ? 'Connected. ' : 'Failed. '}${result.detail}`)
    setAiTesting(false)
  }

  function applySpeechProvider(id: 'browser' | 'cloud') {
    setSpeechProviderId(id)
    setActiveSpeechProvider(id)
    setSpeechStatus(null)
    if (id === 'browser') setCloudSpeechConfig(null)
    // Take effect immediately on the live always-on session, not just on the
    // next transaction flow's slot question.
    assistant.switchSpeechProvider()
  }

  async function testSpeechConnection() {
    setSpeechTesting(true)
    setSpeechStatus(null)
    if (speechProviderId === 'cloud') {
      setCloudSpeechConfig({
        endpoint: cloudEndpoint.trim(),
        model: cloudModel.trim(),
        apiKey: cloudApiKey.trim(),
        languageHint: cloudLanguageHint.trim() || undefined,
      })
    }
    const result = await getSpeechProvider(speechProviderId).checkConnection()
    setSpeechStatus(`${result.ok ? 'Ready. ' : 'Not ready. '}${result.detail}`)
    setSpeechTesting(false)
  }

  function update(patch: Partial<typeof settings>) {
    dispatch({ type: 'UPDATE_SETTINGS', settings: patch })
  }

  function resetDemo() {
    dispatch({ type: 'RESET_DEMO' })
    setConfirmReset(false)
    announce('Demo data has been reset. Your balance, transaction history and Trusted Circle are back to their starting values.')
  }

  const sttSupported = isSpeechRecognitionSupported()
  const ttsSupported = isSpeechSynthesisSupported()
  const urduVoice = isUrduVoiceAvailable()
  const activeVoice = describeActiveVoice(settings.voiceLanguage)

  return (
    <div className="text-white">
      <h1 className="text-2xl font-bold">Settings</h1>

      <SectionHeading>Voice</SectionHeading>
      <div className="rounded-2xl border border-white/10 bg-midnight-800 p-4">
        <label htmlFor="voice-speed" className="text-sm text-white/70">
          Voice speed ({settings.voiceSpeed.toFixed(1)}x)
        </label>
        <input
          id="voice-speed"
          type="range"
          min={0.6}
          max={1.6}
          step={0.1}
          value={settings.voiceSpeed}
          onChange={(e) => update({ voiceSpeed: Number(e.target.value) })}
          className="mt-2 w-full accent-violet"
        />

        <label htmlFor="voice-language" className="mt-4 block text-sm text-white/70">
          Voice language
        </label>
        <select
          id="voice-language"
          value={settings.voiceLanguage}
          onChange={(e) => update({ voiceLanguage: e.target.value })}
          className="mt-2 w-full rounded-xl border border-white/15 bg-midnight-700 px-4 py-3 text-white"
        >
          <option value="auto">Auto / Mixed — Urdu + English (recommended)</option>
          <option value="ur-PK">پاکستانی اردو — Pakistani Urdu</option>
          <option value="en-PK">Pakistani English</option>
          <option value="en-US">English (US)</option>
        </select>
        <p className="mt-2 text-xs leading-relaxed text-white/45">
          {settings.voiceLanguage === 'auto'
            ? 'Recognition runs in Pakistani English, which transcribes Roman Urdu and mixed sentences most reliably. AwazPay still replies in Roman Urdu and understands Urdu script.'
            : settings.voiceLanguage === 'ur-PK'
              ? 'Best for speaking pure Urdu. Mixed Urdu-English sentences are often recognised better on the Auto / Mixed profile.'
              : 'Recognition and replies both in English.'}
        </p>
        {settings.voiceLanguage === 'ur-PK' && !urduVoice && (
          <p className="mt-2 rounded-xl border border-white/15 bg-white/5 px-3 py-2 text-xs leading-relaxed text-white/55">
            No Urdu voice is installed on this device, so AwazPay speaks Roman Urdu through the available voice.
            Commands in Urdu, Roman Urdu and English are all still understood.
          </p>
        )}

        <AccessibleButton className="mt-4" variant="secondary" onClick={() => announce(PHRASES.ready)}>
          🔊 Test Voice Output
        </AccessibleButton>

        <dl className="mt-4 space-y-1 text-xs text-white/45">
          <div className="flex justify-between gap-4">
            <dt>Speech recognition</dt>
            <dd>{sttSupported ? 'Available' : 'Not supported in this browser'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Speech output</dt>
            <dd>{ttsSupported ? 'Available' : 'Not supported in this browser'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Urdu voice installed</dt>
            <dd>{urduVoice ? 'Yes' : 'No, speaking Roman Urdu'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Active voice</dt>
            <dd className="text-right">{activeVoice}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Understanding engine</dt>
            <dd>{getIntentProvider().name}</dd>
          </div>
        </dl>
      </div>

      <SectionHeading>Privacy</SectionHeading>
      <div className="rounded-2xl border border-white/10 bg-midnight-800 p-4">
        <Toggle
          id="private-audio"
          label="Private Audio Mode"
          description="Prefer earphone delivery for sensitive information."
          checked={settings.privateAudioMode}
          onChange={(checked) => update({ privateAudioMode: checked })}
        />
        <Toggle
          id="hide-sensitive"
          label="Hide sensitive screen information"
          description="Keep balances, amounts and history off-screen. Recommended."
          checked={settings.hideSensitiveOnScreen}
          onChange={(checked) => update({ hideSensitiveOnScreen: checked })}
        />
      </div>

      <SectionHeading>Accessibility</SectionHeading>
      <div className="rounded-2xl border border-white/10 bg-midnight-800 p-4">
        <Toggle
          id="vibration"
          label="Vibration feedback"
          checked={settings.vibrationEnabled}
          onChange={(checked) => update({ vibrationEnabled: checked })}
        />
        <Toggle
          id="high-contrast"
          label="High contrast mode"
          checked={settings.highContrast}
          onChange={(checked) => update({ highContrast: checked })}
        />
        <Toggle
          id="large-controls"
          label="Large touch controls"
          checked={settings.largeControls}
          onChange={(checked) => update({ largeControls: checked })}
        />
      </div>

      <SectionHeading>Security</SectionHeading>
      <div className="rounded-2xl border border-white/10 bg-midnight-800 p-4">
        <Link
          to="/trusted-circle"
          className="inline-block min-h-[44px] py-2 font-medium text-violet-light underline underline-offset-4"
        >
          Manage Trusted Circle
        </Link>
        <label htmlFor="tx-limit" className="mt-4 block text-sm text-white/70">
          Standard transaction limit (PKR)
        </label>
        <input
          id="tx-limit"
          type="number"
          min={0}
          step={500}
          value={settings.transactionLimit}
          onChange={(e) => update({ transactionLimit: Number(e.target.value) })}
          className="mt-2 w-full rounded-xl border border-white/15 bg-midnight-700 px-4 py-3 text-white"
        />
        <p className="mt-2 text-xs text-white/40">
          Transactions above this amount need Simulated Trusted Circle Authorization. The AwazPay default is PKR{' '}
          {STANDARD_TRANSACTION_LIMIT.toLocaleString('en-US')}.
        </p>
      </div>

      <SectionHeading>Demo Data</SectionHeading>
      <div className="rounded-2xl border border-white/10 bg-midnight-800 p-4">
        <p className="text-sm text-white/60">
          Restores the starting balance, transaction history and Trusted Circle so you can run the demo again.
        </p>
        {confirmReset ? (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-sm font-medium text-danger">
              This clears all simulated transactions you have made. Continue?
            </p>
            <AccessibleButton variant="danger" onClick={resetDemo}>
              Yes, reset demo data
            </AccessibleButton>
            <AccessibleButton variant="ghost" onClick={() => setConfirmReset(false)}>
              Keep my demo data
            </AccessibleButton>
          </div>
        ) : (
          <AccessibleButton className="mt-4" variant="secondary" onClick={() => setConfirmReset(true)}>
            Reset Demo Data
          </AccessibleButton>
        )}
      </div>

      {/* Developer and demo tooling. Hidden from the normal privacy-first
          experience: a visually impaired user should never be asked to
          configure an API. Unlock by tapping the AwazPay logo five times. */}
      {devMode && (
        <>
          <SectionHeading>Developer / Demo Mode</SectionHeading>
          <p className="rounded-2xl border border-dashed border-white/20 p-4 text-xs leading-relaxed text-white/50">
            Developer mode is on. Toggle it by tapping the AwazPay logo five times. Everything in this section is
            for hackathon testing and is not part of the user-facing product.
          </p>

          <div className="mt-4 rounded-2xl border border-white/10 bg-midnight-800 p-4">
            <h3 className="text-sm font-semibold text-white">Voice Diagnostics</h3>
            <p className="mt-1 text-xs leading-relaxed text-white/50">
              Answers the diagnostic questions directly: is the mic on, is it hearing anything, what language and
              provider is active, and how many times has the session had to restart itself.
            </p>
            <Toggle
              id="voice-diagnostics"
              label="Record what the microphone hears"
              description="Shows raw transcript, language, confidence, corrections and detected intent."
              checked={diagnostics}
              onChange={toggleDiagnostics}
            />
            {diagnostics && (
              <>
                <MicStatusPanel />
                <VoiceDiagnostics />
              </>
            )}
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-midnight-800 p-4">
            <h3 className="text-sm font-semibold text-white">Speech Provider</h3>
            <p className="mt-1 text-xs leading-relaxed text-white/50">
              Which engine transcribes your voice. This changes only how speech becomes text — the same
              normalisation, intent engine, security engine and transaction flow run afterward no matter which
              provider is active, and amounts are never guessed by either.
            </p>

            <fieldset className="mt-4">
              <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">
                Speech-to-Text engine
              </legend>
              {listSpeechProviders().map((p) => (
                <label key={p.id} className="mt-2 flex items-center gap-3 text-sm text-white/80">
                  <input
                    type="radio"
                    name="speech-provider"
                    value={p.id}
                    checked={speechProviderId === p.id}
                    onChange={() => applySpeechProvider(p.id)}
                    className="h-5 w-5 accent-violet"
                  />
                  {p.label}
                </label>
              ))}
            </fieldset>

            {speechProviderId === 'cloud' && (
              <div className="mt-4 flex flex-col gap-2">
                <p className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-xs leading-relaxed text-white/60">
                  Demo and developer use only. Records real audio and sends it to this endpoint. Without a proxy URL
                  configured at build time (VITE_CLOUD_STT_PROXY_URL), the key below is held in memory for this tab
                  only, never saved to storage, never committed, and is sent directly from the browser — the shape a
                  production build must avoid. See README.md for the proxy setup.
                </p>
                <label htmlFor="stt-endpoint" className="text-xs text-white/60">
                  Endpoint (Whisper-compatible /audio/transcriptions)
                </label>
                <input
                  id="stt-endpoint"
                  value={cloudEndpoint}
                  onChange={(e) => setCloudEndpoint(e.target.value)}
                  className="rounded-xl border border-white/15 bg-midnight-700 px-4 py-3 text-sm text-white"
                />
                <label htmlFor="stt-model" className="text-xs text-white/60">
                  Model
                </label>
                <input
                  id="stt-model"
                  value={cloudModel}
                  onChange={(e) => setCloudModel(e.target.value)}
                  className="rounded-xl border border-white/15 bg-midnight-700 px-4 py-3 text-sm text-white"
                />
                <label htmlFor="stt-lang" className="text-xs text-white/60">
                  Language hint (ISO-639-1, optional — e.g. "ur" or "en")
                </label>
                <input
                  id="stt-lang"
                  value={cloudLanguageHint}
                  onChange={(e) => setCloudLanguageHint(e.target.value)}
                  className="rounded-xl border border-white/15 bg-midnight-700 px-4 py-3 text-sm text-white"
                />
                <label htmlFor="stt-key" className="text-xs text-white/60">
                  API key (this browser tab only, unless a proxy is configured)
                </label>
                <input
                  id="stt-key"
                  type="password"
                  value={cloudApiKey}
                  autoComplete="off"
                  onChange={(e) => setCloudApiKey(e.target.value)}
                  className="rounded-xl border border-white/15 bg-midnight-700 px-4 py-3 text-sm text-white"
                />
              </div>
            )}

            <AccessibleButton
              className="mt-4"
              variant="secondary"
              onClick={() => void testSpeechConnection()}
              disabled={speechTesting}
            >
              {speechTesting ? 'Checking...' : 'Test Connection'}
            </AccessibleButton>
            {speechStatus && <p className="mt-2 text-xs leading-relaxed text-white/60">{speechStatus}</p>}
            {describeCloudSpeechConfig() && (
              <p className="mt-2 text-xs text-white/40">
                Session config: {describeCloudSpeechConfig()?.model} at {describeCloudSpeechConfig()?.endpoint}
              </p>
            )}
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-midnight-800 p-4">
            <h3 className="text-sm font-semibold text-white">Voice Test Lab</h3>
            <p className="mt-1 text-xs leading-relaxed text-white/50">
              Record a specific test phrase against a chosen provider and language, and see raw transcript,
              normalized transcript, detected intent, confidence and latency together. Run the same phrase on Browser
              and Cloud to see which one actually understands your accent.
            </p>
            <Toggle
              id="voice-test-lab"
              label="Enable Voice Test Lab"
              description="Opens the microphone only when you press record."
              checked={testLabEnabled}
              onChange={setTestLabEnabled}
            />
            {testLabEnabled && <VoiceTestLab />}
          </div>

          <div className="mt-4 rounded-2xl border border-white/10 bg-midnight-800 p-4">
            <h3 className="text-sm font-semibold text-white">AI Intelligence</h3>
            <p className="mt-1 text-xs leading-relaxed text-white/50">
              Used only for greetings, small talk and requests the deterministic engine does not recognise. It can
              never execute a transaction, change a balance, or bypass the verification challenge, the PKR limit or
              Trusted Circle.
            </p>

            <fieldset className="mt-4">
              <legend className="text-xs font-semibold uppercase tracking-[0.12em] text-white/40">AI Mode</legend>
              {listProviders().map((provider) => (
                <label key={provider.id} className="mt-2 flex items-center gap-3 text-sm text-white/80">
                  <input
                    type="radio"
                    name="ai-provider"
                    value={provider.id}
                    checked={aiProvider === provider.id}
                    onChange={() => applyAiProvider(provider.id)}
                    className="h-5 w-5 accent-violet"
                  />
                  {provider.label}
                </label>
              ))}
            </fieldset>

            {aiProvider === 'external' && (
              <div className="mt-4 flex flex-col gap-2">
                <label htmlFor="ai-endpoint" className="text-xs text-white/60">
                  Endpoint (OpenAI-compatible chat completions)
                </label>
                <input
                  id="ai-endpoint"
                  value={aiEndpoint}
                  onChange={(e) => setAiEndpoint(e.target.value)}
                  className="rounded-xl border border-white/15 bg-midnight-700 px-4 py-3 text-sm text-white"
                />
                <label htmlFor="ai-model" className="text-xs text-white/60">
                  Model
                </label>
                <input
                  id="ai-model"
                  value={aiModel}
                  onChange={(e) => setAiModel(e.target.value)}
                  className="rounded-xl border border-white/15 bg-midnight-700 px-4 py-3 text-sm text-white"
                />
                <label htmlFor="ai-key" className="text-xs text-white/60">
                  API key (this browser tab only)
                </label>
                <input
                  id="ai-key"
                  type="password"
                  value={aiKey}
                  autoComplete="off"
                  onChange={(e) => setAiKey(e.target.value)}
                  className="rounded-xl border border-white/15 bg-midnight-700 px-4 py-3 text-sm text-white"
                />
                <p className="rounded-xl border border-danger/30 bg-danger/5 px-3 py-2 text-xs leading-relaxed text-white/60">
                  Demo and developer use only. The key is held in memory for this tab, never saved to storage and
                  never committed. A production build must call the model from a backend that holds the credential,
                  not from the browser.
                </p>
              </div>
            )}

            <AccessibleButton className="mt-4" variant="secondary" onClick={() => void testAiConnection()} disabled={aiTesting}>
              {aiTesting ? 'Testing...' : 'Test Connection'}
            </AccessibleButton>
            {aiStatus && <p className="mt-2 text-xs leading-relaxed text-white/60">{aiStatus}</p>}
            {describeExternalConfig() && (
              <p className="mt-2 text-xs text-white/40">
                Session config: {describeExternalConfig()?.model} at {describeExternalConfig()?.endpoint}
              </p>
            )}
          </div>
        </>
      )}

      <p className="mt-10 text-center text-xs leading-relaxed text-white/30">
        AwazPay is a hackathon prototype. All balances and transactions are simulated. There is no bank
        integration, no real money transfer and no SMS one-time password. The verification here is a demonstration
        of a security design, not bank-grade or biometric authentication.
      </p>
    </div>
  )
}
