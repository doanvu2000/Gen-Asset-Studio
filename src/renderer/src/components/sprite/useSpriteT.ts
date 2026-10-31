import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'

type LooseT = (key: string, opts?: Record<string, unknown>) => string

export function useSpriteT(): LooseT {
  const { t } = useTranslation()
  return useCallback<LooseT>((key, opts) => (t as unknown as LooseT)(`sprite.${key}`, opts), [t])
}
