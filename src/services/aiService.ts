/**
 * aiService — the optional intelligence layer.
 *
 * ARCHITECTURAL RULE, NON-NEGOTIABLE: this layer never executes anything.
 *
 *   Speech -> Normalisation -> Deterministic intent engine
 *        |                            |
 *        |                     banking command? -> securityEngine -> transactionService
 *        |
 *        +-- unknown / conversational -> aiService -> spoken reply only
 *
 * If the model returns a banking intent, that intent is treated as a
 * *suggestion*: it is re-validated by the deterministic engine, it must pass
 * the same verification challenge, the same PKR 25,000 threshold and the same
 * Trusted Circle rules as any other transaction, and the user must confirm it
 * out loud. The model is an interpreter, never the banking authority.
 *
 * The default provider is local and needs no API key, no network and no
 * account, so the demo works offline and no visually impaired user is ever
 * asked to configure an API.
 */
import type { Phrase } from '../data/voicePhrases'
import { PHRASES, phrase } from '../data/voicePhrases'

/** What the intelligence layer is allowed to return. */
export type AIResult =
  | { type: 'conversation'; response: Phrase | string }
  | {
      /**
       * A suggested banking intent. NOT an instruction. The caller must run
       * this back through the deterministic engine and confirm it with the
       * user before anything happens.
       */
      type: 'banking_intent'
      intent: 'PAYMENT' | 'BALANCE' | 'MOBILE_TOPUP' | 'CASH_DEPOSIT' | 'NFC_PAYMENT'
      recipient?: string
      amount?: number
      confidence: 'high' | 'medium' | 'low'
    }
  | { type: 'unavailable'; reason: string }

export interface AIRequestContext {
  /** What the user said, after normalisation. */
  transcript: string
  /** The recogniser's confidence band, so the model can hedge appropriately. */
  confidence: 'high' | 'medium' | 'low' | 'unknown'
  /** Preferred reply language. */
  language: string
}

export interface AIProvider {
  readonly id: string
  readonly label: string
  /** True when this provider needs a key before it can be used. */
  readonly requiresKey: boolean
  generateResponse(context: AIRequestContext): Promise<AIResult>
  checkConnection(): Promise<{ ok: boolean; detail: string }>
}

/**
 * The AwazPay assistant persona, shared by every provider.
 *
 * Kept short on purpose. This is a voice app: a long reply is a worse reply,
 * because the user has to listen to all of it before they can act.
 */
export const AWAZPAY_SYSTEM_PROMPT = `You are AwazPay Assistant, a voice-first, privacy-first digital banking assistant for visually impaired users in Pakistan. Tagline: "Banking Beyond Sight".

STYLE
- Warm, respectful, concise. One or two short sentences, never more.
- This is spoken aloud, so no lists, no markdown, no emoji.
- Reply in the user's language: Pakistani Urdu, Roman Urdu, Urdu-English mixed, or English. Match whichever they used. Prefer Roman Urdu when unsure.

WHAT YOU DO
- Greet, answer small talk, and explain what AwazPay can do.
- AwazPay can: check balance, send payments, mobile top-up, NFC payment, cash deposit guidance, transaction history, and Trusted Circle for large payments.

HARD LIMITS
- You never perform a transaction, move money, or confirm a payment. The app's own security engine does that.
- Never state a balance, an amount, or a transaction detail. You do not have access to them.
- Never invent an amount or a recipient name. If either is unclear, say you did not catch it and ask the user to repeat it.

OUTPUT
Reply with JSON only:
{"type":"conversation","response":"<what to say>"}
or, if the user clearly asked for a banking action:
{"type":"banking_intent","intent":"PAYMENT|BALANCE|MOBILE_TOPUP|CASH_DEPOSIT|NFC_PAYMENT","recipient":"<name or omit>","amount":<number or omit>,"confidence":"high|medium|low"}
Omit amount entirely if you are not certain of it. Never guess it.`

// ------------------------------------------------------- local provider

/**
 * Deterministic conversational replies. No network, no key, no cost.
 *
 * This is the default and it handles everything the demo needs: greetings,
 * small talk and capability questions. An external model only adds value for
 * phrasings outside this set.
 */
export const localIntelligenceProvider: AIProvider = {
  id: 'local',
  label: 'Local Demo Intelligence',
  requiresKey: false,

  async generateResponse({ transcript }: AIRequestContext): Promise<AIResult> {
    const text = transcript.toLowerCase()

    if (/\b(salam|hello|hi|hey)\b/.test(text)) {
      return { type: 'conversation', response: PHRASES.greeting }
    }
    if (/\b(kya\s*haal|kaise\s*ho|how\s*are\s*you)\b/.test(text)) {
      return { type: 'conversation', response: PHRASES.howAreYou }
    }
    if (/\b(kya\s*kar\s*sakt|what\s*can\s*you|kaun\s*ho|who\s*are\s*you)\b/.test(text)) {
      return { type: 'conversation', response: PHRASES.capabilities }
    }
    if (/\b(shukriya|thanks|thank\s*you)\b/.test(text)) {
      return { type: 'conversation', response: PHRASES.thanks }
    }

    // Anything else: say so plainly and point at what does work, rather than
    // pretending to understand.
    return { type: 'conversation', response: PHRASES.notUnderstood }
  },

  async checkConnection() {
    return { ok: true, detail: 'Local intelligence is always available. No network or API key needed.' }
  },
}

// ---------------------------------------------------- external provider

/**
 * A bring-your-own-key provider for any OpenAI-compatible chat endpoint.
 *
 * DEVELOPER / DEMO ONLY. A key entered here is held in memory for this tab
 * only: never written to localStorage, never persisted, never committed, and
 * gone when the tab closes. A production build must not call a model provider
 * from the browser at all; the call belongs behind a backend that holds the
 * credential.
 */
