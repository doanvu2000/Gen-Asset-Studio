import { app } from 'electron'
import { join } from 'node:path'

function localAppData(): string {
  return process.env['LOCALAPPDATA'] || app.getPath('appData')
}

export const appDataDir = join(localAppData(), 'GenAssetStudio')
export const codexRoot = join(appDataDir, 'codex')
export const codexReleasesDir = join(codexRoot, 'releases')
export const codexCurrentDir = join(codexRoot, 'current')
export const codexDownloadsDir = join(codexRoot, 'downloads')
export const logsDir = join(appDataDir, 'logs')
export const testGenDir = join(appDataDir, 'test-gen')
export const defaultCodexHome = join(appDataDir, 'codex-home')
export const codexHomeOverridden = Boolean(process.env['GAS_CODEX_HOME'])
export const codexHome = process.env['GAS_CODEX_HOME'] || defaultCodexHome
export const userPathEntry = '%LOCALAPPDATA%\\GenAssetStudio\\codex\\current\\bin'
export const userPathExpanded = join(codexCurrentDir, 'bin')
