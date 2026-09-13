# AwazPay

**Banking Beyond Sight.** A voice-first, privacy-first payment accessibility prototype for blind and
visually impaired users.

> **The screen is quiet. The voice is the interface.**
> Speak → Listen → Verify → Confirm

---

## ⚠️ This is a prototype

AwazPay is a hackathon MVP. It is **not** connected to any financial system.

- No bank integration, no banking API, no bank verification call
- No real money transfer
- No real SMS or one-time password
- No real biometric voice authentication
- **NFC is simulated in the web MVP. Production implementation would require native mobile NFC
  capabilities and bank/payment network integration.**

Every balance, payment, top-up and deposit is simulated against demo data held in your browser's
`localStorage`. Nothing leaves the device.

---

## Running it

```bash
npm install
npm run dev          # http://localhost:5173
```

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server with hot reload |
| `npm run build` | Type-check, then build to `dist/` |
| `npm run preview` | Serve the production build |
| `npm run typecheck` | TypeScript only |
| `npm run verify` | Offline logic and render checks |

### Browser requirements

| Feature | Requirement |
| --- | --- |
| Browser Speech Recognition | Chrome or Edge on desktop, Chrome on Android. Safari is partial. Firefox has none. |
| Cloud Speech-to-Text | Any modern browser with `MediaRecorder` and `getUserMedia` — Chrome, Edge, Firefox, Safari all qualify. Needs a configured endpoint; see Speech Provider above. |
| Speech synthesis | All modern browsers |
| Urdu recognition (`ur-PK`) | Chrome only, quality varies by device |
| Urdu synthesis voice | Rarely installed. AwazPay falls back to Roman Urdu automatically. |
| Microphone | Permission granted once, at the Enable Voice Mode step |
| Mic level metering (Voice Test Lab / Mic Status) | Needs `AudioContext`, present in every modern browser |
| Secure context | `localhost` or HTTPS. Both speech providers are blocked on plain HTTP. |
| Vibration | Android Chrome only; silently skipped elsewhere |

**Where speech is unavailable, every action still works by touch.** The app detects this and says so
rather than failing silently.

Headphones are recommended, since private financial information is delivered as audio.

---

## How the voice session works

```
Open AwazPay
   ↓
Spoken welcome, then one-time "Enable Voice Mode" (browsers require one gesture)
   ↓
Microphone stays open across every screen
   ↓
Say "Hey AwazPay"      →  "Ji, main sun raha hoon."
   ↓
Say your command       →  or say both in one breath
   ↓
AwazPay acts, responds privately, and resumes listening
```

**There is no "tap to speak" button.** After the one-time permission, the microphone stays open and
the orb is the assistant's presence on screen, not a control the user has to find.

**Honest description of "continuous":** browsers have no background hotword engine. AwazPay keeps a
recognition session alive and restarts it whenever the browser ends it, then matches the wake phrase
in software. It requires the tab to be open and that one initial gesture. Three safeguards keep it
usable: the microphone closes while AwazPay speaks so it never answers its own voice, restarts are
rate-limited so a failing microphone reports a problem instead of spinning, and the session releases
the microphone when the tab is hidden.

---

## Demo commands

Say "Hey AwazPay" first, or fold it into the sentence. Both work.

| Say | Result |
| --- | --- |
| Hey AwazPay mera balance batao | Balance spoken, never shown |
| AwazPay Ahmed ko 5000 rupay bhejo | Standard payment, verification challenge |
| AwazPay Ahmed ko 30000 rupay bhejo | Above the limit, Trusted Circle authorization |
| AwazPay 1000 ka mobile load karo | Mobile top-up |
| AwazPay cash deposit karna hai | Cash deposit assistance |
| AwazPay NFC payment | Simulated contactless payment |
| Transaction history batao | Recent activity, spoken |
| Settings kholo / Trusted Circle kholo / Home kholo | Voice navigation |
| Wapas jao | Go back |
| Tasdeeq / Confirm | Confirm a pending transaction |
| Cancel karo / منسوخ کرو | Cancel at any point |
| Madad / Help | List of commands |