export interface ExternalProviderConfig {
  endpoint: string
  model: string
  apiKey: string
}

/** Session-only key storage. Deliberately a module variable, not storage. */
let externalConfig: ExternalProviderConfig | null = null

export function setExternalConfig(config: ExternalProviderConfig | null): void {
  externalConfig = config
}

export function hasExternalConfig(): boolean {
  return !!externalConfig?.apiKey
}

/** Never returns the key itself, only whether one is present. */
export function describeExternalConfig(): { endpoint: string; model: string; keySet: boolean } | null {
  if (!externalConfig) return null
  return { endpoint: externalConfig.endpoint, model: externalConfig.model, keySet: !!externalConfig.apiKey }
}

function coerceResult(raw: string): AIResult {
  try {
    const start = raw.indexOf('{')
    const end = raw.lastIndexOf('}')
    const json = start >= 0 && end > start ? raw.slice(start, end + 1) : raw
    const parsed = JSON.parse(json) as Record<string, unknown>

    if (parsed.type === 'banking_intent' && typeof parsed.intent === 'string') {
      const amount = typeof parsed.amount === 'number' && Number.isFinite(parsed.amount) ? parsed.amount : undefined
      return {
        type: 'banking_intent',
        intent: parsed.intent as 'PAYMENT' | 'BALANCE' | 'MOBILE_TOPUP' | 'CASH_DEPOSIT' | 'NFC_PAYMENT',
        recipient: typeof parsed.recipient === 'string' ? parsed.recipient : undefined,
        // A model-suggested amount is only ever a suggestion, and the caller
        // confirms it out loud before anything happens.
        amount: amount && amount > 0 ? Math.round(amount) : undefined,
        confidence:
          parsed.confidence === 'high' || parsed.confidence === 'low'
            ? parsed.confidence
            : 'medium',
      }
    }

    if (typeof parsed.response === 'string' && parsed.response.trim()) {
      return { type: 'conversation', response: parsed.response.trim() }
    }
  } catch {
    // Model returned prose instead of JSON, which is fine for a chat reply.
  }

  const cleaned = raw.trim()
  if (cleaned) return { type: 'conversation', response: cleaned.slice(0, 400) }
  return { type: 'unavailable', reason: 'The assistant returned an empty response.' }
}

export const externalIntelligenceProvider: AIProvider = {
  id: 'external',
  label: 'External AI (bring your own key)',
  requiresKey: true,

  async generateResponse(context: AIRequestContext): Promise<AIResult> {
    if (!externalConfig?.apiKey) {
      return { type: 'unavailable', reason: 'No API key is configured for this session.' }
    }

    try {
      const response = await fetch(externalConfig.endpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${externalConfig.apiKey}`,
        },
        body: JSON.stringify({
          model: externalConfig.model,
          max_tokens: 200,
          temperature: 0.4,
          messages: [
            { role: 'system', content: AWAZPAY_SYSTEM_PROMPT },
            {
              role: 'user',
              content: `Recognition confidence: ${context.confidence}. Preferred reply language: ${context.language}.\nUser said: ${context.transcript}`,
            },
          ],
        }),
      })

      if (!response.ok) {
        return { type: 'unavailable', reason: `Assistant request failed with status ${response.status}.` }
      }

      const data = (await response.json()) as {
        choices?: Array<{ message?: { content?: string } }>
      }
      const content = data.choices?.[0]?.message?.content
      if (!content) return { type: 'unavailable', reason: 'The assistant returned no content.' }
      return coerceResult(content)
    } catch (error) {
      return { type: 'unavailable', reason: `Could not reach the assistant. ${(error as Error).message}` }
    }
  },

  async checkConnection() {
    if (!externalConfig?.apiKey) return { ok: false, detail: 'No API key set for this session.' }
    const result = await this.generateResponse({ transcript: 'hello', confidence: 'high', language: 'en' })
    if (result.type === 'unavailable') return { ok: false, detail: result.reason }
    return { ok: true, detail: `Connected to ${externalConfig.model}.` }
  },
}

// ------------------------------------------------------------ registry

const PROVIDERS: Record<string, AIProvider> = {
  local: localIntelligenceProvider,
  external: externalIntelligenceProvider,
}

let activeProviderId = 'local'

export function setActiveProvider(id: string): void {
  if (PROVIDERS[id]) activeProviderId = id
}

export function getActiveProvider(): AIProvider {
  return PROVIDERS[activeProviderId] ?? localIntelligenceProvider
}

export function listProviders(): AIProvider[] {
  return Object.values(PROVIDERS)
}

/**
 * Asks the intelligence layer for a reply.
 *
 * Falls back to the local provider whenever the external one is unavailable,
 * so a missing key or a dead network degrades to a working demo rather than
 * silence.
 */
export async function askAssistant(context: AIRequestContext): Promise<{ result: AIResult; providerId: string }> {
  const provider = getActiveProvider()
  try {
    const result = await provider.generateResponse(context)
    if (result.type === 'unavailable' && provider.id !== 'local') {
      const fallback = await localIntelligenceProvider.generateResponse(context)
      return { result: fallback, providerId: 'local' }
    }
    return { result, providerId: provider.id }
  } catch {
    const fallback = await localIntelligenceProvider.generateResponse(context)
    return { result: fallback, providerId: 'local' }
  }
}

/** Wraps a plain model string so the announcer can speak it in any mode. */
export function toSpeakable(response: Phrase | string): Phrase {
  return typeof response === 'string' ? phrase(response, response, response) : response
}
