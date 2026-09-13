import type { ReactNode } from 'react'
import { AwazOrb } from './AwazOrb'
import type { OrbState } from '../types'

interface StageLayoutProps {
  orbState: OrbState
  eyebrow?: string
  heading: string
  caption: string
  icon?: string
  children?: ReactNode
}

export function StageLayout({ orbState, eyebrow, heading, caption, icon, children }: StageLayoutProps) {
  return (
    <div className="flex min-h-[70vh] flex-col items-center justify-center gap-6 text-center text-white">
      <AwazOrb state={orbState} size={200} label={caption} />
      <div>
        {eyebrow && <p className="text-xs font-semibold uppercase tracking-[0.25em] text-cyan">{eyebrow}</p>}
        <h1 className="mt-2 text-2xl font-bold">{heading}</h1>
        {icon && (
          <p className="mt-3 text-4xl" aria-hidden="true">
            {icon}
          </p>
        )}
        <p className="mt-3 max-w-xs text-white/70">{caption}</p>
      </div>
      {children && <div className="mt-4 w-full max-w-sm">{children}</div>}
    </div>
  )
}
