import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AppShell } from './components/AppShell'
import { Splash } from './screens/Splash'
import { Onboarding } from './screens/Onboarding'
import { Home } from './screens/Home'
import { PaymentFlow } from './screens/PaymentFlow'
import { BalanceInquiry } from './screens/BalanceInquiry'
import { ReceiveMoney } from './screens/ReceiveMoney'
import { TransactionHistory } from './screens/TransactionHistory'
import { MobileTopUp } from './screens/MobileTopUp'
import { CashAssist } from './screens/CashAssist'
import { NfcPayment } from './screens/NfcPayment'
import { TrustedCircle } from './screens/TrustedCircle'
import { Settings } from './screens/Settings'
import { useAppState } from './state/store'

export default function App() {
  const { settings } = useAppState()

  // Mirror the accessibility preferences onto the document so the CSS hooks
  // in index.css can respond to them.
  useEffect(() => {
    document.documentElement.dataset.highContrast = String(settings.highContrast)
    document.documentElement.dataset.largeControls = String(settings.largeControls)
  }, [settings.highContrast, settings.largeControls])

  return (
    <Routes>
      <Route path="/" element={<Splash />} />
      <Route path="/onboarding" element={<Onboarding />} />

      <Route element={<AppShell />}>
        <Route path="/home" element={<Home />} />
        <Route path="/payment" element={<PaymentFlow />} />
        <Route path="/balance" element={<BalanceInquiry />} />
        <Route path="/receive" element={<ReceiveMoney />} />
        <Route path="/history" element={<TransactionHistory />} />
        <Route path="/topup" element={<MobileTopUp />} />
        <Route path="/cash-assist" element={<CashAssist />} />
        <Route path="/nfc" element={<NfcPayment />} />
        <Route path="/trusted-circle" element={<TrustedCircle />} />
        <Route path="/settings" element={<Settings />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