Urdu script works too: میرا بیلنس بتاؤ, احمد کو 5000 روپے بھیجو, موبائل لوڈ کرنا ہے, کیش ڈپازٹ کرنا ہے.

The demo secret word is **falcon**. Verification asks for that word plus a random number, for
example "falcon forty-seven". **Settings → Demo Data → Reset Demo Data** restores the starting state.

---

## Manual test plan

Use Chrome, on `localhost` or HTTPS, with headphones.

**Test 1 — Enable microphone permission**
Open the app. You should hear a spoken welcome. Step through onboarding to **Enable Voice Mode** and
allow the microphone. AwazPay says voice mode is active. On Home the status reads *AwazPay is ready*
and the indicator shows *Microphone open*. Reload the page: it should resume listening with no
button press.

**Test 2 — "Hey AwazPay mera balance batao"**
Balance is spoken. Nothing numeric appears on screen; the balance screen shows the privacy curtain.
Also try the two-step form: say just "Hey AwazPay", hear "Ji, main sun raha hoon", then say the
command.

**Test 3 — "AwazPay Ahmed ko 5000 rupay bhejo"**
Details spoken privately, then a challenge such as "say your secret word followed by 62". Reply
"falcon sixty two". Then say "confirm". Payment completes and the receipt is spoken. Run it a second
time and confirm the challenge number is different.

**Test 4 — "AwazPay Ahmed ko 30000 rupay bhejo"**
After verification, the Trusted Circle screen appears labelled *Simulated Trusted Circle
Authorization*. Approval arrives after a few seconds, then confirm as before. Removing every contact
in Trusted Circle first should make the same command decline with a spoken explanation.

**Test 5 — "AwazPay 1000 ka mobile load karo"**
Top-up runs the same challenge and confirmation path.

**Test 6 — "AwazPay cash deposit karna hai"**
You hear the trusted-person guidance first. Say the amount, then confirm. Deposit is confirmed by
voice and credits the demo balance.

**Test 7 — "AwazPay NFC payment"**
The NFC screen animates phone, waves and terminal, announces "Apna phone payment terminal ke qareeb
le jayein", then "Payment terminal detect ho gaya hai", and hands the amount to the same secured
payment flow.

**Test 8 — Your own accent, with diagnostics**
Tap the AwazPay logo five times, open **Settings → Developer / Demo Mode**, switch on **Voice
Diagnostics**, then run tests 2 to 7 again and read the log after each one. Watch the **Mic Status**
panel first: permission should read granted, recording should flip to yes while you speak, and the
level bar should visibly move. If the level bar never moves, stop — the problem is the microphone or
its permission, not recognition, and no amount of language-profile tuning will fix it. If the level
bar moves normally, compare "raw heard" with what you said: if the intended sentence appears in the
alternatives list but not at position one, re-ranking is doing its job; if none of the alternatives
is close, change the language profile or switch to Cloud Speech-to-Text and try again.

**Test 9 — Greetings**
Say "Hello AwazPay", "Assalam-o-Alaikum", "Kya haal hai", "Tum kya kar sakte ho". Each gets a
natural spoken reply, never "I didn't understand".

**Test 10 — Microphone health check**
In **Settings → Developer / Demo Mode → Voice Diagnostics**, watch the Mic Status panel while doing
nothing for 15–20 seconds. "Session restarts" should climb slowly (Chrome ends and restarts a
continuous session every so often; this is normal), and the level bar should sit near zero in a
quiet room. Now say something continuously for a few seconds: the level bar should rise well above
zero. If it does not, the operating system's microphone permission or input device selection is the
actual problem, not AwazPay.

**Test 11 — Voice Test Lab, comparing providers**
Switch on **Voice Test Lab** in the same section. With Browser selected, pick "Ahmed ko paanch
hazaar rupay bhejo" from the phrase list, press **Record test phrase**, and say it. Note the raw
transcript, intent and confidence. If you have a cloud key configured, switch the Test Lab's
provider to Cloud, record the exact same phrase again, and compare the two results directly — this
is the fastest way to tell whether the browser's built-in recognition is actually the bottleneck for
your voice.

