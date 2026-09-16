/**
 * Offline verification for the parsing and security logic.
 *
 * Run with: npm run verify
 *
 * These are the pieces that must behave correctly without a browser: intent
 * classification, amount and recipient extraction, challenge uniqueness and
 * the transaction limit. Speech input/output is browser-only and is verified
 * by hand in the app.
 */
import {
  extractAmount,
  extractMobileNumber,
  extractRecipient,
  isFinancialIntent,
  isMenuRequest,
  MENU_OPTIONS,
  parseMenuSelection,
  parseTranscriptSync,
  pickBestInterpretation,
  stripWakePhrase,
} from '../src/services/intentService'
import { normalizeForIntent } from '../src/services/normalizationService'
import {
  getActiveSpeechProviderId,
  getSpeechProvider,
  listSpeechProviders,
  setActiveSpeechProvider,
} from '../src/services/speechProvider'
import {
  generateChallenge,
  getVerificationTier,
  requiresTrustedCircle,
  verifyChallengeResponse,
} from '../src/engines/securityEngine'
import { simulatePayment, simulateTopUp, simulateCashDeposit } from '../src/services/transactionService'
import { createInitialState } from '../src/data/demoWallet'

let passed = 0
let failed = 0

function check(label: string, actual: unknown, expected: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected)
  if (ok) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}\n        expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)
  }
}

function assert(label: string, condition: boolean) {
  check(label, condition, true)
}

console.log('\nWake phrase')
check('strips "Hey AwazPay"', stripWakePhrase('Hey AwazPay, what is my balance?'), 'what is my balance')
check('strips a common mishearing', stripWakePhrase('hey awaaz pay pay 500 rupees'), 'pay 500 rupees')
check('works without the wake phrase', stripWakePhrase('what is my balance'), 'what is my balance')
assert('flags the wake phrase', parseTranscriptSync('Hey AwazPay, my balance').wakeWordDetected)
assert('command still works without it', parseTranscriptSync('my balance').intent === 'check_balance')

console.log('\nBalance intent')
for (const phrase of [
  'Hey AwazPay, what is my balance?',
  'AwazPay mera balance batao',
  'Mera account balance kya hai?',
  'Can you tell me my balance?',
  'Mera balance check karo',
]) {
  check(phrase, parseTranscriptSync(phrase).intent, 'check_balance')
}

console.log('\nPayment intent')
check('Pay 500 rupees', parseTranscriptSync('Pay 500 rupees').intent, 'pay')
check('Pay 500 rupees amount', parseTranscriptSync('Pay 500 rupees').slots.amount, 500)
check('Send 2000 rupees', parseTranscriptSync('Send 2000 rupees').slots.amount, 2000)
check('I want to make a payment', parseTranscriptSync('I want to make a payment').intent, 'pay')
check('no amount when unspoken', parseTranscriptSync('I want to make a payment').slots.amount, undefined)
check('recipient after "to"', parseTranscriptSync('pay 1500 rupees to Ahmed').slots.recipient, 'Ahmed Khan')
check('recipient with "ko"', parseTranscriptSync('Fatima ko 300 rupees bhejo').slots.recipient, 'Fatima Noor')
check('high value amount', parseTranscriptSync('send 30000 rupees to Bilal').slots.amount, 30000)

console.log('\nMobile top-up intent')
for (const phrase of [
  'Load 500 rupees to my mobile',
  'Do a mobile top-up',
  'Mujhe 1000 ka load karna hai',
  'mobile recharge karna hai',
]) {
  check(phrase, parseTranscriptSync(phrase).intent, 'mobile_topup')
}
check('top-up amount', parseTranscriptSync('Mujhe 1000 ka load karna hai').slots.amount, 1000)
check('top-up beats payment', parseTranscriptSync('load 500 rupees to my mobile').intent, 'mobile_topup')
// "do" is Roman Urdu for two, but here it is the English verb.
check('no phantom amount from "do"', parseTranscriptSync('Do a mobile top-up').slots.amount, undefined)
check('hyphenated top-up', parseTranscriptSync('mobile top-up karna hai').intent, 'mobile_topup')

console.log('\nCash deposit intent')
check('I want to deposit cash', parseTranscriptSync('I want to deposit cash').intent, 'cash_deposit')
check('Cash deposit', parseTranscriptSync('Cash deposit').intent, 'cash_deposit')

