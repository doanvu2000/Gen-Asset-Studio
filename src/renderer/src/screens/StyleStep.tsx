import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import { SUGGEST_MAX, SUGGEST_MIN, type PromptPolishResult, type StyleGroup, type StyleSuggestion, type StyleTemplate, type SuggestRun } from '@shared/style'
import type { InputView, ProjectView } from '@shared/workspace'
import { Icon } from '@renderer/components/Icon'
import { Modal } from '@renderer/components/Modal'
import { ModelChip } from '@renderer/components/ModelChip'
import { Stepper } from '@renderer/components/Stepper'
import { EASE, fadeTransition } from '@renderer/lib/motion'
import { errMsg, fileUrl, newGroupId, projAbs } from '@renderer/lib/files'
import { groupOf, isLocked, styleReady } from '@renderer/lib/project'
import { useApp } from '@renderer/store/app'
import { useEnv } from '@renderer/store/env'
import { useStyle } from '@renderer/store/style'
import { useWs } from '@renderer/store/workspace'
import { toast } from '@renderer/store/toast'
import { CoachTour } from '@renderer/components/CoachMarks'
import { tourSteps } from '@renderer/lib/tours'

type Pick = { kind: 'template'; id: string } | { kind: 'suggestion'; id: string } | null

const ONLY_PROMPT_FEEDBACK = "Use the user's own style description and/or reference images exactly as the single direction; do not invent a different style."

function lockUrl(p: ProjectView, g: StyleGroup): string | null {
  return g.lockImage ? fileUrl(projAbs(p.dir, g.lockImage), g.lockedAt ?? 0) : null
}

function Swatch({ project, group }: { project: ProjectView; group: StyleGroup }): ReactElement {
  const url = lockUrl(project, group)
  if (url) {
    return (
      <span className="gsw img">
        <img src={url} alt="" draggable={false} />
      </span>
    )
  }
  const pal = group.palette?.length ? group.palette : []
  return (
    <span className="gsw">
      {[0, 1, 2, 3].map((i) => (
        <i key={i} style={pal[i] ? { background: pal[i] } : undefined} />
      ))}
    </span>
  )
}

function Lightbox({ src, title, onClose }: { src: string | null; title: string; onClose: () => void }): ReactElement {
  const { t } = useTranslation()
  return (
    <Modal open={!!src} onClose={onClose} className="lightbox" label={title}>
      <header className="lb-h">
        <b>{title}</b>
        <div className="grow" />
        <button type="button" className="icon-btn" aria-label={t('dialogs.cancel')} onClick={onClose}>
          <Icon name="x" />
        </button>
      </header>
      <div className="lb-img ck">{src && <img src={src} alt={title} draggable={false} />}</div>
    </Modal>
  )
}

function AssetPicker({
  project,
  group,
  open,
  onClose
}: {
  project: ProjectView
  group: StyleGroup
  open: boolean
  onClose: () => void
}): ReactElement {
  const { t } = useTranslation()
  const updateGroups = useWs((s) => s.updateGroups)
  const owner = useMemo(() => groupOf(project), [project])
  const [sel, setSel] = useState<Set<string>>(new Set(group.assetIds))
  const [dir, setDir] = useState<string | null>(null)
  const [freeOnly, setFreeOnly] = useState(false)

  useEffect(() => {
    if (open) {
      setSel(new Set(group.assetIds))
      setDir(null)
      setFreeOnly(false)
    }
  }, [open, group.assetIds])

  const usable = project.inputs
  const dirs = useMemo(() => [...new Set(usable.map((i) => i.dir))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })), [usable])
  const visible = usable.filter((i) => (dir === null || i.dir === dir) && (!freeOnly || !owner.has(i.id) || owner.get(i.id)?.id === group.id))
  const allOn = visible.length > 0 && visible.every((i) => sel.has(i.id))
  const moving = [...sel].filter((id) => owner.has(id) && owner.get(id)?.id !== group.id).length

  const toggle = (id: string): void => {
    const next = new Set(sel)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSel(next)
  }

  const apply = (): void => {
    const ids = usable.filter((i) => sel.has(i.id)).map((i) => i.id)
    const set = new Set(ids)
    updateGroups((gs) => gs.map((g) => (g.id === group.id ? { ...g, assetIds: ids } : { ...g, assetIds: g.assetIds.filter((a) => !set.has(a)) })), true)
    toast(t('style.picker.applied', { count: ids.length, name: group.name }))
    onClose()
  }

  return (
    <Modal open={open} onClose={onClose} className="picker" label={t('style.picker.title')}>
      <header>
        <h2>{t('style.picker.title')}</h2>
        <span className="muted">{group.name}</span>
        <div className="grow" />
        <button type="button" className="icon-btn" aria-label={t('dialogs.cancel')} onClick={onClose}>
          <Icon name="x" />
        </button>
      </header>
      <div className="pk-bar">
        <div className="pk-dirs">
          <button type="button" className={dir === null ? 'pk-dir on' : 'pk-dir'} onClick={() => setDir(null)}>
            <Icon name="grid" size={13} />
            {t('input.all')}
            <span>{usable.length}</span>
          </button>
          {dirs.map((d) => (
            <button type="button" key={d || '.'} className={dir === d ? 'pk-dir on' : 'pk-dir'} onClick={() => setDir(d)} title={d}>
              <Icon name="folder" size={13} />
              {d || t('style.picker.root')}
              <span>{usable.filter((i) => i.dir === d).length}</span>
            </button>
          ))}
        </div>
        <div className="pk-acts">
          <label className="pk-check">
            <input type="checkbox" checked={freeOnly} onChange={(e) => setFreeOnly(e.target.checked)} />
            {t('style.picker.freeOnly')}
          </label>
          <div className="grow" />
          <button
            type="button"
            className="btn sm"
            onClick={() => {
              const next = new Set(sel)
              for (const i of visible) {
                if (allOn) next.delete(i.id)
                else next.add(i.id)
              }
              setSel(next)
            }}
          >
            {allOn ? t('input.deselect') : dir === null ? t('input.selectAll') : t('style.picker.selectFolder')}
          </button>
        </div>
      </div>
      <div className="pk-grid">
        {visible.map((i, idx) => {
          const other = owner.get(i.id)
          const on = sel.has(i.id)
          return (
            <motion.button
              type="button"
              key={i.id}
              className={on ? 'pk on' : 'pk'}
              onClick={() => toggle(i.id)}
              aria-pressed={on}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.24, ease: EASE, delay: Math.min(idx, 24) * 0.012 }}
            >
              <span className="thumb ck">{i.thumb ? <img src={i.thumb} alt="" draggable={false} /> : <Icon name="image" size={18} />}</span>
              <span className="pk-n" title={i.rel}>
                {i.name}
              </span>
              <span className="pk-g">{other && other.id !== group.id ? other.name : i.dir || '—'}</span>
              <span className="pk-tick">{on && <Icon name="check" size={11} />}</span>
            </motion.button>
          )
        })}
      </div>
      <footer>
        <span className="muted">
          {t('style.picker.count', { count: sel.size })}
          {moving > 0 && ` · ${t('style.picker.moving', { count: moving })}`}
        </span>
        <div className="grow" />
        <button type="button" className="btn" onClick={onClose}>
          {t('dialogs.cancel')}
        </button>
        <button type="button" className="btn primary" onClick={apply}>
          <Icon name="check" size={14} />
          {t('style.picker.apply')}
        </button>
      </footer>
    </Modal>
  )
}

