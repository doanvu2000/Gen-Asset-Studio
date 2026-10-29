import { create } from 'zustand'
import { DEFAULT_SETTINGS, type AppSettings, type Lang, type ResolvedTheme, type ThemePref } from '@shared/types'
import { changeLang } from '@renderer/i18n'

export type Route = 'setup' | 'workspace' | 'project'
export type SettingsTab = 'general' | 'gen' | 'account' | 'env'

interface AppState {
  route: Route
  direction: 1 | -1
  settings: AppSettings
  systemDark: boolean
  maximized: boolean
  sidebarOpen: boolean
  settingsOpen: boolean
  settingsTab: SettingsTab
  navigate: (route: Route) => void
  hydrate: (settings: AppSettings, systemDark: boolean, maximized: boolean) => void
  applySettings: (settings: AppSettings) => void
  setSystemDark: (dark: boolean) => void
  setMaximized: (maximized: boolean) => void
  setTheme: (theme: ThemePref) => Promise<void>
  setLang: (lang: Lang) => Promise<void>
  toggleSidebar: () => void
  openSettings: (tab?: SettingsTab) => void
  setSettingsTab: (tab: SettingsTab) => void
  closeSettings: () => void
}

const ORDER: Route[] = ['setup', 'workspace', 'project']

export const useApp = create<AppState>()((set, get) => ({
  route: 'setup',
  direction: 1,
  settings: { ...DEFAULT_SETTINGS },
  systemDark: false,
  maximized: false,
  sidebarOpen: true,
  settingsOpen: false,
  settingsTab: 'general',
  navigate: (route) => {
    const from = ORDER.indexOf(get().route)
    const to = ORDER.indexOf(route)
    if (from === to) return
    set({ route, direction: to > from ? 1 : -1 })
  },
  hydrate: (settings, systemDark, maximized) => set({ settings, systemDark, maximized }),
  applySettings: (settings) => {
    if (settings.lang !== get().settings.lang) void changeLang(settings.lang)
    set({ settings })
  },
  setSystemDark: (systemDark) => set({ systemDark }),
  setMaximized: (maximized) => set({ maximized }),
  setTheme: async (theme) => {
    set({ settings: { ...get().settings, theme } })
    get().applySettings(await window.gas.settings.set({ theme }))
  },
  setLang: async (lang) => {
    await changeLang(lang)
    set({ settings: { ...get().settings, lang } })
    get().applySettings(await window.gas.settings.set({ lang }))
  },
  toggleSidebar: () => set({ sidebarOpen: !get().sidebarOpen }),
  openSettings: (tab) => set({ settingsOpen: true, settingsTab: tab ?? get().settingsTab }),
  setSettingsTab: (settingsTab) => set({ settingsTab }),
  closeSettings: () => set({ settingsOpen: false })
}))

export function selectResolvedTheme(s: Pick<AppState, 'settings' | 'systemDark'>): ResolvedTheme {
  if (s.settings.theme === 'system') return s.systemDark ? 'dark' : 'light'
  return s.settings.theme
}
