import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { STYLE_REF_MAX, type SaveStyleRequest, type StyleTemplate, type TemplateCategory } from '@shared/style'
import { Icon } from '@renderer/components/Icon'
import { Modal } from '@renderer/components/Modal'
import { errMsg, fileUrl } from '@renderer/lib/files'
import { toast } from '@renderer/store/toast'

export async function applyLibraryStyle(
  tpl: StyleTemplate,
  projectDir: string,
  refDir: string,
  current: string[]
): Promise<{ refImages: string[]; notes: string | null }> {
  if (tpl.builtin) return { refImages: current, notes: null }
  const kept = current.filter((r) => !/(^|\/)lib-/.test(r))
  const added = tpl.refPaths.length
    ? await window.gas.style.applyTemplateRefs({ templateId: tpl.id, projectPath: projectDir, refDir, max: STYLE_REF_MAX - kept.length })
    : []
  return { refImages: [...kept, ...added], notes: tpl.notes || null }
}

export function SaveToLibraryButton({
  defaultName,
  defaultCategory,
  disabled,
  build,
  onSaved
}: {
  defaultName: string
  defaultCategory: TemplateCategory
  disabled: boolean
  build: (name: string, category: TemplateCategory) => SaveStyleRequest
  onSaved: () => void
}): ReactElement {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [category, setCategory] = useState<TemplateCategory>(defaultCategory)
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    const n = name.trim()
    if (!n || busy) return
    setBusy(true)
    try {
      await window.gas.style.saveStyle(build(n, category))
      toast(t('styleLib.saved', { name: n }))
      setOpen(false)
      onSaved()
    } catch (e) {
      toast(errMsg(e), 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn sm"
        disabled={disabled}
        onClick={() => {
          setName(defaultName)
          setCategory(defaultCategory)
          setOpen(true)
        }}
      >
        <Icon name="save" size={13} />
        {t('styleLib.saveBtn')}
      </button>
      <Modal open={open} onClose={() => setOpen(false)} label={t('styleLib.saveBtn')}>
        <h2>
          <span className="dlg-ic">
            <Icon name="save" size={22} />
          </span>
          {t('styleLib.saveBtn')}
        </h2>
        <p>{t('styleLib.saveDesc')}</p>
        <label className="fld">
          <span>{t('style.tpl.name')}</span>
          <input
            className="inp"
            value={name}
            autoFocus
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void save()
            }}
          />
        </label>
        <label className="fld">
          <span>{t('styleLib.category')}</span>
          <select className="inp" value={category} onChange={(e) => setCategory(e.target.value === 'character' ? 'character' : 'ui')}>
            <option value="character">{t('spriteProject.style.cat.character')}</option>
            <option value="ui">{t('spriteProject.style.cat.ui')}</option>
          </select>
        </label>
        <div className="acts">
          <button type="button" className="btn" onClick={() => setOpen(false)}>
            {t('dialogs.cancel')}
          </button>
          <button type="button" className="btn primary" disabled={!name.trim() || busy} onClick={() => void save()}>
            <Icon name="save" size={14} />
            {t('style.tpl.save')}
          </button>
        </div>
      </Modal>
    </>
  )
}