export function PolishPanel({
  state,
  onUse,
  onAgain,
  onDrop
}: {
  state: { phase: 'loading' } | { phase: 'done'; result: PromptPolishResult; v: number } | { phase: 'error'; msg: string }
  onUse: () => void
  onAgain: () => void
  onDrop: () => void
}): ReactElement {
  const { t } = useTranslation()
  if (state.phase === 'loading') {
    return (
      <motion.div className="pfix" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={fadeTransition}>
        <div className="pf-h">
          <span className="spin" />
          {t('style.polish.loading')}
        </div>
      </motion.div>
    )
  }
  if (state.phase === 'error') {
    return (
      <motion.div className="pfix err" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={fadeTransition}>
        <div className="pf-h">
          <Icon name="alert" size={14} />
          {t('style.polish.failed')}
        </div>
        <div className="pf-err">{state.msg}</div>
        <div className="acts">
          <button type="button" className="btn sm" onClick={onAgain}>
            <Icon name="refresh" size={13} />
            {t('style.polish.again')}
          </button>
          <button type="button" className="btn sm ghost" onClick={onDrop}>
            {t('style.polish.close')}
          </button>
        </div>
      </motion.div>
    )
  }
  return (
    <motion.div className="pfix" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={fadeTransition}>
      <div className="pf-h">
        <Icon name="sparkles" size={14} />
        {t('style.polish.title')}
        <span className="vtag">v{state.v}</span>
      </div>
      <div className="en">{state.result.promptEn}</div>
      {state.result.changes.length > 0 && (
        <ul>
          {state.result.changes.map((c, i) => (
            <li key={i}>{c}</li>
          ))}
        </ul>
      )}
      <div className="acts">
        <button type="button" className="btn sm primary" onClick={onUse}>
          <Icon name="check" size={13} />
          {t('style.polish.use')}
        </button>
        <button type="button" className="btn sm" onClick={onAgain}>
          <Icon name="refresh" size={13} />
          {t('style.polish.again')}
        </button>
        <button type="button" className="btn sm ghost" onClick={onDrop}>
          {t('style.polish.keep')}
        </button>
      </div>
    </motion.div>
  )
}

function TemplateCard({
  tpl,
  on,
  locked,
  disabled,
  index,
  onPick,
  onZoom,
  onDelete
}: {
  tpl: StyleTemplate
  on: boolean
  locked: boolean
  disabled: boolean
  index: number
  onPick: () => void
  onZoom: () => void
  onDelete: () => void
}): ReactElement {
  const { t, i18n } = useTranslation()
  const lang = i18n.language === 'en' ? 'en' : 'vi'
  const cls = ['tpl', on && 'on', locked && 'locked'].filter(Boolean).join(' ')
  return (
    <motion.div
      className={cls}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28, ease: EASE, delay: index * 0.04 }}
    >
      <button type="button" className="tpl-hit" disabled={disabled} onClick={onPick} aria-pressed={on}>
        <span className="tpl-img">{tpl.previewSmPath ? <img src={fileUrl(tpl.previewSmPath)} alt="" draggable={false} loading="lazy" /> : <Icon name="palette" size={22} />}</span>
        <span className="tpl-b">
          <span className="tpl-t">
            {tpl.name[lang]}
            {!tpl.builtin && <span className="vtag">{t('style.tpl.mine')}</span>}
          </span>
          <span className="sw">
            {tpl.palette.slice(0, 6).map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </span>
        </span>
      </button>
      <span className="radio">{(on || locked) && <Icon name={locked ? 'lock' : 'check'} size={12} />}</span>
      <div className="tpl-tools">
        {tpl.previewPath && (
          <button type="button" className="icon-btn" aria-label={t('style.zoom')} title={t('style.zoom')} onClick={onZoom}>
            <Icon name="eye" size={14} />
          </button>
        )}
        {!tpl.builtin && (
          <button type="button" className="icon-btn" aria-label={t('style.tpl.delete')} title={t('style.tpl.delete')} onClick={onDelete}>
            <Icon name="trash" size={14} />
          </button>
        )}
      </div>
    </motion.div>
  )
}

