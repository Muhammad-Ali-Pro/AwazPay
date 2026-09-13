import { motion } from 'framer-motion'
import { useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppState } from '../state/store'

export function Splash() {
  const navigate = useNavigate()
  const { onboardingComplete } = useAppState()

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate(onboardingComplete ? '/home' : '/onboarding', { replace: true })
    }, 2200)
    return () => clearTimeout(timer)
  }, [navigate, onboardingComplete])

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-midnight-950 px-6 text-center text-white">
      <motion.div
        className="rounded-[2.5rem] bg-white p-8 shadow-orb"
        initial={{ opacity: 0, scale: 0.92 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.9, ease: 'easeOut' }}
      >
        {/* Rendered on its native light background: the wordmark's navy ink needs
            light contrast behind it, which the app's dark theme can't provide. */}
        <img src="/awazpay-logo.png" alt="AwazPay — Banking Beyond Sight." className="w-56 max-w-[60vw]" />
      </motion.div>
    </div>
  )
}