export function StyleLibraryDialog({
  open,
  onClose,
  templates,
  onChanged
}: {
  open: boolean
  onClose: () => void
  templates: StyleTemplate[]
  onChanged: () => void
}): ReactElement {
  const { t, i18n } = useTranslation()
  const lang = i18n.language === 'en' ? 'en' : 'vi'
  const mine = templates.filter((x) => !x.builtin)
  const [editing, setEditing] = useState<{ id: string; name: string } | null>(null)

  const run = async (fn: () => Promise<void>): Promise<void> => {
    try {
      await fn()
    } catch (e) {
      toast(errMsg(e), 'err')
    }
  }

  const rename = (): Promise<void> =>
    run(async () => {
      if (!editing) return
      if (editing.name.trim()) await window.gas.style.renameTemplate(editing.id, editing.name)
      setEditing(null)
      onChanged()
    })

  return (
    <Modal open={open} onClose={onClose} label={t('styleLib.manage')} className="slib-dlg">
      <h2>
        <span className="dlg-ic">
          <Icon name="palette" size={22} />
        </span>
        {t('styleLib.manage')}
      </h2>
      <p>{t('styleLib.manageDesc')}</p>
      <div className="slib-list">
        {mine.length === 0 && <div className="muted">{t('styleLib.empty')}</div>}
        {mine.map((x) => (
          <div key={x.id} className="slib-row">
            <span className="slib-th">{x.previewSmPath ? <img src={fileUrl(x.previewSmPath)} alt="" draggable={false} /> : <Icon name="palette" size={18} />}</span>
            <div className="slib-b">
              {editing?.id === x.id ? (
                <input
                  className="inp"
                  value={editing.name}
                  autoFocus
                  onChange={(e) => setEditing({ id: x.id, name: e.target.value })}
                  onBlur={() => void rename()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void rename()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                />
              ) : (
                <b>{x.name[lang]}</b>
              )}
              <small className="muted">
                {t(`spriteProject.style.cat.${x.category}`)} · {t('styleLib.refs', { count: x.refPaths.length })}
                {x.source ? ` · ${x.source.project} · ${new Date(x.source.at).toLocaleDateString(i18n.language)}` : ''}
              </small>
            </div>
            <button type="button" className="icon-btn" title={t('styleLib.rename')} aria-label={t('styleLib.rename')} onClick={() => setEditing({ id: x.id, name: x.name[lang] })}>
              <Icon name="edit" size={14} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title={t('styleLib.export')}
              aria-label={t('styleLib.export')}
              onClick={() =>
                void run(async () => {
                  const f = await window.gas.style.exportTemplate(x.id)
                  if (f) toast(t('styleLib.exported', { name: x.name[lang] }))
                })
              }
            >
              <Icon name="download" size={14} />
            </button>
            <button
              type="button"
              className="icon-btn"
              title={t('style.tpl.delete')}
              aria-label={t('style.tpl.delete')}
              onClick={() =>
                void run(async () => {
                  if (!window.confirm(t('styleLib.confirmDelete', { name: x.name[lang] }))) return
                  await window.gas.style.deleteTemplate(x.id)
                  onChanged()
                })
              }
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
        ))}
      </div>
      <div className="acts">
        <ImportButton onChanged={onChanged} />
        <button type="button" className="btn primary" onClick={onClose}>
          {t('styleLib.close')}
        </button>
      </div>
    </Modal>
  )
}

export function ImportButton({ onChanged }: { onChanged: () => void }): ReactElement {
  const { t } = useTranslation()
  return (
    <button
      type="button"
      className="btn sm"
      onClick={() =>
        void window.gas.style
          .importTemplate()
          .then((list) => {
            if (list.length) {
              toast(t('styleLib.imported', { count: list.length }))
              onChanged()
            }
          })
          .catch((e) => toast(errMsg(e), 'err'))
      }
    >
      <Icon name="upload" size={13} />
      {t('styleLib.import')}
    </button>
  )
}

export function StyleLibraryPanel({
  templates,
  selectedId,
  locked,
  onPick,
  onChanged
}: {
  templates: StyleTemplate[]
  selectedId: string | null
  locked: boolean
  onPick: (tpl: StyleTemplate) => void
  onChanged: () => void
}): ReactElement {
  const { t, i18n } = useTranslation()
  const lang = i18n.language === 'en' ? 'en' : 'vi'
  const [manage, setManage] = useState(false)
  const mine = templates.filter((x) => !x.builtin)
  return (
    <div className="slib-panel">
      <div className="sps-row">
        <span className="muted">{t('styleLib.teamDesc')}</span>
        <div className="grow" />
        <ImportButton onChanged={onChanged} />
        <button type="button" className="btn sm" onClick={() => setManage(true)}>
          <Icon name="palette" size={13} />
          {t('styleLib.manage')}
        </button>
      </div>
      {mine.length === 0 ? (
        <div className="muted slib-empty">{t('styleLib.empty')}</div>
      ) : (
        <div className="tpl-grid sps-tpls">
          {mine.map((x) => {
            const on = selectedId === x.id
            return (
              <div key={x.id} className={['tpl', on && 'on', on && locked && 'locked'].filter(Boolean).join(' ')}>
                <button type="button" className="tpl-hit" disabled={locked} onClick={() => onPick(x)} aria-pressed={on}>
                  <span className="tpl-img">{x.previewSmPath ? <img src={fileUrl(x.previewSmPath)} alt="" draggable={false} loading="lazy" /> : <Icon name="palette" size={22} />}</span>
                  <span className="tpl-b">
                    <span className="tpl-t">{x.name[lang]}</span>
                    <small className="muted">{t('styleLib.refs', { count: x.refPaths.length })}</small>
                  </span>
                </button>
                <span className="radio">{on && <Icon name={locked ? 'lock' : 'check'} size={12} />}</span>
              </div>
            )
          })}
        </div>
      )}
      <StyleLibraryDialog open={manage} onClose={() => setManage(false)} templates={templates} onChanged={onChanged} />
    </div>
  )
}
