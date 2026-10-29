import { useId, type ReactElement } from 'react'

export function Logo({ className = 'logo' }: { className?: string }): ReactElement {
  const gid = useId()
  return (
    <svg viewBox="0 0 64 64" className={className} aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#5AC8FA" />
          <stop offset="1" stopColor="#007AFF" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="60" height="60" rx="14" fill={`url(#${gid})`} />
      <rect x="14" y="20" width="26" height="26" rx="7" fill="#fff" opacity=".35" />
      <rect x="22" y="14" width="28" height="28" rx="7" fill="#fff" />
      <path d="M36 20l2 5 5 2-5 2-2 5-2-5-5-2 5-2z" fill="#007AFF" />
    </svg>
  )
}
