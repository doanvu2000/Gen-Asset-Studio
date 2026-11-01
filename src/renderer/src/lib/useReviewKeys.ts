import { useEffect, useRef } from 'react'

export type ReviewKeyMap = Record<string, () => void>

function typing(el: HTMLElement | null): boolean {
  if (!el) return false
  const tag = el.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable
}

/** Keys are KeyboardEvent.key values; single letters are matched case-insensitively. */
export function useReviewKeys(map: ReviewKeyMap, enabled = true): void {
  const ref = useRef(map)
  ref.current = map

  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.isComposing || e.defaultPrevented) return
      if (typing(e.target as HTMLElement | null) || document.querySelector('.modal-root')) return
      const fn = ref.current[e.key.length === 1 ? e.key.toLowerCase() : e.key]
      if (!fn) return
      e.preventDefault()
      if (!e.repeat) fn()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}