**Also worth checking:** say "cancel karo" mid-transaction; say "settings kholo" then "wapas jao";
mute yourself and confirm the touch buttons complete the same journeys; turn off Hide Sensitive
Screen Information in Settings and confirm the balance can then be shown deliberately.

---

## Speech input architecture

Accuracy is treated as a pipeline problem, not a single fix, because a bad
transcript cannot be recovered by better parsing downstream:

```
Microphone
    |
SpeechProvider            <-- src/services/speechProvider.ts
    |    BrowserSpeechProvider  (Web Speech API, built in, free)
    |    CloudSpeechProvider    (records real audio, posts it to a
    |                            configurable multilingual STT endpoint)
    |
RecognitionOutcome (raw transcript + ranked alternatives + confidence + latency)
    |
Pakistani normalisation layer   <-- src/services/normalizationService.ts
    |
Intent engine                   <-- src/services/intentService.ts
    |
Security engine -> Transaction flow
```

Nothing below `RecognitionOutcome` knows or cares which provider produced it.
`useVoiceAssistant` and `useTransactionFlow` call `getActiveSpeechProvider()`
and use whichever implementation Settings has selected; switching providers
is a Settings change, not a code change. Financial amounts are never guessed
or corrected at any stage, regardless of which provider is active — an
unclear amount always causes AwazPay to ask again.

### What was actually wrong, diagnosed

Before changing anything, the existing pipeline was inspected against ten
concrete questions (mic input, recognition start, interim/final results,
language support, unexpected stops, continuous-mode health, permission,
silence vs. misrecognition, and which layer a failure belonged to). Two real
defects were found and fixed, not worked around:

1. **`no_speech` and `aborted` were being discarded silently** inside the
   continuous listener (`if (kind !== 'no_speech' && kind !== 'aborted')
   onError?.(...)`), so the single most useful signal — "the app heard
   nothing at all" — never reached any log. It is now recorded as a distinct
   diagnostic entry (`recordSilence`) whenever diagnostics are on, so
   "the mic isn't picking anything up" is visible instead of looking
   identical to "the mic heard you and misread you".
2. **There was no way to see whether the microphone itself was receiving
   audio**, independent of the speech engine. A muted input, the wrong
   recording device, or a silent room were indistinguishable from bad
   transcription. `micMonitor.ts` now opens an independent
   `AnalyserNode` on the microphone and reports a live 0–1 level, shown as a
   bar in both **Mic Status** and the **Voice Test Lab** — if that bar never
   moves while you're speaking, the fault is upstream of recognition
   entirely.

Everything else — five ranked alternatives instead of one, re-ranking by
which reading actually forms a command, the Pakistani normalisation
dictionary, confidence-gated confirmation — was already in place from the
previous accuracy pass and is unchanged; see the git history for that work.
What's new in this pass is the ability to *prove* which layer a given failure
belongs to, and a second, stronger transcription engine to fall back to when
the browser's own accuracy is the actual ceiling.

### Two speech providers

| Provider | How it works | Cost | Setup |
| --- | --- | --- | --- |
| **Browser Speech Recognition** (default) | Wraps the Web Speech API (`speechService.ts`) | Free | None |
| **Cloud Speech-to-Text** | Records real audio with `MediaRecorder`, silence-detects the end of an utterance, and POSTs it to a configurable Whisper-compatible endpoint | Pay-per-use on whichever API you configure | Endpoint + model + key, in Settings |

Cloud mode is turn-based, not streaming: it records until you stop talking,
transcribes that one utterance, and immediately starts recording the next.
True low-latency streaming ASR needs a WebSocket to a streaming-capable
backend, which is out of scope for a static hackathon front end — this is
documented rather than pretended away.

**Configure it:** tap the AwazPay logo five times, open **Settings →
Developer / Demo Mode → Speech Provider**, choose **Cloud Speech-to-Text**,
and fill in the endpoint (e.g. `https://api.openai.com/v1/audio/transcriptions`),
model (e.g. `whisper-1`), and an API key. Press **Test Connection**, then
switch to the **Voice Test Lab** below it to actually record a phrase — that
first real recording is the true end-to-end check, since a structural check
alone can't confirm a key is valid without spending a request on it.

