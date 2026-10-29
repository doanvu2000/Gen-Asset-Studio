export const IPC = {
  appInfo: 'app:info',
  winMinimize: 'win:minimize',
  winToggleMaximize: 'win:toggle-maximize',
  winClose: 'win:close',
  winIsMaximized: 'win:is-maximized',
  winMaximizedChanged: 'win:maximized-changed',
  settingsGet: 'settings:get',
  settingsSet: 'settings:set',
  settingsChanged: 'settings:changed',
  themeSystemDark: 'theme:system-dark',
  themeSystemChanged: 'theme:system-changed'
} as const
