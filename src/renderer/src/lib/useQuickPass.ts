import { useEffect, useState } from 'react'

export interface QuickPass {
  active: boolean
  available: number
  total: number
  done: number
  start: () => void
  exit: () => void
}

interface Options<T> {
  items: T[]
  keyOf: (x: T) => string
  pending: (x: T) => boolean
  goto: (key: string) => void
  scope: string
  onFinish: () => void
}

export function useQuickPass<T>({ items, keyOf, pending, goto, scope, onFinish }: Options<T>): QuickPass {
  const [keys, setKeys] = useState<string[] | null>(null)
  const [at, setAt] = useState(0)
  const live = new Set(items.filter(pending).map(keyOf))
  const left = keys ? keys.filter((k) => live.has(k)).length : 0

  useEffect(() => setKeys(null), [scope])

  useEffect(() => {
    if (!keys) return
    if (!items.length) return setKeys(null)
    if (live.has(keys[at])) return
    const after = keys.findIndex((k, i) => i > at && live.has(k))
    const idx = after >= 0 ? after : keys.findIndex((k) => live.has(k))
    if (idx < 0) {
      setKeys(null)
      onFinish()
      return
    }
    setAt(idx)
    goto(keys[idx])
  })

  return {
    active: !!keys,
    available: live.size,
    total: keys?.length ?? 0,
    done: keys ? keys.length - left : 0,
    start: () => {
      const ks = items.filter(pending).map(keyOf)
      if (!ks.length) return
      setKeys(ks)
      setAt(0)
      goto(ks[0])
    },
    exit: () => setKeys(null)
  }
}