**On the API key:** without `VITE_CLOUD_STT_PROXY_URL` set, the key you type
into Settings is held in memory for that browser tab only — never written to
`localStorage`, never persisted, gone on reload — and is sent directly from
the browser to the endpoint you configured. That is a hackathon-only shortcut
for trying cloud transcription in a few minutes. **It is not how a shipped
product should call a paid API.** Set `VITE_CLOUD_STT_PROXY_URL` (see
`.env.example`) to point at a backend proxy instead, and no key ever needs to
reach the browser at all; `server/sttProxy.example.mjs` is a minimal,
intentionally small example of what that proxy looks like:

```bash
STT_API_KEY=sk-...  npm run proxy
# then, in another terminal, with VITE_CLOUD_STT_PROXY_URL=http://localhost:8787/transcribe in .env.local
npm run dev
```

### Pick the right recognition language

| Profile | Recognition runs in | Best for |
| --- | --- | --- |
| Auto / Mixed (default) | en-PK, falling back to en-IN then en-US | Roman Urdu and Urdu-English mixed speech |
| Pakistani Urdu | ur-PK | Speaking pure Urdu |
| Pakistani English | en-PK | English with a Pakistani accent |
| English (US) | en-US | Plain English |

Auto / Mixed is **not** language auto-detection. The Web Speech API cannot
detect language, and only one recogniser can be live at a time, so genuine
auto-detection is impossible in a browser. It is a code-mixed profile: an
English acoustic model transcribes Roman Urdu phonetically ("bhejo", "batao")
and gets embedded English words right, which is what mixed speech needs. An
Urdu-only model returns Urdu script and mangles the English half. The parser
accepts Urdu script, Roman Urdu and English regardless of profile, and this
same language list is offered to whichever provider — Browser or Cloud — is
currently active.

### Normalisation and correction

Roman Urdu has no fixed spelling, so variants fold onto canonical tokens
before any rule runs, and known mishearings are corrected ("balance potato"
becomes "balance batao"). Correction is deliberately conservative: only words
of five characters or more, never common function words, and **never digits,
amounts or names**. A misheard amount fails and is asked again rather than
being guessed at, because moving the wrong amount of someone's money is worse
than admitting confusion.

### Voice Diagnostics

Switch on **Voice Diagnostics** in the same Developer section. It now shows,
above the log, a **live Mic Status** panel: permission state, whether the
provider is actively recording right now, the provider and language in use,
how many times the session has restarted itself, and the same live audio
level bar as the Test Lab. Below that, each recognition turn shows the raw
transcript, every alternative the engine offered and which one was used, the
confidence band, latency, the corrections applied, the detected intent, and
whether the local engine or the AI layer handled it — including turns where
nothing was heard at all, which used to be invisible.

Read it like this:
- **Level bar never moves while you speak** → the fault is the microphone or
  its permission, not recognition. Check the OS input device and browser
  permission before touching any settings here.
- **A run of silent turns with the level bar clearly moving** → the
  recognition language is wrong for what's being said; try a different
  profile or switch provider.
- **"Raw heard" doesn't match what you said** → the speech engine
  mistranscribed the audio. Try Cloud Speech-to-Text, or a different language
  profile, and compare in the Test Lab.
- **"Raw heard" matches, but the intent is wrong** → the deterministic
  command rules need a new alias; this is a normalisation/pattern problem,
  not a recognition problem.

Diagnostics is in memory only, never stored, never transmitted, and off by
default.

### Voice Test Lab

The tool for answering "which provider and language actually understands my
accent?" directly, rather than by inference from the live session. Switch it
on in the same Developer section. Pick a provider, a language, optionally one
of the required Pakistani test phrases below (or say anything freeform),
press **Record test phrase**, and speak. The result shows raw transcript,
normalized transcript, detected intent, confidence and latency together, and
whether the transcript matched the phrase you were asked to say. Run the same
phrase on Browser and then on Cloud to compare them directly.

