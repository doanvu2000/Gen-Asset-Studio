import { app } from 'electron'
import { join } from 'node:path'
import { storageConfig } from './storage/config'

function localAppData(): string {
  return process.env['LOCALAPPDATA'] || app.getPath('appData')
}

export const DATA_DIR_NAME = 'GenAssetStudio'
export const defaultAppDataDir = join(localAppData(), DATA_DIR_NAME)
export const appDataDir = storageConfig().dataRoot || defaultAppDataDir
export const customDataDir = appDataDir.toLowerCase() !== defaultAppDataDir.toLowerCase()
export const codexRoot = join(appDataDir, 'codex')
export const codexReleasesDir = join(codexRoot, 'releases')
export const codexCurrentDir = join(codexRoot, 'current')
export const codexDownloadsDir = join(codexRoot, 'downloads')
export const logsDir = join(appDataDir, 'logs')
export const testGenDir = join(appDataDir, 'test-gen')
export const cacheDir = join(appDataDir, 'cache')
export const inputCacheDir = join(cacheDir, 'codex-input')
export const defaultCodexHome = join(appDataDir, 'codex-home')
export const codexHomeOverridden = Boolean(process.env['GAS_CODEX_HOME'])
export const codexHome = process.env['GAS_CODEX_HOME'] || defaultCodexHome
export const codexImagesDir = join(codexHome, 'generated_images')
export const codexSessionsDir = join(codexHome, 'sessions')
export const updaterCacheDir = join(localAppData(), 'gen-asset-studio-updater')

export function pathEntryFor(root: string): string {
  return root.toLowerCase() === defaultAppDataDir.toLowerCase() ? `%LOCALAPPDATA%\\${DATA_DIR_NAME}\\codex\\current\\bin` : join(root, 'codex', 'current', 'bin')
}

export const userPathEntry = pathEntryFor(appDataDir)
export const userPathExpanded = join(codexCurrentDir, 'bin')
