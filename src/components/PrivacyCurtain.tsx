import type { ReactNode } from 'react'

interface PrivacyCurtainProps {
  /** Short non-sensitive line describing what is happening. */
  message?: string
  detail?: string
  children?: ReactNode
}

/**
 * The screen half of "the screen is quiet, the voice is the interface".
 *
 * Wherever a conventional banking app would print a balance, an amount, a
 * payee or a one-time code, AwazPay renders this instead. Nothing sensitive
 * passes through it, by construction: it takes no financial values.
 */
export function PrivacyCurtain({
  message = 'Please listen privately',
  detail = 'Your financial information is being delivered through voice guidance.',
  children,
}: PrivacyCurtainProps) {
  return (
    <section
      className="w-full rounded-3xl border border-white/10 bg-midnight-800/70 px-6 py-7 text-center backdrop-blur"
      aria-label="Private audio delivery"
    >
      <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-cyan/10" aria-hidden="true">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
          <path d="M4 15v-3a8 8 0 0116 0v3" stroke="#00C896" strokeWidth={2} strokeLinecap="round" />
          <rect x="2.5" y="14" width="4.5" height="6.5" rx="2.25" stroke="#00C896" strokeWidth={2} />
          <rect x="17" y="14" width="4.5" height="6.5" rx="2.25" stroke="#00C896" strokeWidth={2} />
        </svg>
      </span>
      <p className="mt-4 text-lg font-semibold text-white">{message}</p>
      <p className="mt-2 text-sm leading-relaxed text-white/60">{detail}</p>
      {children && <div className="mt-5">{children}</div>}
    </section>
  )
}