Required test phrases, built into the Test Lab's phrase list and also
asserted in `npm run verify`:

| Language | Phrase |
| --- | --- |
| English | Hello AwazPay |
| English | Tell me my balance |
| English | Send five thousand rupees to Ahmed |
| Roman Urdu | Mera balance batao |
| Roman Urdu | Ahmed ko paanch hazaar rupay bhejo |
| Roman Urdu | Mobile load karna hai |
| Roman Urdu | Mujhe meri transaction history batao |
| Mixed | Ahmed ko 5000 rupees send karo |
| Mixed | Mera balance check karo |
| Mixed | Mobile ka 1000 rupees load kar do |

## AI Intelligence layer

Optional, and off by default. **Settings → Developer / Demo Mode → AI
Intelligence** offers Local Demo Intelligence (the default, no key, no network)
or an external OpenAI-compatible endpoint.

The architectural rule is absolute:

```
Speech -> Normalisation -> Deterministic intent engine
     |                            |
     |                     banking command -> securityEngine -> transactionService
     |
     +-- unknown / conversational -> AI layer -> spoken reply only
```

The model answers greetings, small talk and capability questions. It never
executes a transaction, never changes a balance, and never bypasses the
verification challenge, the PKR 25,000 threshold or Trusted Circle. If it
returns a banking intent, that is treated as a *suggestion*: it is re-parsed by
the deterministic engine and confirmed aloud with the user before anything runs.

Greetings work without any AI at all. "Hello", "Assalam-o-Alaikum", "Kya haal
hai" and "Tum kya kar sakte ho" are handled by local rules, so the assistant is
never rude to someone who just said hello.

**API keys are developer-only.** A key entered in that panel is held in memory
for that browser tab: never written to storage, never persisted, never
committed. A production build must not call a model from the browser at all;
that call belongs behind a backend holding the credential.

## Architecture

```
src/
  components/     AwazOrb, PrivacyCurtain, TransactionStage, VoiceStatusPanel, AppShell,
                  VoiceDiagnostics, VoiceTestLab, MicStatusPanel
  data/           demoWallet.ts, voicePhrases.ts
  engines/        securityEngine, commandEngine
  hooks/          useVoiceAssistant, useTransactionFlow
  screens/        One file per route, including NfcPayment
  services/       speechProvider, speechService, voiceOutputService, intentService,
                  normalizationService, diagnosticsService, micMonitor, transactionService, aiService
  state/          store, announcer, voiceSession, assistantContext
  types/          wallet.ts, voice.ts
server/
  sttProxy.example.mjs   Minimal example backend proxy for Cloud Speech-to-Text
```

| Module | Responsibility |
| --- | --- |
| `speechProvider` | The provider abstraction: `BrowserSpeechProvider`, `CloudSpeechProvider`, and the registry that switches between them |
| `speechService` | The Web Speech API wrapper `BrowserSpeechProvider` wraps: recognition, restart guard, language fallback, permission request |
| `micMonitor` | Independent microphone level metering via `AudioContext`, used to tell "no audio" apart from "bad transcription" |
| `diagnosticsService` | In-memory recognition log and live Mic Status, feeding Voice Diagnostics |
| `voiceOutputService` | Synthesis, Urdu voice selection with Roman Urdu fallback, speaking events |
| `normalizationService` | Roman Urdu spelling-variant folding and conservative mishearing correction, ahead of intent detection |
| `intentService` | Transcript → intent and slots, across Urdu script, Roman Urdu and English |
| `commandEngine` | Routes an intent to an action. Pure; the hook performs the effects. |
| `securityEngine` | Transaction limit, unique per-transaction challenges, Trusted Circle |
| `transactionService` | Simulated payment, top-up, deposit, credit. Owns `localStorage`. |
| `aiService` | Optional conversational layer; never executes a transaction |
| `useVoiceAssistant` | The always-on session: wake word, routing, speech, microphone lifecycle |
| `useTransactionFlow` | One transaction from spoken request to private spoken receipt |
| `voicePhrases` | Every spoken line, in Urdu script, Roman Urdu and English |

