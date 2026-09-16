/**
 * Render smoke test.
 *
 * Renders every route through react-dom/server to catch crashes, broken
 * imports and context mistakes without a browser. Effects do not run here,
 * so this checks the render path only; the voice journeys are exercised by
 * hand in the app.
 *
 * It also asserts the privacy rule that matters most: no route may print a
 * balance or an amount in its initial markup.
 */
import { StrictMode } from 'react'
import { renderToString } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import App from '../src/App'
import { AppStateProvider } from '../src/state/store'
import { AnnouncerProvider } from '../src/state/announcer'
import { VoiceSessionProvider } from '../src/state/voiceSession'
import { createInitialState } from '../src/data/demoWallet'

const ROUTES = [
  '/',
  '/nfc',
  '/onboarding',
  '/home',
  '/payment',
  '/balance',
  '/receive',
  '/history',
  '/topup',
  '/cash-assist',
  '/trusted-circle',
  '/settings',
]

let passed = 0
let failed = 0

function pass(label: string) {
  passed += 1
  console.log(`  PASS  ${label}`)
}

function fail(label: string, detail: string) {
  failed += 1
  console.log(`  FAIL  ${label}\n        ${detail}`)
}

const wallet = createInitialState()
/**
 * Figures that must never appear in initial markup. Matched on digit
 * boundaries so the transaction limit "25,000" is not read as the seed
 * amount "5,000"; the limit is a user-chosen setting, not private data.
 */
const SECRET_FIGURES = [
  wallet.balance.toLocaleString('en-US'),
  ...wallet.transactions.map((t) => t.amount.toLocaleString('en-US')),
]

function leaks(html: string, figure: string): boolean {
  const escaped = figure.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(String.raw`(?<![\d,])${escaped}(?![\d,])`).test(html)
}

console.log('\nRoute rendering')
for (const route of ROUTES) {
  let html = ''
  try {
    html = renderToString(
      <StrictMode>
        <AppStateProvider>
          <AnnouncerProvider>
            <VoiceSessionProvider>
              <MemoryRouter initialEntries={[route]}>
                <App />
              </MemoryRouter>
            </VoiceSessionProvider>
          </AnnouncerProvider>
        </AppStateProvider>
      </StrictMode>,
    )
  } catch (error) {
    fail(`renders ${route}`, String(error))
    continue
  }

  if (!html.length) {
    fail(`renders ${route}`, 'produced empty markup')
    continue
  }

  const leaked = SECRET_FIGURES.filter((figure) => leaks(html, figure))
  if (leaked.length) {
    fail(`${route} keeps figures off screen`, `leaked: ${leaked.join(', ')}`)
    continue
  }

  pass(`renders ${route} with no figures on screen`)
}

console.log('\nBranding preserved')
const home = renderToString(
  <StrictMode>
    <AppStateProvider>
      <AnnouncerProvider>
        <VoiceSessionProvider>
          <MemoryRouter initialEntries={['/home']}>
            <App />
          </MemoryRouter>
        </VoiceSessionProvider>
      </AnnouncerProvider>
    </AppStateProvider>
  </StrictMode>,
)
if (home.includes('awazpay-icon.png')) pass('AwazPay logo still rendered')
else fail('AwazPay logo still rendered', 'icon not found in markup')
if (home.includes('role="img"') && home.includes('radial-gradient')) pass('Awaz Orb still rendered')
else fail('Awaz Orb still rendered', 'orb markup not found')
// The orb is the agent's presence, not a control: voice-first means there is
// no "tap to speak" button to find.
if (!home.includes('Tap to Speak')) pass('no Tap to Speak button on the home screen')
else fail('no Tap to Speak button on the home screen', 'the button is still rendered')
if (home.includes('Start Listening')) pass('one-time voice permission control is offered')
else fail('one-time voice permission control is offered', 'start control not found')
if (home.includes('AwazPay Assistant') && home.includes('Banking'))
  pass('AwazPay agent branding is present')
else fail('AwazPay agent branding is present', 'agent branding not found')

// The home screen is a spoken numbered menu: every option must be reachable
// by saying its number, and mirrored on screen for a sighted helper.
const MENU_LABELS = [
  'NFC payment',
  'Transfer money to someone',
  'Check your balance',
  'Account activity',
  'Cash deposit',
]
for (const label of MENU_LABELS) {
  if (home.includes(label)) pass(`menu option "${label}" is shown`)
  else fail(`menu option "${label}" is shown`, 'not found in markup')
}
if (home.includes('Say a number')) pass('menu invites a spoken number')
else fail('menu invites a spoken number', 'prompt not found')
// Mobile top-up was removed from the menu on request.
if (!home.includes('Mobile Load')) pass('mobile load is no longer offered on the menu')
else fail('mobile load is no longer offered on the menu', 'it is still rendered')

const splash = renderToString(
  <AppStateProvider>
    <AnnouncerProvider>
      <VoiceSessionProvider>
        <MemoryRouter initialEntries={['/']}>
          <App />
        </MemoryRouter>
      </VoiceSessionProvider>
    </AnnouncerProvider>
  </AppStateProvider>,
)
if (splash.includes('awazpay-logo.png')) pass('splash wordmark still rendered')
else fail('splash wordmark still rendered', 'logo not found in markup')

console.log(`\n${passed} passed, ${failed} failed\n`)
process.exit(failed > 0 ? 1 : 0)