console.log('\nControl intents')
check('cancel', parseTranscriptSync('cancel').intent, 'cancel')
check('confirm', parseTranscriptSync('confirm payment').intent, 'confirm')
// "what can you do" is now answered as a capability question, not generic help.
check('capabilities question', parseTranscriptSync('what can you do').intent, 'capabilities')
check('unknown stays unknown', parseTranscriptSync('the weather is nice today').intent, 'unknown')

console.log('\nAmount extraction')
check('digits', extractAmount('pay 2500 rupees'), 2500)
check('comma digits', extractAmount('pay 2,500 rupees'), 2500)
check('shorthand k', extractAmount('send 2k rupees'), 2000)
check('english words', extractAmount('five hundred rupees'), 500)
check('english compound', extractAmount('two thousand five hundred'), 2500)
check('roman urdu sau', extractAmount('paanch sau rupay'), 500)
check('roman urdu hazaar', extractAmount('do hazaar rupay bhejo'), 2000)
check('roman urdu das hazaar', extractAmount('das hazaar'), 10000)
check('no amount present', extractAmount('pay someone'), undefined)
check('bare word-number needs a currency word', extractAmount('do a top up'), undefined)
check('word-number with currency word', extractAmount('fifty rupees'), 50)

console.log('\nMobile number extraction')
check('spaced number', extractMobileNumber('load 500 to 0300 1234567'), '0300 1234567')
check('mobile digits are not the amount', extractAmount('load 500 to 03001234567'), 500)
check('no number present', extractMobileNumber('top up my mobile'), undefined)

console.log('\nRecipient extraction')
check('known full name', extractRecipient('pay 100 to ahmed khan'), 'Ahmed Khan')
check('merchant name', extractRecipient('pay city pharmacy 400'), 'City Pharmacy')
check('unknown name after to', extractRecipient('pay 100 to javed'), 'Javed')

console.log('\nHackathon demo commands (Urdu-first)')
const DEMO_COMMANDS: Array<[string, string, Record<string, unknown>]> = [
  ['Hey AwazPay mera balance batao', 'check_balance', {}],
  ['AwazPay Ahmed ko 5000 rupay bhejo', 'pay', { amount: 5000, recipient: 'Ahmed Khan' }],
  ['AwazPay Ahmed ko 30000 rupay bhejo', 'pay', { amount: 30000, recipient: 'Ahmed Khan' }],
  ['AwazPay 1000 ka mobile load karo', 'mobile_topup', { amount: 1000 }],
  ['AwazPay cash deposit karna hai', 'cash_deposit', {}],
  ['AwazPay NFC payment', 'pay_nfc', {}],
  ['Mujhe Ahmed ko paanch hazaar rupay bhejne hain', 'pay', { amount: 5000, recipient: 'Ahmed Khan' }],
  ['Balance check karo', 'check_balance', {}],
  ['Mobile load karna hai', 'mobile_topup', {}],
  ['Transaction history batao', 'recent_transactions', {}],
  ['Settings kholo', 'open_settings', {}],
  ['Trusted Circle kholo', 'trusted_circle', {}],
  ['Payment cancel karo', 'cancel', {}],
  ['Home kholo', 'go_home', {}],
  ['Wapas jao', 'go_back', {}],
]
for (const [utterance, expectedIntent, expectedSlots] of DEMO_COMMANDS) {
  const parsed = parseTranscriptSync(utterance)
  check(`"${utterance}" -> ${expectedIntent}`, parsed.intent, expectedIntent)
  for (const [slot, value] of Object.entries(expectedSlots)) {
    check(`  slot ${slot}`, (parsed.slots as Record<string, unknown>)[slot], value)
  }
}

