import { Fragment, useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { SpriteProjectView } from '@shared/sprite'
import type { PromptPolishResult, StyleTemplate } from '@shared/style'
import { Icon } from '@renderer/components/Icon'
import { applyLibraryStyle, SaveToLibraryButton, StyleLibraryPanel } from '@renderer/components/StyleLibrary'
import { Segmented } from '@renderer/components/Segmented'
import { errMsg, fileUrl, projAbs } from '@renderer/lib/files'
import { useSprite } from '@renderer/store/sprite'
import { toast } from '@renderer/store/toast'

type Source = 'template' | 'team' | 'custom'

export function SpriteStyleStep({ v }: { v: SpriteProjectView }): ReactElement {
  const { t, i18n } = useTranslation()
  const lang = i18n.language === 'en' ? 'en' : 'vi'
  const setStyle = useSprite((s) => s.setStyle)
  const addRefs = useSprite((s) => s.addRefs)
  const setStep = useSprite((s) => s.setStep)
  const st = v.style
  const locked = st.locked
  const [tpls, setTpls] = useState<StyleTemplate[]>([])
  const [source, setSource] = useState<Source>(st.templateId ? 'template' : st.promptEn || st.refImages.length ? 'custom' : 'template')
  const [prompt, setPrompt] = useState(st.promptEn)
  const [notes, setNotes] = useState(st.notes)
  const [polish, setPolish] = useState<{ phase: 'idle' | 'loading' | 'error'; msg?: string; result?: PromptPolishResult; prev?: string }>({ phase: 'idle' })
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const loadTpls = (): void => {
    void window.gas.style.templates().then(setTpls).catch(() => setTpls([]))
  }
  useEffect(loadTpls, [])
  useEffect(() => {
    setPrompt(st.promptEn)
    setNotes(st.notes)
  }, [st.promptEn, st.notes])
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    []
  )

  const save = (patch: { promptEn?: string; notes?: string }): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => void setStyle(patch), 450)
  }

  const tpl = tpls.find((x) => x.id === st.templateId) ?? null
  const sections = (['character', 'ui'] as const).map((cat) => ({ cat, list: tpls.filter((x) => x.category === cat) })).filter((x) => x.list.length > 0)
  const ready = !!(st.templateId || prompt.trim() || st.refImages.length)

  const pickTpl = async (x: StyleTemplate): Promise<void> => {
    if (locked) return
    setPrompt(x.promptEn)
    try {
      const lib = await applyLibraryStyle(x, v.dir, 'styles/sprite/refs', st.refImages)
      if (lib.notes) setNotes(lib.notes)
      await setStyle({ templateId: x.id, promptEn: x.promptEn, ...(x.builtin ? {} : { refImages: lib.refImages }), ...(lib.notes ? { notes: lib.notes } : {}) })
    } catch (e) {
      toast(errMsg(e), 'err')
    }
  }

  const doPolish = async (): Promise<void> => {
    if (!prompt.trim() || polish.phase === 'loading') return
    setPolish({ phase: 'loading' })
    try {
      const result = await window.gas.style.polish({ prompt, context: 'group', lang })
      setPolish({ phase: 'idle', result, prev: prompt })
      setPrompt(result.promptEn)
      void setStyle({ promptEn: result.promptEn })
    } catch (e) {
      setPolish({ phase: 'error', msg: errMsg(e) })
    }
  }

  const lock = async (): Promise<void> => {
    if (timer.current) clearTimeout(timer.current)
    const ok = await setStyle({ promptEn: prompt, notes, locked: true })
    if (!ok) return
    toast(t('spriteProject.style.lockedToast'))
    setTimeout(() => {
      if (useSprite.getState().step === 2) setStep(3)
    }, 600)
  }

  return (
    <div className="sps-wrap">
      <div className="sps-main">
        <div className="sps-head">
          <Segmented<Source>
            value={source}
            ariaLabel={t('spriteProject.style.source')}
            onChange={setSource}
            options={[
              { value: 'template', label: t('spriteProject.style.templates') },
              { value: 'team', label: t('styleLib.tab') },
              { value: 'custom', label: t('spriteProject.style.custom') }
            ]}
          />
          <span className="muted">{t('spriteProject.style.oneStyle')}</span>
        </div>
        {source === 'team' ? (
          <StyleLibraryPanel templates={tpls} selectedId={st.templateId} locked={locked} onPick={(x) => void pickTpl(x)} onChanged={loadTpls} />
        ) : source === 'template' ? (
          <div className="sps-tpl-secs">
            {sections.map((sec) => (
              <Fragment key={sec.cat}>
                {sections.length > 1 && <div className="sub-l">{t(`spriteProject.style.cat.${sec.cat}`)}</div>}
                <div className="tpl-grid sps-tpls">
                  {sec.list.map((x) => {
                    const on = st.templateId === x.id
                    return (
                      <div key={x.id} className={['tpl', on && 'on', on && locked && 'locked'].filter(Boolean).join(' ')}>
                        <button type="button" className="tpl-hit" disabled={locked} onClick={() => void pickTpl(x)} aria-pressed={on}>
                          <span className="tpl-img">{x.previewSmPath ? <img src={fileUrl(x.previewSmPath)} alt="" draggable={false} loading="lazy" /> : <Icon name="palette" size={22} />}</span>
                          <span className="tpl-b">
                            <span className="tpl-t">{x.name[lang]}</span>
                            <span className="sw">
                              {x.palette.slice(0, 6).map((c) => (
                                <i key={c} style={{ background: c }} />
                              ))}
                            </span>
                          </span>
                        </button>
                        <span className="radio">{on && <Icon name={locked ? 'lock' : 'check'} size={12} />}</span>
                      </div>
                    )
                  })}
                </div>
              </Fragment>
            ))}
          </div>
        ) : (
          <div className="sps-custom">
            <label className="fld">
              <span>{t('spriteProject.style.prompt')}</span>
              <textarea
                className="inp"
                rows={6}
                value={prompt}
                disabled={locked}
                placeholder={t('spriteProject.style.promptPh')}
                onChange={(e) => {
                  setPrompt(e.target.value)
                  save({ promptEn: e.target.value })
                }}
              />
            </label>
            <div className="sps-row">
              <button type="button" className="btn sm" disabled={locked || !prompt.trim() || polish.phase === 'loading'} onClick={() => void doPolish()}>
                {polish.phase === 'loading' ? <span className="spin" /> : <Icon name="wand" size={13} />}
                {t('spriteProject.style.polish')}
              </button>
              {polish.result && polish.prev !== undefined && !locked && (
                <button
                  type="button"
                  className="btn ghost sm"
                  onClick={() => {
                    const prev = polish.prev ?? ''
                    setPrompt(prev)
                    void setStyle({ promptEn: prev })
                    setPolish({ phase: 'idle' })
                  }}
                >
                  <Icon name="left" size={13} />
                  {t('spriteProject.style.undo')}
                </button>
              )}
              {polish.phase === 'error' && <span className="fld-err">{polish.msg}</span>}
            </div>
            {polish.result && polish.result.changes.length > 0 && (
              <ul className="sps-changes">
                {polish.result.changes.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
            <div className="fld">
              <span>{t('spriteProject.style.refs')}</span>
              <div className="sps-refs">
                {st.refImages.map((r) => (
                  <span key={r} className="sps-ref ck">
                    <img src={fileUrl(projAbs(v.dir, r))} alt="" draggable={false} />
                    {!locked && (
                      <button type="button" className="sps-ref-x" aria-label={t('spriteProject.style.removeRef')} onClick={() => void setStyle({ refImages: st.refImages.filter((x) => x !== r) })}>
                        <Icon name="x" size={10} />
                      </button>
                    )}
                  </span>
                ))}
                {!locked && st.refImages.length < 8 && (
                  <button type="button" className="sps-ref add" onClick={() => void addRefs()}>
                    <Icon name="plus" size={16} />
                    <small>{t('spriteProject.style.addRef')}</small>
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
      <aside className="sps-side">
        <h3>
          <Icon name="palette" size={14} />
          {t('spriteProject.style.summary')}
        </h3>
        <div className="sps-pick">
          {tpl?.previewSmPath ? <img src={fileUrl(tpl.previewSmPath)} alt="" draggable={false} /> : <Icon name="palette" size={26} />}
          <div>
            <b>{tpl ? tpl.name[lang] : prompt.trim() || st.refImages.length ? t('spriteProject.style.customName') : t('spriteProject.style.none')}</b>
            <small>{t('spriteProject.style.refCount', { count: st.refImages.length })}</small>
          </div>
        </div>
        <label className="fld">
          <span>{t('spriteProject.style.notes')}</span>
          <textarea
            className="inp"
            rows={4}
            value={notes}
            disabled={locked}
            placeholder={t('spriteProject.style.notesPh')}
            onChange={(e) => {
              setNotes(e.target.value)
              save({ notes: e.target.value })
            }}
          />
        </label>
        <SaveToLibraryButton
          defaultName={tpl?.name[lang] ?? v.name}
          defaultCategory={tpl?.category ?? 'character'}
          disabled={!(prompt.trim() || st.refImages.length)}
          build={(name, category) => ({ projectPath: v.dir, name, category, promptEn: prompt, notes, refImages: st.refImages, palette: tpl?.palette, sourceName: v.name })}
          onSaved={loadTpls}
        />
        <div className="tip">
          <Icon name="help" size={14} />
          <span>{t('spriteProject.style.tip')}</span>
        </div>
        <div className="grow" />
        {locked ? (
          <>
            <div className="note ok">
              <Icon name="lock" size={14} />
              <span>{t('spriteProject.style.lockedNote')}</span>
            </div>
            <div className="sps-acts">
              <button type="button" className="btn" onClick={() => void setStyle({ locked: false })}>
                <Icon name="unlock" size={14} />
                {t('spriteProject.style.unlock')}
              </button>
              <button type="button" className="btn primary" onClick={() => setStep(3)}>
                {t('spriteProject.style.next')}
                <Icon name="right" size={14} />
              </button>
            </div>
          </>
        ) : (
          <button type="button" className="btn primary sps-lock" disabled={!ready} title={ready ? undefined : t('spriteProject.style.needPick')} onClick={() => void lock()}>
            <Icon name="lock" size={14} />
            {t('spriteProject.style.lock')}
          </button>
        )}
      </aside>
    </div>
  )
}
