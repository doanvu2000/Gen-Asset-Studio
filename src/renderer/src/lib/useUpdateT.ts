import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import type { UpdateKey, UpdateVars } from './updateText'

export function useUpdateT(): (k: UpdateKey, v?: UpdateVars) => string {
  const { t } = useTranslation()
  return useCallback((k: UpdateKey, v?: UpdateVars) => t(`update.${k}`, v ?? {}), [t])
}
