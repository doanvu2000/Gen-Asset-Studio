import type { CoachPlacement, CoachStep } from '@renderer/components/CoachMarks'

export type TourId = 'workspace' | 'project' | 'style'

export const TOUR_IDS: readonly TourId[] = ['workspace', 'project', 'style']

export const COACH = {
  wsTree: 'ws-tree',
  wsSample: 'ws-sample',
  wsNewProject: 'ws-new-project',
  wsQueue: 'ws-queue',
  wsSettings: 'ws-settings',
  projSteps: 'proj-steps',
  projStepInput: 'proj-step-input',
  projStepStyle: 'proj-step-style',
  projStepGen: 'proj-step-gen',
  projStepReview: 'proj-step-review',
  projStepExport: 'proj-step-export',
  projInputAdd: 'proj-input-add',
  styleGroups: 'style-groups',
  styleTemplates: 'style-templates',
  styleLock: 'style-lock',
  genStart: 'gen-start',
  reviewGrid: 'review-grid',
  exportRun: 'export-run'
} as const

export type CoachId = (typeof COACH)[keyof typeof COACH]

export function sel(id: CoachId): string {
  return `[data-coach="${id}"]`
}

interface Def {
  id: string
  targets: CoachId[]
  placement?: CoachPlacement
  padding?: number
}

const DEFS: Record<TourId, Def[]> = {
  workspace: [
    { id: 'tree', targets: [COACH.wsTree], placement: 'right' },
    { id: 'sample', targets: [COACH.wsSample], placement: 'bottom' },
    { id: 'newProject', targets: [COACH.wsNewProject], placement: 'bottom' },
    { id: 'queue', targets: [COACH.wsQueue], placement: 'top' },
    { id: 'settings', targets: [COACH.wsSettings], placement: 'auto' }
  ],
  project: [
    { id: 'steps', targets: [COACH.projSteps], placement: 'bottom' },
    { id: 'input', targets: [COACH.projInputAdd, COACH.projStepInput], placement: 'auto' },
    { id: 'style', targets: [COACH.styleGroups, COACH.projStepStyle], placement: 'bottom' },
    { id: 'gen', targets: [COACH.genStart, COACH.projStepGen], placement: 'bottom' },
    { id: 'review', targets: [COACH.reviewGrid, COACH.projStepReview], placement: 'bottom' },
    { id: 'export', targets: [COACH.exportRun, COACH.projStepExport], placement: 'bottom' }
  ],
  style: [
    { id: 'groups', targets: [COACH.styleGroups], placement: 'bottom' },
    { id: 'templates', targets: [COACH.styleTemplates], placement: 'auto' },
    { id: 'lock', targets: [COACH.styleLock], placement: 'top' }
  ]
}

export function tourSteps(tour: TourId): CoachStep[] {
  return DEFS[tour].map((d) => ({
    id: d.id,
    target: d.targets.map(sel),
    title: `coach.${tour}.${d.id}.title`,
    body: `coach.${tour}.${d.id}.body`,
    placement: d.placement ?? 'auto',
    padding: d.padding
  }))
}

export function coachAttr(id: CoachId): { 'data-coach': CoachId } {
  return { 'data-coach': id }
}
