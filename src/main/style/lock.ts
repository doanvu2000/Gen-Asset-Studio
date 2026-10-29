import { existsSync, promises as fs } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { LockRequest, StyleGroup } from '@shared/style'
import type { SuggestService } from './suggest'
import type { TemplateStore } from './templates'

export function groupStyleDir(projectPath: string, groupId: string): string {
  if (!groupId || /[\\/]|\.\./.test(groupId)) throw new Error('Invalid style group id')
  return join(projectPath, 'styles', groupId)
}

export function lockRelPath(groupId: string): string {
  return `styles/${groupId}/lock.png`
}

export function resolveProjectFile(projectPath: string, p: string): string {
  return isAbsolute(p) ? p : join(projectPath, ...p.split('/'))
}

export async function lockStyle(req: LockRequest, deps: { suggest: SuggestService; templates: TemplateStore }): Promise<StyleGroup> {
  const { projectPath, group, source } = req
  let preview: string | null = null
  let promptEn = ''
  let templateId: string | undefined = group.templateId
  if (source.kind === 'suggestion') {
    const run = await deps.suggest.getRun(source.projectPath, source.runId)
    if (!run) throw new Error(`Suggestion run ${source.runId} not found`)
    const s = run.suggestions.find((x) => x.id === source.suggestionId)
    if (!s) throw new Error(`Suggestion ${source.suggestionId} not found`)
    if (s.status !== 'done' || !s.previewPath) throw new Error(`Suggestion "${s.name}" has no preview image to lock`)
    preview = s.previewPath
    promptEn = s.promptEn
    templateId = undefined
  } else {
    const t = await deps.templates.get(source.templateId)
    if (!t) throw new Error(`Template ${source.templateId} not found`)
    if (!t.previewPath) throw new Error(`Template "${t.name.en}" has no preview image to lock`)
    preview = t.previewPath
    promptEn = t.promptEn
    templateId = t.id
  }
  if (!existsSync(preview)) throw new Error(`Preview image is missing: ${preview}`)
  const dir = groupStyleDir(projectPath, group.id)
  await fs.mkdir(dir, { recursive: true })
  const out = join(dir, 'lock.png')
  const tmp = `${out}.${process.pid}.tmp`
  await fs.copyFile(preview, tmp)
  await fs.rename(tmp, out)
  const next: StyleGroup = { ...group, promptEn, lockImage: lockRelPath(group.id) }
  if (templateId) next.templateId = templateId
  else delete next.templateId
  return next
}

export async function unlockStyle(projectPath: string, group: StyleGroup): Promise<StyleGroup> {
  const file = join(groupStyleDir(projectPath, group.id), 'lock.png')
  await fs.rm(file, { force: true })
  const next: StyleGroup = { ...group }
  delete next.lockImage
  delete next.lockPrompt
  return next
}
