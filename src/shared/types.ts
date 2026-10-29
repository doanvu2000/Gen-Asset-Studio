export type ThemePref = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'
export type Lang = 'vi' | 'en'

export interface AppSettings {
  theme: ThemePref
  lang: Lang
}

export const DEFAULT_SETTINGS: AppSettings = {
  theme: 'light',
  lang: 'vi'
}

export interface AppInfo {
  version: string
  platform: string
}

export type Unsubscribe = () => void

export interface GasApi {
  app: {
    info: () => Promise<AppInfo>
  }
  window: {
    minimize: () => void
    toggleMaximize: () => void
    close: () => void
    isMaximized: () => Promise<boolean>
    onMaximizedChange: (cb: (maximized: boolean) => void) => Unsubscribe
  }
  settings: {
    get: () => Promise<AppSettings>
    set: (patch: Partial<AppSettings>) => Promise<AppSettings>
    onChange: (cb: (settings: AppSettings) => void) => Unsubscribe
  }
  theme: {
    systemDark: () => Promise<boolean>
    onSystemChange: (cb: (dark: boolean) => void) => Unsubscribe
  }
}
