export interface UpdateRelease {
  version: string
  notes: string
  date: string | null
}

export type UpdateState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | ({ kind: 'available' } & UpdateRelease)
  | { kind: 'notAvailable' }
  | ({
      kind: 'downloading'
      percent: number
      bytesPerSecond: number
      transferred: number
      total: number
    } & UpdateRelease)
  | ({ kind: 'downloaded' } & UpdateRelease)
  | { kind: 'error'; message: string }
  | { kind: 'dev' }

export type UpdateKind = UpdateState['kind']

export interface UpdateSnapshot {
  state: UpdateState
  currentVersion: string
  lastCheckedAt: number | null
  enabled: boolean
}

export interface UpdateActionResult {
  ok: boolean
  blocked?: boolean
  message?: string
}

export const UPDATE_IPC = {
  get: 'update:get',
  check: 'update:check',
  download: 'update:download',
  install: 'update:install',
  changed: 'update:changed'
} as const

export interface UpdateApi {
  get: () => Promise<UpdateSnapshot>
  check: () => Promise<UpdateActionResult>
  download: () => Promise<UpdateActionResult>
  install: () => Promise<UpdateActionResult>
  onChange: (cb: (snapshot: UpdateSnapshot) => void) => () => void
}

export type NoteSectionKind = 'update' | 'add' | 'remove' | 'fixbug' | 'other'

export interface NoteSection {
  kind: NoteSectionKind
  title: string
  items: string[]
}

const SECTION_KINDS: Record<string, NoteSectionKind> = {
  update: 'update',
  add: 'add',
  remove: 'remove',
  fixbug: 'fixbug',
  'fix bug': 'fixbug',
  fix: 'fixbug'
}

function cleanInline(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()
}

export function parseReleaseNotes(markdown: string): NoteSection[] {
  const sections: NoteSection[] = []
  let current: NoteSection | null = null
  for (const raw of markdown.replace(/\r\n/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    const heading = /^#{1,6}\s+(.+)$/.exec(line)
    if (heading) {
      const title = cleanInline(heading[1])
      const kind = SECTION_KINDS[title.toLowerCase()]
      if (kind) {
        current = { kind, title, items: [] }
        sections.push(current)
      } else {
        current = null
      }
      continue
    }
    const bullet = /^[-*+]\s+(.+)$/.exec(line)
    const text = cleanInline(bullet ? bullet[1] : line)
    if (!text) continue
    if (!current) {
      current = { kind: 'other', title: '', items: [] }
      sections.push(current)
    }
    current.items.push(text)
  }
  return sections.filter((s) => s.items.length > 0)
}

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' '
}

export function htmlNotesToMarkdown(input: string): string {
  if (!/<[a-z][\s\S]*>/i.test(input)) return input
  return input
    .replace(/\r\n/g, '\n')
    .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_m, level: string, body: string) => `\n${'#'.repeat(Number(level))} ${body}\n`)
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, (_m, body: string) => `\n- ${body.replace(/\s*\n\s*/g, ' ')}\n`)
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (m, code: string) => {
      if (code[0] === '#') {
        const n = code[1] === 'x' || code[1] === 'X' ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10)
        return Number.isFinite(n) ? String.fromCodePoint(n) : m
      }
      return ENTITIES[code.toLowerCase()] ?? m
    })
    .split('\n')
    .map((l) => l.trim())
    .filter((l, i, arr) => l !== '' || (i > 0 && arr[i - 1] !== ''))
    .join('\n')
    .trim()
}
