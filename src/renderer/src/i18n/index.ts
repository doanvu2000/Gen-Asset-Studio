import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import type { Lang } from '@shared/types'
import vi from './vi.json'
import en from './en.json'

export const resources = {
  vi: { translation: vi },
  en: { translation: en }
} as const

export async function initI18n(lang: Lang): Promise<void> {
  await i18n.use(initReactI18next).init({
    resources,
    lng: lang,
    fallbackLng: 'vi',
    interpolation: { escapeValue: false },
    returnNull: false
  })
  document.documentElement.lang = lang
}

export async function changeLang(lang: Lang): Promise<void> {
  await i18n.changeLanguage(lang)
  document.documentElement.lang = lang
}

export default i18n
