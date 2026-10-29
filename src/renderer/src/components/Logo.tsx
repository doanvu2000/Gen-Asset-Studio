import type { ReactElement } from 'react'
import logoUrl from '@renderer/assets/logo.png'

export function Logo({ className = 'logo' }: { className?: string }): ReactElement {
  return <img src={logoUrl} className={className} alt="" aria-hidden="true" draggable={false} />
}