function SuggestionCard({
  s,
  index,
  on,
  locked,
  disabled,
  onPick,
  onZoom
}: {
  s: StyleSuggestion
  index: number
  on: boolean
  locked: boolean
  disabled: boolean
  onPick: () => void
  onZoom: () => void
}): ReactElement {
  const { t, i18n } = useTranslation()
  const lang = i18n.language === 'en' ? 'en' : 'vi'
  const busy = s.status === 'pending' || s.status === 'running'
  const cls = ['sg', on && 'on', locked && 'locked', busy && 'busy', s.status === 'error' && 'err'].filter(Boolean).join(' ')
  return (
    <motion.div className={cls} initial={{ opacity: 0, y: 10, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.3, ease: EASE, delay: index * 0.06 }}>
      <button type="button" className="sg-hit" disabled={disabled || s.status !== 'done'} onClick={onPick} aria-pressed={on}>
        <span className="sheet-p ck">
          <AnimatePresence initial={false}>
            {s.previewPath && (
              <motion.img
                key={s.previewPath}
                src={fileUrl(s.previewPath, s.durationMs ?? 0)}
                alt=""
                draggable={false}
                initial={{ opacity: 0, scale: 1.02 }}
                animate={{ opacity: 1, scale: 1 }}
                transition={{ duration: 0.45, ease: EASE }}
              />
            )}
          </AnimatePresence>
          {busy && (
            <span className="busy-l">
              <span className="spin" />
              <small>{s.status === 'pending' ? t('style.sugg.waiting') : t('style.sugg.drawing')}</small>
            </span>
          )}
          {s.status === 'error' && (
            <span className="busy-l err" title={s.error ?? ''}>
              <Icon name="alert" size={20} />
              <small>{t('style.sugg.failed')}</small>
            </span>
          )}
        </span>
        <span className="sg-b">
          <span className="sg-t">{s.name}</span>
          <span className="sg-d">{s.summary[lang]}</span>
          <span className="sw">
            {s.palette.slice(0, 6).map((c) => (
              <i key={c} style={{ background: c }} />
            ))}
          </span>
        </span>
      </button>
      <span className="radio">{(on || locked) && <Icon name={locked ? 'lock' : 'check'} size={12} />}</span>
      {s.previewPath && (
        <div className="tpl-tools">
          <button type="button" className="icon-btn" aria-label={t('style.zoom')} title={t('style.zoom')} onClick={onZoom}>
            <Icon name="eye" size={14} />
          </button>
        </div>
      )}
    </motion.div>
  )
}