console.log('\nUrdu script commands')
check('Urdu balance', parseTranscriptSync('میرا بیلنس بتاؤ').intent, 'check_balance')
check('Urdu payment', parseTranscriptSync('احمد کو 5000 روپے بھیجو').intent, 'pay')
check('Urdu recipient', parseTranscriptSync('احمد کو 5000 روپے بھیجو').slots.recipient, 'Ahmed Khan')
check('Urdu amount', parseTranscriptSync('احمد کو 5000 روپے بھیجو').slots.amount, 5000)
check('Urdu top-up', parseTranscriptSync('موبائل لوڈ کرنا ہے').intent, 'mobile_topup')
check('Urdu deposit', parseTranscriptSync('کیش ڈپازٹ کرنا ہے').intent, 'cash_deposit')
check('Urdu cancel', parseTranscriptSync('منسوخ کرو').intent, 'cancel')
check('Urdu confirm', parseTranscriptSync('تصدیق').intent, 'confirm')
check('Urdu-Indic digits', extractAmount('۵۰۰ روپے'), 500)
check('Urdu word amount', extractAmount('پانچ ہزار روپے'), 5000)
check('Urdu wake phrase', parseTranscriptSync('آواز پے میرا بیلنس بتاؤ').wakeWordDetected, true)

console.log('\nWake phrase handling')
const combined = parseTranscriptSync('Hey AwazPay mera balance batao')
check('wake detected in combined utterance', combined.wakeWordDetected, true)
check('command survives stripping', combined.intent, 'check_balance')
check('bare AwazPay wakes', parseTranscriptSync('awazpay').wakeWordDetected, true)
check('bare wake leaves no command', stripWakePhrase('hey awazpay'), '')
check('ambient speech does not wake', parseTranscriptSync('lets get some lunch').wakeWordDetected, false)

console.log('\nRoman Urdu normalization')
const NORMALIZE_CASES: Array<[string, string]> = [
  ['mera balance btao', 'balance'],
  ['balance bata do', 'batao'],
  ['ahmed ko paise bhej do', 'bhejo'],
  ['ahmed ko 5000 rupees bhejo', 'rupay'],
  ['mobile lod karna hai', 'load'],
  ['mobile recharge kro', 'karo'],
]
for (const [input, expectedToken] of NORMALIZE_CASES) {
  const { normalized } = normalizeForIntent(input)
  check(`"${input}" contains "${expectedToken}"`, normalized.includes(expectedToken), true)
}

console.log('\nTranscription correction (command words only)')
// The classic English-model mishearing of "batao".
check('"balance potato" -> balance intent', parseTranscriptSync('mera balance potato').intent, 'check_balance')
check('"hazard" -> hazaar', extractAmount(normalizeForIntent('paanch hazard rupay').normalized), 5000)
// Financial safety: digits are never corrected or invented.
check('digits are never rewritten', normalizeForIntent('bhejo 5000 rupay').normalized.includes('5000'), true)
check('no amount is invented', extractAmount(normalizeForIntent('ahmed ko bhejo').normalized), undefined)

console.log('\nGreetings and small talk')
const CONVERSATION: Array<[string, string]> = [
  ['Hello', 'greeting'],
  ['Hi AwazPay', 'greeting'],
  ['Assalam-o-Alaikum', 'greeting'],
  ['Salam', 'greeting'],
  ['How are you', 'how_are_you'],
  ['Kya haal hai', 'how_are_you'],
  ['Tum kya kar sakte ho', 'capabilities'],
  ['What can you do', 'capabilities'],
  ['Who are you', 'capabilities'],
  ['Shukriya', 'thanks'],
  ['Thank you', 'thanks'],
  ['Mujhe help chahiye', 'help'],
]
for (const [utterance, expected] of CONVERSATION) {
  check(`"${utterance}" -> ${expected}`, parseTranscriptSync(utterance).intent, expected)
}
// The bug being fixed: a greeting must never fall through to "unknown".
check('greeting is never unknown', parseTranscriptSync('hello').intent !== 'unknown', true)

console.log('\nNFC command variations')
for (const utterance of ['NFC payment', 'Pay using NFC', 'NFC se payment karo', 'NFC se pay karo', 'tap payment']) {
  check(`"${utterance}" -> pay_nfc`, parseTranscriptSync(utterance).intent, 'pay_nfc')
}

console.log('\nAlternative re-ranking (the accent fix)')
// The engine's top guess is nonsense; the intended sentence is third. The app
// must pick the reading that actually forms a command.
const misheard = pickBestInterpretation([
  { transcript: 'mera balance potato', confidence: 0.42 },
  { transcript: 'mera balance for auto', confidence: 0.31 },
  { transcript: 'mera balance batao', confidence: 0.28 },
])
check('a lower alternative that parses wins', misheard?.parsed.intent, 'check_balance')

