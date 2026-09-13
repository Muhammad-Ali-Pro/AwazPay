import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { useAppState } from '../state/store'

interface AccessibleButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  children: ReactNode
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost'
  fullWidth?: boolean
}

const VARIANT_CLASSES: Record<NonNullable<AccessibleButtonProps['variant']>, string> = {
  primary: 'bg-violet text-white hover:bg-violet-dim focus-visible:outline-cyan shadow-glow',
  secondary: 'bg-midnight-700 text-white border border-white/10 hover:bg-midnight-600 focus-visible:outline-cyan',
  danger: 'bg-danger/90 text-white hover:bg-danger focus-visible:outline-white',
  ghost: 'bg-transparent text-white/80 border border-white/15 hover:bg-white/5 focus-visible:outline-cyan',
}

export function AccessibleButton({
  children,
  variant = 'primary',
  fullWidth = true,
  className = '',
  ...props
}: AccessibleButtonProps) {
  const { settings } = useAppState()
  const sizeClasses = settings.largeControls ? 'min-h-[76px] text-xl px-8' : 'min-h-[60px] text-lg px-6'

  return (
    <button
      type="button"
      className={`${sizeClasses} ${fullWidth ? 'w-full' : ''} rounded-2xl font-semibold tracking-wide transition-colors duration-150 focus-visible:outline focus-visible:outline-4 focus-visible:outline-offset-2 disabled:opacity-40 disabled:cursor-not-allowed ${VARIANT_CLASSES[variant]} ${className}`}
      {...props}
    >
      {children}
    </button>
  )
}