function GroupEditor({ project, group }: { project: ProjectView; group: StyleGroup }): ReactElement {
  const { t, i18n } = useTranslation()
  const lang = i18n.language === 'en' ? 'en' : 'vi'
  const updateGroups = useWs((s) => s.updateGroups)
  const setProject = useWs((s) => s.setProject)
  const setStep = useWs((s) => s.setStep)
  const inputSel = useWs((s) => s.inputSel)
  const templates = useStyle((s) => s.templates)
  const loadTemplates = useStyle((s) => s.loadTemplates)
  const runs = useStyle((s) => s.runs)
  const loadRun = useStyle((s) => s.loadRun)
  const putRun = useStyle((s) => s.putRun)
  const styleCount = useApp((s) => s.settings.gen.styleCount)
  const rl = useEnv((s) => s.rateLimits)
  const [n, setN] = useState(styleCount)
  const [pick, setPick] = useState<Pick>(null)
  const [src, setSrc] = useState<'custom' | 'templates' | 'ai'>(group.suggestRunId ? 'ai' : group.promptEn.trim() && !group.templateId ? 'custom' : 'templates')
  const [polish, setPolish] = useState<{ phase: 'loading' } | { phase: 'done'; result: PromptPolishResult; v: number } | { phase: 'error'; msg: string } | null>(null)
  const [prevPrompt, setPrevPrompt] = useState<string | null>(null)
  const [feedback, setFeedback] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const [zoom, setZoom] = useState<{ src: string; title: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState(false)
  const [saveTpl, setSaveTpl] = useState<string | null>(null)

  const inputsById = useMemo(() => new Map(project.inputs.map((i) => [i.id, i])), [project.inputs])
  const assets = group.assetIds.map((id) => inputsById.get(id)).filter((x): x is InputView => !!x)
  const run: SuggestRun | null = group.suggestRunId ? (runs[group.suggestRunId] ?? null) : null
  const running = !!run && (run.phase === 'planning' || run.phase === 'rendering')
  const locked = isLocked(group)
  const left5 = rl?.primary ? Math.max(0, Math.round(100 - rl.primary.usedPercent)) : null
  const selFromInput = inputSel.filter((id) => inputsById.has(id))

  useEffect(() => {
    if (group.suggestRunId && !runs[group.suggestRunId]) void loadRun(project.dir, group.suggestRunId)
  }, [group.suggestRunId, project.dir, runs, loadRun])

  const patch = (p: Partial<StyleGroup>, immediate?: boolean): void => {
    updateGroups((gs) => gs.map((g) => (g.id === group.id ? { ...g, ...p } : g)), immediate)
  }

  const replace = (next: StyleGroup): void => {
    updateGroups((gs) => gs.map((g) => (g.id === group.id ? next : g)), true)
  }

  const runPolish = async (): Promise<void> => {
    if (!group.promptEn.trim()) {
      toast(t('style.polish.empty'), 'warn')
      return
    }
    const v = polish && polish.phase === 'done' ? polish.v + 1 : 1
    setPolish({ phase: 'loading' })
    try {
      const result = await window.gas.style.polish({ prompt: group.promptEn, context: 'group', lang })
      setPolish({ phase: 'done', result, v })
    } catch (e) {
      setPolish({ phase: 'error', msg: errMsg(e) })
    }
  }

  const samples = (): { path: string; kind: InputView['kind']; name: string }[] => {
    const src = (assets.length ? assets : project.inputs).filter((i) => i.status !== 'missing')
    return src.map((i) => ({ path: i.abs, kind: i.kind, name: i.name }))
  }

  const startSuggest = async (count: number, fb?: string): Promise<void> => {
    if (busy) return
    setBusy('suggest')
    setPick(null)
    try {
      const avoid = [...templates.flatMap((x) => [x.name.en, x.name.vi]), ...(run?.suggestions.map((s) => s.name) ?? [])]
      const r = await window.gas.style.suggestStart({
        projectPath: project.dir,
        samples: samples(),
        prompt: group.promptEn,
        refImages: group.refImages.map((p) => projAbs(project.dir, p)),
        count,
        feedback: fb,
        avoidNames: [...new Set(avoid.filter(Boolean))]
      })
      putRun(r)
      patch({ suggestRunId: r.runId }, true)
    } catch (e) {
      toast(`${t('style.sugg.startFailed')}: ${errMsg(e)}`, 'err')
    } finally {
      setBusy(null)
    }
  }

  const regenPicked = async (): Promise<void> => {
    if (!run || !pick || pick.kind !== 'suggestion') return
    try {
      await window.gas.style.suggestRegen(project.dir, run.runId, pick.id, feedback.trim() || undefined)
    } catch (e) {
      toast(errMsg(e), 'err')
    }
  }

  const afterLock = (): void => {
    const allLocked = project.groups.every((x) => x.id === group.id || !x.assetIds.length || isLocked(x))
    if (assets.length && allLocked) setTimeout(() => setStep(3), 700)
  }

  const lockFromPrompt = (): void => {
    if (busy || locked || !hasCustom) return
    const name = t('style.custom.lockName')
    const next: StyleGroup = { ...group, lockPrompt: true, lockName: name, lockedAt: Date.now() }
    delete next.lockImage
    delete next.templateId
    replace(next)
    setPick(null)
    toast(t('style.lockedToast', { name }))
    afterLock()
  }

  const doLock = async (): Promise<void> => {
    if (!pick || busy) return
    setBusy('lock')
    try {
      if (pick.kind === 'suggestion') {
        if (!run) return
        const s = run.suggestions.find((x) => x.id === pick.id)
        const next = await window.gas.style.lock({ projectPath: project.dir, group, source: { kind: 'suggestion', projectPath: project.dir, runId: run.runId, suggestionId: pick.id } })
        replace({ ...next, palette: s?.palette ?? [], lockName: s?.name ?? '', lockedAt: Date.now() })
        toast(t('style.lockedToast', { name: s?.name ?? '' }))
      } else {
        const tpl = templates.find((x) => x.id === pick.id)
        const next = await window.gas.style.lock({ projectPath: project.dir, group, source: { kind: 'template', templateId: pick.id } })
        const keepPrompt = group.templateId === pick.id && group.promptEn.trim() ? group.promptEn : next.promptEn
        replace({ ...next, promptEn: keepPrompt, palette: tpl?.palette ?? [], lockName: tpl?.name[lang] ?? '', lockedAt: Date.now() })
        toast(t('style.lockedToast', { name: tpl?.name[lang] ?? '' }))
      }
      setPick(null)
      afterLock()
    } catch (e) {
      toast(`${t('style.lockFailed')}: ${errMsg(e)}`, 'err')
    } finally {
      setBusy(null)
    }
  }

  const doUnlock = async (): Promise<void> => {
    try {
      const next = await window.gas.style.unlock(project.dir, group)
      const clean = { ...next }
      delete clean.lockName
      delete clean.lockedAt
      delete clean.lockPrompt
      replace(clean)
    } catch (e) {
      toast(errMsg(e), 'err')
    }
  }

  const pickTemplate = (tpl: StyleTemplate): void => {
    if (locked) return
    setPick({ kind: 'template', id: tpl.id })
    if (group.promptEn !== tpl.promptEn) {
      setPrevPrompt(group.promptEn)
      patch({ promptEn: tpl.promptEn, templateId: tpl.id, palette: tpl.palette })
    }
  }

  const addRefs = async (): Promise<void> => {
    const added = await window.gas.project.addRefs(project.rel, group.id).catch(() => [] as string[])
    if (added.length) patch({ refImages: [...group.refImages, ...added].slice(0, 8) }, true)
  }

  const toggleNine = async (i: InputView): Promise<void> => {
    const view = await window.gas.project.setType(project.rel, [i.id], i.type === 'nine' ? 'normal' : 'nine')
    if (view) setProject(view)
  }

  const removeAsset = (id: string): void => patch({ assetIds: group.assetIds.filter((a) => a !== id) }, true)

  const useInputSel = (): void => {
    const set = new Set(selFromInput)
    updateGroups((gs) => gs.map((g) => (g.id === group.id ? { ...g, assetIds: [...g.assetIds.filter((a) => !set.has(a)), ...selFromInput] } : { ...g, assetIds: g.assetIds.filter((a) => !set.has(a)) })), true)
    toast(t('style.picker.applied', { count: selFromInput.length, name: group.name }))
  }

  const saveTemplate = async (): Promise<void> => {
    const name = (saveTpl ?? '').trim()
    if (!name) return
    try {
      await window.gas.style.saveTemplate({ group, projectPath: project.dir, name: { vi: name, en: name }, palette: group.palette })
      await loadTemplates()
      toast(t('style.tpl.saved', { name }))
      setSaveTpl(null)
    } catch (e) {
      toast(errMsg(e), 'err')
    }
  }

  const lockSrc = lockUrl(project, group)
  const phaseText = run ? (run.phase === 'planning' ? t('style.sugg.planning') : run.phase === 'rendering' ? t('style.sugg.rendering', { done: run.suggestions.filter((s) => s.status === 'done').length, total: run.suggestions.length }) : '') : ''
  const lockedSuggestion = (s: StyleSuggestion): boolean => locked && !group.templateId && group.lockName === s.name
  const canSuggest = !locked && !running && !busy
  const hasCustom = !!group.promptEn.trim() || group.refImages.length > 0
  const promptLockable = src === 'custom' && hasCustom && !running

  const pickedSugg = pick?.kind === 'suggestion' ? run?.suggestions.find((s) => s.id === pick.id) : undefined
  const pickedTpl = pick?.kind === 'template' ? templates.find((x) => x.id === pick.id) : undefined
  const pickedName = pickedSugg?.name ?? pickedTpl?.name[lang] ?? ''
  const pickedImg = pickedSugg?.previewPath ? fileUrl(pickedSugg.previewPath, pickedSugg.durationMs ?? 0) : pickedTpl?.previewSmPath ? fileUrl(pickedTpl.previewSmPath) : null
  const stage = locked ? 4 : !assets.length ? 1 : pick ? 3 : 2
  const showAi = !!run && (run.phase === 'planning' || run.suggestions.length > 0)

  return (
    <div className="editor">
      <div className="ed-main">
        <div className="ed-head">
          <input className="title-in" value={group.name} aria-label={t('style.groupName')} onChange={(e) => patch({ name: e.target.value })} />
          {locked ? (
            <span className="chip c-green">
              <Icon name="lock" size={11} />
              {t('style.locked')}
            </span>
          ) : (
            <span className="chip c-gray">{t('style.notLocked')}</span>
          )}
          <div className="grow" />
          <button type="button" className="btn ghost sm danger" onClick={() => setConfirmDel(true)}>
            <Icon name="trash" size={14} />
            {t('style.deleteGroup')}
          </button>
        </div>
        <ol className="flow">
          {(['assets', 'pick', 'lock'] as const).map((k, i) => (
            <li key={k} className={stage > i + 1 ? 'done' : stage === i + 1 ? 'cur' : undefined}>
              <span className="fn">{stage > i + 1 ? <Icon name="check" size={11} /> : i + 1}</span>
              {t(`style.flow.${k}`)}
            </li>
          ))}
        </ol>

        <section className="card-s">
          <div className="sec-h">
            <h3>
              <span className="sn">1</span>
              {t('style.assets.title')}
            </h3>
            <span className="muted">{t('style.assets.count', { count: assets.length })}</span>
            <div className="grow" />
            {selFromInput.length > 0 && (
              <button type="button" className="btn sm" onClick={useInputSel}>
                <Icon name="check" size={13} />
                {t('style.assets.fromInput', { count: selFromInput.length })}
              </button>
            )}
            <button type="button" className={assets.length ? 'btn sm' : 'btn sm primary'} onClick={() => setPickerOpen(true)}>
              <Icon name="grid" size={13} />
              {t('style.assets.choose')}
            </button>
          </div>
          <div className="strip">
            {assets.slice(0, 40).map((i) => (
              <div className="sthumb" key={i.id} title={`${i.rel} · ${i.w}×${i.h}`}>
                <span className="st-img ck">{i.thumb ? <img src={i.thumb} alt="" draggable={false} /> : <Icon name="alert" size={16} />}</span>
                <button type="button" className={i.type === 'nine' ? 'st-nine on' : 'st-nine'} title={t('style.assets.nineHint')} onClick={() => void toggleNine(i)}>
                  9
                </button>
                <button type="button" className="st-x" aria-label={t('style.assets.remove')} title={t('style.assets.remove')} onClick={() => removeAsset(i.id)}>
                  <Icon name="x" size={10} />
                </button>
              </div>
            ))}
            {assets.length > 40 && <div className="more">+{assets.length - 40}</div>}
            {!assets.length && <span className="muted">{t('style.assets.empty')}</span>}
          </div>
        </section>

        <section className="card-s" data-coach="style-templates">
          <div className="sec-h">
            <h3>
              <span className="sn">2</span>
              {t('style.pick.title')}
            </h3>
            <span className="muted">{t('style.src.desc')}</span>
          </div>
          <div className="src-tabs" role="tablist">
            {(
              [
                { id: 'custom', icon: 'edit' },
                { id: 'templates', icon: 'palette' },
                { id: 'ai', icon: 'sparkles' }
              ] as const
            ).map((x) => (
              <button key={x.id} type="button" role="tab" aria-selected={src === x.id} className={src === x.id ? 'src-tab on' : 'src-tab'} onClick={() => setSrc(x.id)}>
                <span className="st-ic">
                  <Icon name={x.icon} size={16} />
                </span>
                <span className="st-t">
                  <b>{t(`style.src.${x.id}.name`)}</b>
                  <small>{t(`style.src.${x.id}.desc`)}</small>
                </span>
              </button>
            ))}
          </div>

          {src === 'custom' && (
            <div className="src-pane">
              <div className="custom-grid">
                <div>
                  <label className="lbl" htmlFor={`gp-${group.id}`}>
                    {t('style.prompt.label')} <small className="muted">{t('style.prompt.optional')}</small>
                  </label>
                  <textarea
                    id={`gp-${group.id}`}
                    className="ta"
                    rows={5}
                    value={group.promptEn}
                    disabled={locked}
                    placeholder={t('style.prompt.placeholder')}
                    onChange={(e) => patch({ promptEn: e.target.value })}
                  />
                  <div className="ptools">
                    <button type="button" className="btn sm" disabled={locked || polish?.phase === 'loading'} onClick={() => void runPolish()}>
                      <Icon name="sparkles" size={13} />
                      {t('style.polish.button')}
                    </button>
                    <ModelChip task="promptPolish" />
                    {prevPrompt !== null && (
                      <button
                        type="button"
                        className="btn sm ghost"
                        onClick={() => {
                          patch({ promptEn: prevPrompt }, true)
                          setPrevPrompt(null)
                        }}
                      >
                        <Icon name="refresh" size={13} />
                        {t('style.polish.undo')}
                      </button>
                    )}
                  </div>
                  <AnimatePresence initial={false}>
                    {polish && (
                      <PolishPanel
                        key="pf"
                        state={polish}
                        onUse={() => {
                          if (polish.phase !== 'done') return
                          setPrevPrompt(group.promptEn)
                          patch({ promptEn: polish.result.promptEn }, true)
                          setPolish(null)
                        }}
                        onAgain={() => void runPolish()}
                        onDrop={() => setPolish(null)}
                      />
                    )}
                  </AnimatePresence>
                </div>
                <div>
                  <div className="lbl">
                    {t('style.refs.label')} <small className="muted">{t('style.refs.optional')}</small>
                  </div>
                  <div className="refs">
                    {group.refImages.map((r) => (
                      <div className="ref ck" key={r}>
                        <img src={fileUrl(projAbs(project.dir, r))} alt="" draggable={false} />
                        {!locked && (
                          <button type="button" className="ref-x" aria-label={t('style.refs.remove')} onClick={() => patch({ refImages: group.refImages.filter((x) => x !== r) }, true)}>
                            <Icon name="x" size={11} />
                          </button>
                        )}
                      </div>
                    ))}
                    {group.refImages.length < 8 && !locked && (
                      <button type="button" className="ref-add" aria-label={t('style.refs.add')} title={t('style.refs.add')} onClick={() => void addRefs()}>
                        <Icon name="plus" size={18} />
                      </button>
                    )}
                  </div>
                  <p className="muted small ref-note">{t('style.refs.note')}</p>
                </div>
              </div>
              <div className="draw-row">
                <span className="muted">{hasCustom ? t('style.custom.ready') : t('style.custom.need')}</span>
                <div className="grow" />
                {running ? (
                  <button type="button" className="btn" onClick={() => run && void window.gas.style.suggestCancel(run.runId)}>
                    <Icon name="x" size={14} />
                    {t('style.sugg.cancel')}
                  </button>
                ) : (
                  <>
                    <button type="button" className="btn" disabled={!canSuggest || !hasCustom} onClick={() => void startSuggest(1, ONLY_PROMPT_FEEDBACK)}>
                      {busy === 'suggest' ? <span className="spin" /> : <Icon name="sparkles" size={14} />}
                      {t('style.custom.draw')}
                    </button>
                    <button type="button" className="btn primary" disabled={locked || !!busy || !hasCustom || !assets.length} title={t('style.custom.noPreviewDesc')} onClick={lockFromPrompt}>
                      <Icon name="lock" size={14} />
                      {t('style.custom.lockPrompt')}
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {src === 'templates' && (
            <div className="src-pane">
              <div className="sub-l">
                {t('style.pick.templates')}
                <div className="grow" />
                <button type="button" className="btn ghost sm" disabled={!group.promptEn.trim()} onClick={() => setSaveTpl(group.lockName || group.name)}>
                  <Icon name="save" size={13} />
                  {t('style.tpl.saveAs')}
                </button>
              </div>
              <div className="tpl-grid">
                {templates.map((tpl, i) => (
                  <TemplateCard
                    key={tpl.id}
                    tpl={tpl}
                    index={i}
                    on={pick?.kind === 'template' && pick.id === tpl.id}
                    locked={locked && group.templateId === tpl.id}
                    disabled={locked}
                    onPick={() => pickTemplate(tpl)}
                    onZoom={() => tpl.previewPath && setZoom({ src: fileUrl(tpl.previewPath), title: tpl.name[lang] })}
                    onDelete={() =>
                      void window.gas.style.deleteTemplate(tpl.id).then(() => {
                        void loadTemplates()
                        toast(t('style.tpl.deleted', { name: tpl.name[lang] }))
                      })
                    }
                  />
                ))}
              </div>
            </div>
          )}

          {src === 'ai' && (
            <div className="src-pane">
              <div className="ai-bar">
                <span className="ai-ic">
                  <Icon name="sparkles" size={16} />
                </span>
                <div className="ai-t">
                  <b>{t('style.sugg.title')}</b>
                  <span className="muted">
                    {running ? phaseText : left5 !== null ? t('style.sugg.estimateQuota', { count: n, left: left5 }) : t('style.sugg.estimate', { count: n })}
                  </span>
                </div>
                <ModelChip task="styleSuggest" />
                <Stepper value={n} min={SUGGEST_MIN} max={SUGGEST_MAX} onChange={setN} label={t('style.sugg.count')} />
                {running ? (
                  <button type="button" className="btn sm" onClick={() => run && void window.gas.style.suggestCancel(run.runId)}>
                    <Icon name="x" size={13} />
                    {t('style.sugg.cancel')}
                  </button>
                ) : (
                  <button type="button" className="btn sm primary" disabled={!canSuggest} onClick={() => void startSuggest(n)}>
                    {busy === 'suggest' ? <span className="spin" /> : <Icon name="sparkles" size={13} />}
                    {run ? t('style.sugg.again') : t('style.sugg.start')}
                  </button>
                )}
              </div>
              <p className="muted small ai-note">{t('style.src.ai.note')}</p>
            </div>
          )}

          {src !== 'templates' && (
            <>
              {run && run.phase === 'error' && (
                <div className="note err">
                  <Icon name="alert" size={14} />
                  <span className="note-t">{run.error ?? t('style.sugg.failed')}</span>
                </div>
              )}
              {run && run.phase === 'canceled' && (
                <div className="note info">
                  <Icon name="x" size={14} />
                  <span className="note-t">{t('style.sugg.canceled')}</span>
                </div>
              )}
              {showAi && <div className="sub-l">{t('style.custom.results')}</div>}
              {run && run.phase === 'planning' && (
                <div className="sugg-grid">
                  {Array.from({ length: src === 'custom' ? 1 : n }, (_, i) => (
                    <div className="skel" key={i} style={{ animationDelay: `${i * 120}ms` }} />
                  ))}
                </div>
              )}
              {run && run.suggestions.length > 0 && (
                <div className="sugg-grid">
                  {run.suggestions.map((s, i) => (
                    <SuggestionCard
                      key={s.id}
                      s={s}
                      index={i}
                      on={pick?.kind === 'suggestion' && pick.id === s.id}
                      locked={lockedSuggestion(s)}
                      disabled={locked || running}
                      onPick={() => setPick({ kind: 'suggestion', id: s.id })}
                      onZoom={() => s.previewPath && setZoom({ src: fileUrl(s.previewPath, s.durationMs ?? 0), title: s.name })}
                    />
                  ))}
                </div>
              )}
              {run && !locked && run.suggestions.length > 0 && (
                <div className="fb-box">
                  <label className="lbl" htmlFor={`fb-${group.id}`}>
                    {t('style.fb.label')} <small className="muted">{t('style.refs.optional')}</small>
                  </label>
                  <div className="fb-in">
                    <textarea id={`fb-${group.id}`} className="ta" rows={2} value={feedback} placeholder={t('style.fb.placeholder')} onChange={(e) => setFeedback(e.target.value)} />
                    <div className="fb-acts">
                      <button type="button" className="btn sm" disabled={running || pick?.kind !== 'suggestion'} onClick={() => void regenPicked()}>
                        <Icon name="refresh" size={13} />
                        {t('style.fb.regenPicked')}
                      </button>
                      <button type="button" className="btn sm" disabled={!canSuggest} onClick={() => void startSuggest(src === 'custom' ? 1 : n, src === 'custom' ? [ONLY_PROMPT_FEEDBACK, feedback.trim()].filter(Boolean).join(' ') : feedback.trim() || undefined)}>
                        <Icon name="refresh" size={13} />
                        {t('style.fb.regenAll')}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </section>
      </div>


      <AnimatePresence initial={false} mode="wait">
        {locked ? (
          <motion.div key="lk" className="lockbar locked" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={fadeTransition}>
            <button type="button" className="lk-img ck" disabled={!lockSrc} onClick={() => lockSrc && setZoom({ src: lockSrc, title: group.lockName ?? group.name })}>
              {lockSrc ? <img src={lockSrc} alt="" draggable={false} /> : <Icon name="lock" size={18} />}
            </button>
            <div className="lb-t">
              <b>
                {t('style.locked')}: {group.lockName || group.name}
              </b>
              <span>{group.lockPrompt && !group.lockImage ? t('style.custom.lockedDesc') : t('style.lockDesc')}</span>
            </div>
            <button type="button" className="btn" onClick={() => void doUnlock()}>
              <Icon name="unlock" size={14} />
              {t('style.unlock')}
            </button>
          </motion.div>
        ) : (
          <motion.div key="pk" className="lockbar" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={fadeTransition}>
            <span className="lk-img ck">{pickedImg ? <img src={pickedImg} alt="" draggable={false} /> : <Icon name="palette" size={18} />}</span>
            <div className="lb-t">
              <b>
                <span className="sn">3</span>
                {pick ? t('style.pick.selected', { name: pickedName }) : promptLockable ? t('style.custom.noPreview') : t('style.pick.none')}
              </b>
              <span>{pick ? t('style.lockDesc') : promptLockable ? t('style.custom.noPreviewDesc') : t('style.pick.noneDesc')}</span>
            </div>
            {pick || !promptLockable ? (
              <button type="button" className="btn primary" data-coach="style-lock" disabled={!pick || !!busy || running} onClick={() => void doLock()}>
                {busy === 'lock' ? <span className="spin" /> : <Icon name="lock" size={14} />}
                {t('style.lock')}
              </button>
            ) : (
              <button type="button" className="btn primary" data-coach="style-lock" disabled={!!busy} onClick={lockFromPrompt}>
                <Icon name="lock" size={14} />
                {t('style.custom.lockPrompt')}
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <AssetPicker project={project} group={group} open={pickerOpen} onClose={() => setPickerOpen(false)} />
      <Lightbox src={zoom?.src ?? null} title={zoom?.title ?? ''} onClose={() => setZoom(null)} />
      <Modal open={confirmDel} onClose={() => setConfirmDel(false)} label={t('style.deleteGroup')} role="alertdialog">
        <h2>
          <span className="dlg-ic danger">
            <Icon name="trash" size={22} />
          </span>
          {t('style.delTitle', { name: group.name })}
        </h2>
        <p>{t('style.delDesc', { count: assets.length })}</p>
        <div className="acts">
          <button type="button" className="btn" onClick={() => setConfirmDel(false)}>
            {t('dialogs.cancel')}
          </button>
          <button
            type="button"
            className="btn danger solid"
            onClick={() => {
              setConfirmDel(false)
              updateGroups((gs) => gs.filter((g) => g.id !== group.id), true)
            }}
          >
            <Icon name="trash" size={14} />
            {t('style.deleteGroup')}
          </button>
        </div>
      </Modal>
      <Modal open={saveTpl !== null} onClose={() => setSaveTpl(null)} label={t('style.tpl.saveAs')}>
        <h2>
          <span className="dlg-ic">
            <Icon name="save" size={22} />
          </span>
          {t('style.tpl.saveAs')}
        </h2>
        <p>{t('style.tpl.saveDesc')}</p>
        <label className="fld">
          <span>{t('style.tpl.name')}</span>
          <input
            className="inp"
            value={saveTpl ?? ''}
            autoFocus
            onChange={(e) => setSaveTpl(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void saveTemplate()
            }}
          />
        </label>
        <div className="acts">
          <button type="button" className="btn" onClick={() => setSaveTpl(null)}>
            {t('dialogs.cancel')}
          </button>
          <button type="button" className="btn primary" disabled={!saveTpl?.trim()} onClick={() => void saveTemplate()}>
            <Icon name="save" size={14} />
            {t('style.tpl.save')}
          </button>
        </div>
      </Modal>
    </div>
  )
}

export function StyleStep({ project }: { project: ProjectView }): ReactElement {
  const { t } = useTranslation()
  const styleSteps = useMemo(() => tourSteps('style'), [])
  const seenTours = useApp((s) => s.settings.onboarding.tours)
  const markTourSeen = useApp((s) => s.markTourSeen)
  const settingsOpen = useApp((s) => s.settingsOpen)
  const coachReplay = useApp((s) => s.coachReplay)
  const activeGroup = useWs((s) => s.activeGroup)
  const setActiveGroup = useWs((s) => s.setActiveGroup)
  const updateGroups = useWs((s) => s.updateGroups)
  const setStep = useWs((s) => s.setStep)
  const groups = project.groups
  const g = groups.find((x) => x.id === activeGroup) ?? groups[0] ?? null
  const owner = useMemo(() => groupOf(project), [project])
  const unassigned = project.inputs.filter((i) => !owner.has(i.id))
  const ready = styleReady(project)

  const addGroup = (): void => {
    const id = newGroupId()
    const first = groups.length === 0
    const name = t('style.newGroupName', { n: groups.length + 1 })
    updateGroups(
      (gs) => [...gs, { id, name, promptEn: '', notes: '', refImages: [], assetIds: first ? unassigned.map((i) => i.id) : [], nineSliceOverrides: {} }],
      true
    )
    setActiveGroup(id)
  }

  const assignRest = (): void => {
    if (!g) return
    const ids = unassigned.map((i) => i.id)
    updateGroups((gs) => gs.map((x) => (x.id === g.id ? { ...x, assetIds: [...x.assetIds, ...ids] } : x)), true)
    toast(t('style.picker.applied', { count: ids.length, name: g.name }))
  }

  return (
    <div className="style-step">
      <div className="gtabs" data-coach="style-groups">
        <span className="lbl-s">{t('style.groups')}</span>
        <AnimatePresence initial={false}>
          {groups.map((x) => (
            <motion.button
              layout
              key={x.id}
              type="button"
              className={x.id === g?.id ? 'gtab on' : 'gtab'}
              onClick={() => setActiveGroup(x.id)}
              initial={{ opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.22, ease: EASE }}
            >
              <Swatch project={project} group={x} />
              <span className="gi-t">
                <span className="gname">{x.name}</span>
                <small className="muted">
                  {t('style.assets.count', { count: x.assetIds.length })} · {isLocked(x) ? x.lockName || t('style.locked') : t('style.notLocked')}
                </small>
              </span>
              {isLocked(x) && (
                <span className="chip c-green">
                  <Icon name="lock" size={10} />
                </span>
              )}
            </motion.button>
          ))}
        </AnimatePresence>
        <button type="button" className="btn ghost sm" onClick={addGroup}>
          <Icon name="plus" size={14} />
          {t('style.newGroup')}
        </button>
        <div className="grow" />
        {unassigned.length > 0 && groups.length > 0 && (
          <div className="unas" title={t('style.unassigned.desc')}>
            <Icon name="alert" size={14} />
            <span>{t('style.unassigned.title', { count: unassigned.length })}</span>
            <button type="button" className="btn sm" onClick={assignRest}>
              {t('style.unassigned.assign')}
            </button>
          </div>
        )}
      </div>
      {g ? (
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={g.id} className="editor-wrap" initial={{ opacity: 0, x: 10 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} transition={fadeTransition}>
            <GroupEditor project={project} group={g} />
          </motion.div>
        </AnimatePresence>
      ) : (
        <div className="proj-state">
          <div className="empty">
            <Icon name="palette" size={34} />
            <h3>{t('style.emptyTitle')}</h3>
            <p>{t('style.emptyDesc')}</p>
            <div className="actions">
              <button type="button" className="btn primary" onClick={addGroup}>
                <Icon name="plus" size={14} />
                {t('style.newGroup')}
              </button>
            </div>
          </div>
        </div>
      )}
      <div className="footbar">
        <span>{ready ? t('style.footReady') : t('style.footHint')}</span>
        <div className="grow" />
        <button type="button" className="btn" onClick={() => setStep(1)}>
          <Icon name="left" size={14} />
          {t('project.steps.input')}
        </button>
        <button type="button" className="btn primary" disabled={!ready} title={ready ? undefined : t('project.lock.gen')} onClick={() => setStep(3)}>
          {t('style.next')}
          <Icon name="right" size={14} />
        </button>
      </div>
      <CoachTour tourId="style" steps={styleSteps} seen={!!seenTours.style} onSeen={markTourSeen} enabled={!!seenTours.project && !settingsOpen} replay={coachReplay} delay={500} />
    </div>
  )
}