The assistant is mounted once in `AppShell`, so the session survives navigation. A transaction flow
borrows the microphone while it asks questions and hands it back the moment it finishes, because only
one recognition session — browser or cloud — can be active at a time. Both `useVoiceAssistant` and
`useTransactionFlow` talk exclusively to `getActiveSpeechProvider()`; neither one imports
`speechService` directly, which is what makes the provider swap in Settings take effect everywhere at
once.

### Language model

Urdu is the primary spoken language. Each line exists in three variants and
`voiceOutputService.resolvePhrase` picks one: Urdu script when a real Urdu voice is installed, Roman
Urdu when it is not (an English voice reads it close enough to be understood), and English when the
user selects an English voice. Recognition prefers `ur-PK` and falls back through `en-PK` and
`en-IN` to `en-US`. Amounts are spoken as digits so each voice reads them in its own language.

This is a pattern parser, not a language model. It does not understand every phrasing or accent.
`intentService` is built around an `IntentProvider` interface, so a hosted multilingual model can be
registered with `setIntentProvider` and every caller keeps working unchanged.

### Privacy model

Sensitive values are spoken, never printed. `PrivacyCurtain` is rendered wherever a conventional
banking app would show a figure, and it accepts no financial values by construction. The render test
asserts that no route prints a balance or transaction amount.

The one exception is **Settings → Privacy → Hide sensitive screen information**, which lets a user
with partial sight opt into an on-screen balance and history. It is on by default.

### Security model

| Amount | Path |
| --- | --- |
| Up to PKR 25,000 | Secret word plus a unique random challenge number |
| Above PKR 25,000 | The same, then Simulated Trusted Circle Authorization |

The challenge number differs on every transaction and never repeats within the last eight, in memory
as well as in storage. Three failed attempts cancel the transaction.

**On Trusted Circle:** the trusted person never reads a code aloud. A shared-secret-over-the-phone
flow trains people to hand codes to whoever asks, which is how social-engineering fraud works, and
it is a poor fit for someone who depends on another person's help. The intended production design is
an approval prompt on the trusted person's own device. This build simulates that remote approval.

---

## Known limitations

1. **No OS-level wake word.** The session needs the tab open and one initial gesture. Browsers
   provide no background hotword API.
2. **No voice biometrics.** Verification proves knowledge of a shared secret, not identity.
   `securityEngine.verifyChallengeResponse` is the documented seam for speaker verification.
3. **NFC is simulated.** Web NFC is Android-Chrome only, reads tags rather than payment terminals,
   and the card rails are unreachable from a browser.
4. **Urdu support varies by device.** Chrome's `ur-PK` recognition is uneven and most desktops have
   no Urdu synthesis voice, so output falls back to Roman Urdu.
5. **Speech recognition needs a network connection** in Chrome, which sends audio to Google for
   transcription. Everything else runs locally.
6. **The microphone is open while the app is in the foreground.** It closes when the tab is hidden
   and while AwazPay is speaking, but a user should know it is listening for the wake phrase.
7. **Single device, single user.** No accounts, no sync, no server.
8. **Cloud Speech-to-Text is turn-based, not streaming.** It records until it detects silence, then
   transcribes; there is a short pause after each utterance rather than word-by-word live text. True
   streaming ASR needs a WebSocket-capable backend, out of scope here.
9. **The Cloud provider's bring-your-own-key path calls the transcription API directly from the
   browser** unless `VITE_CLOUD_STT_PROXY_URL` is set. That direct-call path is a hackathon
   convenience, explicitly not the production shape — see "Speech input architecture" above.
10. **Mic level metering needs its own microphone permission grant**, separate from recognition's own
    capture, though both draw from the same physical device and Chrome allows this without conflict.

---

## Accessibility

Voice is the primary interface and every action has a touch equivalent. State is never signalled by
colour alone: each session state carries a text label, an icon and a shape change. The app also
provides screen-reader labels on all controls, an assertive live region mirroring spoken guidance,
keyboard operation throughout, a 44px minimum touch target, optional high contrast and large
controls, reduced-motion support, and haptic feedback where supported.
