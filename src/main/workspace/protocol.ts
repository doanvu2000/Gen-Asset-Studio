import { net, protocol } from 'electron'
import { imageMime } from '@shared/imageFormats'
import { existsSync } from 'node:fs'
import { pathToFileURL } from 'node:url'

export const FILE_SCHEME = 'gas-file'

export function fileUrl(abs: string, version?: string): string {
  const id = Buffer.from(abs, 'utf8').toString('base64url')
  return `${FILE_SCHEME}://local/${id}${version ? `?v=${encodeURIComponent(version)}` : ''}`
}

export function registerFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: FILE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }
  ])
}

export function handleFileScheme(isAllowed: (abs: string) => boolean): void {
  protocol.handle(FILE_SCHEME, async (request) => {
    let abs: string
    try {
      const u = new URL(request.url)
      abs = Buffer.from(u.pathname.replace(/^\//, ''), 'base64url').toString('utf8')
    } catch {
      return new Response('bad request', { status: 400 })
    }
    const mime = imageMime(abs)
    if (!mime || !isAllowed(abs)) return new Response('forbidden', { status: 403 })
    if (!existsSync(abs)) return new Response('not found', { status: 404 })
    const res = await net.fetch(pathToFileURL(abs).toString())
    const headers = new Headers(res.headers)
    headers.set('Content-Type', mime)
    headers.set('Cache-Control', 'no-cache')
    return new Response(res.body, { status: res.status, headers })
  })
}