const payment = pickBestInterpretation([
  { transcript: 'ahmed co-founder rupay bajo', confidence: 0.4 },
  { transcript: 'ahmed ko 5000 rupay bhejo', confidence: 0.35 },
])
check('slot-bearing alternative wins', payment?.parsed.intent, 'pay')
check('its amount is used', payment?.parsed.slots.amount, 5000)
check('its recipient is used', payment?.parsed.slots.recipient, 'Ahmed Khan')

const single = pickBestInterpretation([{ transcript: 'mera balance batao', confidence: 0.9 }])
check('a single good reading still works', single?.parsed.intent, 'check_balance')
check('empty alternatives return null', pickBestInterpretation([]), null)

console.log('\nFinancial intents are flagged for extra care')
check('payment is financial', isFinancialIntent('pay'), true)
check('top-up is financial', isFinancialIntent('mobile_topup'), true)
check('nfc is financial', isFinancialIntent('pay_nfc'), true)
check('balance is not financial', isFinancialIntent('check_balance'), false)
check('greeting is not financial', isFinancialIntent('greeting'), false)

console.log('\nRequired Pakistani test phrases (speech-accuracy priority)')
// These are the exact phrases from the accuracy investigation. Wrong here
// means the deterministic layer is the problem; right here but wrong in the
// app means the speech engine mistranscribed the audio, and the Voice Test
// Lab / Voice Diagnostics is where to look next, not this file.
const REQUIRED_PHRASES: Array<[string, string, Record<string, unknown>?]> = [
  ['Hello AwazPay', 'greeting'],
  ['Tell me my balance', 'check_balance'],
  ['Send five thousand rupees to Ahmed', 'pay', { amount: 5000, recipient: 'Ahmed Khan' }],
  ['Mera balance batao', 'check_balance'],
  ['Ahmed ko paanch hazaar rupay bhejo', 'pay', { amount: 5000, recipient: 'Ahmed Khan' }],
  ['Mobile load karna hai', 'mobile_topup'],
  ['Mujhe meri transaction history batao', 'recent_transactions'],
  ['Ahmed ko 5000 rupees send karo', 'pay', { amount: 5000, recipient: 'Ahmed Khan' }],
  ['Mera balance check karo', 'check_balance'],
  ['Mobile ka 1000 rupees load kar do', 'mobile_topup', { amount: 1000 }],
  ['Assalam o Alaikum AwazPay', 'greeting'],
  ['Kal ki transactions batao', 'recent_transactions'],
]
for (const [utterance, expectedIntent, expectedSlots] of REQUIRED_PHRASES) {
  const parsed = parseTranscriptSync(utterance)
  check(`"${utterance}" -> ${expectedIntent}`, parsed.intent, expectedIntent)
  for (const [slot, value] of Object.entries(expectedSlots ?? {})) {
    check(`  slot ${slot}`, (parsed.slots as Record<string, unknown>)[slot], value)
  }
}

console.log('\nSpeech provider registry')
check('browser provider is registered', listSpeechProviders().some((p) => p.id === 'browser'), true)
check('cloud provider is registered', listSpeechProviders().some((p) => p.id === 'cloud'), true)
check('browser provider needs no configuration', getSpeechProvider('browser').requiresConfig, false)
check('cloud provider needs configuration', getSpeechProvider('cloud').requiresConfig, true)
check('default active provider is browser', getActiveSpeechProviderId(), 'browser')
setActiveSpeechProvider('cloud')
check('switching providers updates the active id', getActiveSpeechProviderId(), 'cloud')
setActiveSpeechProvider('browser')
check('switching back works', getActiveSpeechProviderId(), 'browser')
// isSupported() must never throw in a DOM-less environment: this is the same
// guard style every other browser-feature check in this codebase uses, and
// this file's own successful run is proof it holds.
assert('browser.isSupported() does not throw outside a browser', (() => {
  try {
    getSpeechProvider('browser').isSupported()
    return true
  } catch {
    return false
  }
})())
assert('cloud.isSupported() does not throw outside a browser', (() => {
  try {
    getSpeechProvider('cloud').isSupported()
    return true
  } catch {
    return false
  }
})())

