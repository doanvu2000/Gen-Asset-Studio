import { net, protocol } from 'electron'
import { imageMime } from '@shared/imageFormats'
import { existsSync, promises as fs } from 'node:fs'
import { dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { makeThumb } from './analyze'

export const FILE_SCHEME = 'gas-file'

export function fileUrl(abs: string, version?: string, thumbOf?: string): string {
  const id = Buffer.from(abs, 'utf8').toString('base64url')
  const query = [version ? `v=${encodeURIComponent(version)}` : '', thumbOf ? `src=${Buffer.from(thumbOf, 'utf8').toString('base64url')}` : ''].filter(Boolean).join('&')
  return `${FILE_SCHEME}://local/${id}${query ? `?${query}` : ''}`
}

export function registerFileScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: FILE_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } }
  ])
}

export function handleFileScheme(isAllowed: (abs: string) => boolean): void {
  protocol.handle(FILE_SCHEME, async (request) => {
    let abs: string
    let thumbOf: string | null = null
    try {
      const u = new URL(request.url)
      abs = Buffer.from(u.pathname.replace(/^\//, ''), 'base64url').toString('utf8')
      const src = u.searchParams.get('src')
      if (src) thumbOf = Buffer.from(src, 'base64url').toString('utf8')
    } catch {
      return new Response('bad request', { status: 400 })
    }
    const mime = imageMime(abs)
    if (!mime || !isAllowed(abs)) return new Response('forbidden', { status: 403 })
    if (!existsSync(abs) && thumbOf && imageMime(thumbOf) && isAllowed(thumbOf)) {
      try {
        await fs.mkdir(dirname(abs), { recursive: true })
        await makeThumb(thumbOf, abs)
      } catch {
        return new Response('not found', { status: 404 })
      }
    }
    if (!existsSync(abs)) return new Response('not found', { status: 404 })
    const res = await net.fetch(pathToFileURL(abs).toString())
    const headers = new Headers(res.headers)
    headers.set('Content-Type', mime)
    headers.set('Cache-Control', 'no-cache')
    headers.set('Access-Control-Allow-Origin', '*')
    return new Response(res.body, { status: res.status, headers })
  })
}
