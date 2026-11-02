import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { _electron, type ElectronApplication, type Page } from 'playwright'
import { createServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'

export const repo = resolve(__dirname, '..', '..')
export const shotsDir = join(process.env['TEMP'] ?? tmpdir(), 'gas-e2e')

export interface Session {
  app: ElectronApplication
  page: Page
  root: string
  ws: string
  errors: string[]
  vite: ViteDevServer
  close: () => Promise<void>
}

export function build(): void {
  console.log('> electron-vite build')
  execSync('npx electron-vite build', { cwd: repo, stdio: 'inherit' })
}

// Renderer runs from a Vite dev server so tests can import the zustand stores by URL;
// the production bundle exposes no handle to navigate past the Codex setup screen.
async function startRenderer(): Promise<ViteDevServer> {
  const vite = await createServer({
    root: resolve(repo, 'src/renderer'),
    configFile: false,
    logLevel: 'error',
    plugins: [react()],
    resolve: { alias: { '@renderer': resolve(repo, 'src/renderer/src'), '@shared': resolve(repo, 'src/shared') } },
    server: { host: '127.0.0.1', port: 0, strictPort: false, fs: { allow: [repo] } }
  })
  await vite.listen()
  return vite
}

export async function launch(name: string): Promise<Session> {
  const root = join(tmpdir(), `gas-e2e-run-${name}-${process.pid}`)
  rmSync(root, { recursive: true, force: true })
  const userData = join(root, 'userData')
  const local = join(root, 'local')
  const ws = join(root, 'workspace')
  for (const d of [userData, local, ws]) mkdirSync(d, { recursive: true })
  writeFileSync(
    join(userData, 'settings.json'),
    JSON.stringify({
      lang: 'vi',
      workspace: ws,
      onboarding: { tours: { workspace: true, project: true, style: true }, sampleOffered: true },
      promo: { hints: false, dismissed: [] },
      setup: { completed: false, pathChoice: 'skipped', longPathSkipped: true, testGenOk: false }
    })
  )
  const vite = await startRenderer()
  const url = vite.resolvedUrls?.local[0]
  if (!url) throw new Error('vite did not report a url')
  const app = await _electron.launch({
    executablePath: require('electron') as string,
    args: [repo, `--user-data-dir=${userData}`],
    env: { ...process.env, LOCALAPPDATA: local, ELECTRON_RENDERER_URL: url } as Record<string, string>
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(10000)
  const errors: string[] = []
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text())
  })
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`))
  await page.waitForSelector('#root > *', { timeout: 30000 })
  const close = async (): Promise<void> => {
    try {
      await page.evaluate(() => window.gas.window.close()).catch(() => undefined)
      await Promise.race([app.waitForEvent('close'), new Promise((r) => setTimeout(r, 8000))])
    } finally {
      await app.close().catch(() => undefined)
      await vite.close().catch(() => undefined)
      rmSync(root, { recursive: true, force: true })
    }
  }
  return { app, page, root, ws, errors, vite, close }
}

export async function shot(page: Page, name: string): Promise<string> {
  mkdirSync(shotsDir, { recursive: true })
  const p = join(shotsDir, `${name}.png`)
  await page.screenshot({ path: p })
  return p
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

export async function until<T>(fn: () => Promise<T | null | undefined | false>, what: string, ms = 15000): Promise<T> {
  const end = Date.now() + ms
  for (;;) {
    const v = await fn().catch(() => null)
    if (v) return v
    if (Date.now() > end) throw new Error(`timeout: ${what}`)
    await sleep(150)
  }
}

export async function store<T = unknown>(page: Page, mod: 'app' | 'workspace' | 'todo', body: string): Promise<T> {
  return (await page.evaluate(`import('/src/store/${mod}.ts').then((m) => { ${body} })`)) as T
}

export async function gotoWorkspace(page: Page): Promise<void> {
  await store(page, 'app', `m.useApp.getState().navigate('workspace')`)
  await page.waitForSelector('.mhead', { timeout: 15000 })
}

export function exists(p: string): boolean {
  return existsSync(p)
}