console.log('\nSpoken numbered menu')
check('menu has five options', MENU_OPTIONS.length, 5)
check('option 1 is NFC payment', MENU_OPTIONS[0].intent, 'pay_nfc')
check('option 2 is transfer money', MENU_OPTIONS[1].intent, 'pay')
check('option 3 is balance', MENU_OPTIONS[2].intent, 'check_balance')
check('option 4 is activity', MENU_OPTIONS[3].intent, 'recent_transactions')
check('option 5 is cash deposit', MENU_OPTIONS[4].intent, 'cash_deposit')
check('mobile top-up is not on the menu', MENU_OPTIONS.some((o) => o.intent === 'mobile_topup'), false)

const MENU_UTTERANCES: Array<[string, number | null]> = [
  ['1', 1],
  ['3', 3],
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['option two', 2],
  ['number 4', 4],
  ['say five', 5],
  // Roman Urdu numerals, since the user may answer in either language.
  ['ek', 1],
  ['do', 2],
  ['teen', 3],
  ['paanch', 5],
  // Wake phrase in front is fine; it is stripped before matching.
  ['Hey AwazPay three', 3],
  // Out of range, and not a menu choice.
  ['6', null],
  ['nine', null],
  // A real command that merely contains a number word must NOT be read as a
  // menu pick — this is the case that would otherwise move money by accident.
  ['Send two thousand rupees to Ahmed', null],
  ['pay 5000 to Ahmed', null],
  ['what is my balance', null],
]
for (const [utterance, expected] of MENU_UTTERANCES) {
  const picked = parseMenuSelection(utterance)
  check(`"${utterance}" -> ${expected ?? 'not a menu choice'}`, picked?.number ?? null, expected)
}

check('menu request: "menu"', isMenuRequest('menu'), true)
check('menu request: "options"', isMenuRequest('options'), true)
check('menu request: "repeat the options"', isMenuRequest('what can i say'), true)
check('not a menu request', isMenuRequest('send money to Ahmed'), false)

console.log('\nSecurity challenge')
const challenges = Array.from({ length: 8 }, () => generateChallenge())
assert('challenge is two digits', challenges.every((c) => c.number >= 10 && c.number <= 99))
assert(
  'every challenge in a run is unique',
  new Set(challenges.map((c) => c.number)).size === challenges.length,
)
assert('challenge ids are unique', new Set(challenges.map((c) => c.id)).size === challenges.length)

const challenge = { id: 'test', number: 47, createdAt: Date.now() }
assert('accepts word plus digits', verifyChallengeResponse('falcon 47', 'falcon', challenge))
assert('accepts spoken number', verifyChallengeResponse('falcon forty seven', 'falcon', challenge))
assert('accepts digit by digit', verifyChallengeResponse('falcon four seven', 'falcon', challenge))
assert('rejects wrong number', !verifyChallengeResponse('falcon 48', 'falcon', challenge))
assert('rejects missing secret word', !verifyChallengeResponse('47', 'falcon', challenge))
assert('rejects empty response', !verifyChallengeResponse('', 'falcon', challenge))

console.log('\nTransaction limit (PKR 25,000)')
check('below the limit', getVerificationTier(24999), 'standard')
check('exactly at the limit', getVerificationTier(25000), 'standard')
check('above the limit', getVerificationTier(25001), 'high_value')
assert('25,000 needs no trusted approval', !requiresTrustedCircle(25000))
assert('30,000 needs trusted approval', requiresTrustedCircle(30000))

console.log('\nSimulated transactions')
const wallet = createInitialState()
const pay = simulatePayment(wallet, 2500, 'Ahmed Khan')
assert('payment succeeds', pay.ok)
check('payment debits the balance', pay.newBalance, wallet.balance - 2500)
check('payment direction', pay.transaction?.direction, 'sent')

const tooMuch = simulatePayment(wallet, wallet.balance + 1, 'Ahmed Khan')
assert('payment above balance fails', !tooMuch.ok)
check('failure reason', tooMuch.error, 'insufficient_balance')

const topup = simulateTopUp(wallet, 500, '0300 1234567')
assert('top-up succeeds', topup.ok)
check('top-up debits the balance', topup.newBalance, wallet.balance - 500)

const deposit = simulateCashDeposit(wallet, 3000)
assert('deposit succeeds', deposit.ok)
check('deposit credits the balance', deposit.newBalance, wallet.balance + 3000)

const zero = simulatePayment(wallet, 0, 'Ahmed Khan')
assert('zero amount is rejected', !zero.ok)
check('zero amount reason', zero.error, 'invalid_amount')

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
