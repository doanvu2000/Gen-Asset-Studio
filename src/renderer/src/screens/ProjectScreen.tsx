import type { ReactElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { StepIntro } from '@renderer/components/StepIntro'
import { useTranslation } from 'react-i18next'
import type { ProjectView } from '@shared/workspace'
import { Icon } from '@renderer/components/Icon'
import { EASE, viewTransition } from '@renderer/lib/motion'
import { useWs } from '@renderer/store/workspace'
import { InputStep } from './InputStep'
import { StyleStep } from './StyleStep'
import { GenStep } from './GenStep'
import { ReviewStep } from './ReviewStep'
import { ExportStep } from './ExportStep'
import { SpriteProjectScreen } from './sprite/SpriteProjectScreen'
import { useApp } from '@renderer/store/app'
import { relTime } from '@renderer/lib/format'
import { useNow } from '@renderer/lib/useNow'
import { approvedCount } from '@renderer/lib/review'
import { hasVersions, isLocked, styleReady } from '@renderer/lib/project'

const STEPS = ['input', 'style', 'gen', 'review', 'export'] as const
type StepKey = (typeof STEPS)[number]
const LOCK: Record<Exclude<StepKey, 'input'>, string> = { style: 'style', gen: 'gen', review: 'review', export: 'export' }

function canStep(p: ProjectView, n: number): true | string {
  if (n === 1) return true
  if (n === 2) return p.inputs.length ? true : LOCK.style
  if (n === 3) return p.inputs.length && styleReady(p) ? true : LOCK.gen
  if (n === 4) return hasVersions(p) ? true : LOCK.review
  return approvedCount(p) > 0 ? true : LOCK.export
}

function StepBar({ p }: { p: ProjectView }): ReactElement {
  const { t } = useTranslation()
  const step = useWs((s) => s.step)
  const setStep = useWs((s) => s.setStep)
  const lang = useApp((s) => s.settings.lang)
  const exported = p.export.lastAt > 0
  useNow(exported, 30000)
  const subs = [
    t('project.sub.images', { count: p.inputs.length }),
    t('project.sub.groups', { locked: p.groups.filter(isLocked).length, total: p.groups.length }),
    t('project.sub.generated', { done: p.inputs.filter((i) => i.versions.length > 0).length, total: p.groups.filter(isLocked).reduce((n, g) => n + g.assetIds.length, 0) }),
    t('project.sub.approved', { count: approvedCount(p) }),
    exported ? t('project.sub.exported', { count: p.export.lastAssets, time: relTime(p.export.lastAt, lang) }) : t('project.sub.notExported')
  ]
  return (
    <div className="steps" role="tablist">
      {STEPS.map((key, i) => {
        const n = i + 1
        const ok = canStep(p, n)
        const locked = ok !== true
        const done = n < step || (n === STEPS.length && exported && !locked)
        const cur = step === n
        const cls = ['stp', cur && 'cur', done && !cur && 'done', locked && 'locked'].filter(Boolean).join(' ')
        return (
          <div className="stp-wrap" key={key}>
            {i > 0 && (
              <div className={n <= step ? 'stp-line done' : 'stp-line'}>
                <i />
              </div>
            )}
            <button
              type="button"
              className={cls}
              role="tab"
              data-coach={`proj-step-${key}`}
              aria-selected={cur}
              aria-disabled={locked || undefined}
              title={locked ? t(`project.lock.${ok as Exclude<StepKey, 'input'>}`) : undefined}
              onClick={() => !locked && setStep(n)}
            >
              <span className="num">{done && !cur ? <Icon name="check" size={13} /> : locked ? <Icon name="lock" size={12} /> : n}</span>
              <span>
                <b>{t(`project.steps.${key}`)}</b>
                <small>{subs[i]}</small>
              </span>
            </button>
          </div>
        )
      })}
    </div>
  )
}

function Soon({ step }: { step: StepKey }): ReactElement {
  const { t } = useTranslation()
  const setStep = useWs((s) => s.setStep)
  return (
    <div className="soon">
      <motion.div className="soon-card" initial={{ opacity: 0, y: 12, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.32, ease: EASE, delay: 0.05 }}>
        <div className="soon-ic">
          <Icon name="sparkles" size={26} />
        </div>
        <span className="chip c-blue">{t('project.soon.title')}</span>
        <h2>{t(`project.steps.${step}`)}</h2>
        <p>{t('project.soon.desc', { step: t(`project.steps.${step}`) })}</p>
        <button type="button" className="btn" onClick={() => setStep(1)}>
          <Icon name="left" size={14} />
          {t('project.soon.back')}
        </button>
      </motion.div>
    </div>
  )
}

export function ProjectScreen(): ReactElement {
  const { t } = useTranslation()
  const project = useWs((s) => s.project)
  const loading = useWs((s) => s.loading)
  const step = useWs((s) => s.step)
  const closeProject = useWs((s) => s.closeProject)
  const reloadProject = useWs((s) => s.reloadProject)
  const setStep = useWs((s) => s.setStep)
  const defaultScale = useApp((s) => s.settings.gen.scale)
  const dir = useWs((s) => s.stepDir)

  if (loading) {
    return (
      <div className="proj-state">
        <span className="spin" />
        <span className="muted">{t('project.loading')}</span>
      </div>
    )
  }
  if (!project) {
    return (
      <div className="proj-state">
        <div className="empty">
          <Icon name="alert" size={34} />
          <h3>{t('project.notFound')}</h3>
          <p>{t('project.notFoundDesc')}</p>
          <div className="actions">
            <button type="button" className="btn" onClick={closeProject}>
              <Icon name="left" size={14} />
              {t('project.backToAll')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (project.kind === 'sprite') return <SpriteProjectScreen project={project} />
  if (project.kind === 'spine') {
    return (
      <div className="proj-state">
        <div className="empty">
          <Icon name="layers" size={34} />
          <h3>{t('kinds.spine.name')} · {t('kinds.soon')}</h3>
          <p>{t('dialogs.newProject.hint_spine')}</p>
          <div className="actions">
            <button type="button" className="btn" onClick={closeProject}>
              <Icon name="left" size={14} />
              {t('project.backToAll')}
            </button>
          </div>
        </div>
      </div>
    )
  }

  const key = STEPS[step - 1]
  return (
    <>
      <StepBar p={project} />
      <div className="pbody">
        <AnimatePresence initial={false} custom={dir} mode="popLayout">
          <motion.div
            key={key}
            className="pstep"
            custom={dir}
            variants={{
              enter: (d: number) => ({ opacity: 0, x: 16 * d }),
              center: { opacity: 1, x: 0 },
              exit: (d: number) => ({ opacity: 0, x: -12 * d })
            }}
            initial="enter"
            animate="center"
            exit="exit"
            transition={viewTransition}
          >
            <StepIntro step={key} n={step} total={STEPS.length} />
            {key === 'input' ? <InputStep project={project} /> : key === 'style' ? <StyleStep project={project} /> : key === 'gen' ? <GenStep project={project} /> : key === 'review' ? (
              <ReviewStep project={project} />
            ) : key === 'export' ? (
              <ExportStep project={project} api={window.gas.export} defaultScale={defaultScale} onBack={() => setStep(4)} onHome={closeProject} onExported={() => void reloadProject()} />
            ) : (
              <Soon step={key} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  )
}
