import type { StyleGroup } from '@shared/style'
import type { InputView, ProjectView } from '@shared/workspace'

export function isLocked(g: StyleGroup): boolean {
  return !!g.lockImage || g.lockPrompt === true
}

export function styleReady(p: ProjectView): boolean {
  return p.groups.some((g) => isLocked(g) && g.assetIds.length > 0)
}

export function groupOf(p: ProjectView): Map<string, StyleGroup> {
  const m = new Map<string, StyleGroup>()
  for (const g of p.groups) for (const id of g.assetIds) m.set(id, g)
  return m
}

export function gennable(p: ProjectView): Array<{ input: InputView; group: StyleGroup }> {
  const byId = new Map(p.inputs.map((i) => [i.id, i]))
  const out: Array<{ input: InputView; group: StyleGroup }> = []
  for (const g of p.groups) {
    if (!isLocked(g)) continue
    for (const id of g.assetIds) {
      const input = byId.get(id)
      if (input && input.type !== 'sprite' && input.status !== 'missing') out.push({ input, group: g })
    }
  }
  return out
}

export function hasVersions(p: ProjectView): boolean {
  return p.inputs.some((i) => i.versions.length > 0)
}
