import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { FolderNode } from '@shared/workspace'
import { errorText, useWs, type WsDialog } from '@renderer/store/workspace'
import { Modal } from './Modal'
import { Icon } from './Icon'
import { ProjectKindPicker } from './ProjectKinds'
import type { ProjectKind } from '@shared/sprite'

function flatFolders(node: FolderNode | null, depth = 0, out: Array<{ rel: string; name: string; depth: number }> = []) {
  if (!node || node.kind !== 'folder') return out
  out.push({ rel: node.rel, name: node.name, depth })
  for (const c of node.children) flatFolders(c, depth + 1, out)
  return out
}

function NameForm({ mode, parent }: { mode: 'newProject' | 'newFolder'; parent: string }): ReactElement {
  const { t } = useTranslation()
  const tree = useWs((s) => s.snap?.tree ?? null)
  const setDialog = useWs((s) => s.setDialog)
  const createFolder = useWs((s) => s.createFolder)
  const createProject = useWs((s) => s.createProject)
  const [name, setName] = useState('')
  const [dest, setDest] = useState(parent)
  const [kind, setKind] = useState<ProjectKind>('reskin')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const folders = flatFolders(tree)
  const k = mode === 'newProject' ? 'newProject' : 'newFolder'

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (!name.trim() || busy) return
    setBusy(true)
    const r = mode === 'newProject' ? await createProject(dest, name, kind) : await createFolder(dest, name)
    setBusy(false)
    if (r.ok) setDialog(null)
    else setError(errorText(r))
  }

  return (
    <form onSubmit={(e) => void submit(e)}>
      <h2>
        <span className="dlg-ic">
          <Icon name={mode === 'newProject' ? 'layers' : 'folderPlus'} size={20} />
        </span>
        {t(`dialogs.${k}.title`)}
      </h2>
      <label className="fld">
        <span>{t(`dialogs.${k}.name`)}</span>
        <input
          className="inp"
          autoFocus
          value={name}
          placeholder={t(`dialogs.${k}.namePh`)}
          onChange={(e) => {
            setName(e.target.value)
            setError(null)
          }}
          maxLength={120}
          spellCheck={false}
        />
      </label>
      <label className="fld">
        <span>{t(`dialogs.${k}.parent`)}</span>
        <select className="inp" value={dest} onChange={(e) => setDest(e.target.value)}>
          {folders.map((f) => (
            <option key={f.rel || '.'} value={f.rel}>
              {`${'   '.repeat(f.depth)}${f.depth ? '' : '⌂ '}${f.name}`}
            </option>
          ))}
        </select>
      </label>
      {mode === 'newProject' && <ProjectKindPicker value={kind} onChange={setKind} />}
      {error && <div className="fld-err">{error}</div>}
      {mode === 'newProject' && (
        <div className="tip">
          <Icon name="help" size={14} />
          <span>{t(`dialogs.newProject.hint_${kind}`)}</span>
        </div>
      )}
      <div className="acts">
        <button type="button" className="btn" onClick={() => setDialog(null)}>
          {t('dialogs.cancel')}
        </button>
        <button type="submit" className="btn primary" disabled={!name.trim() || busy}>
          {busy ? <span className="spin" /> : <Icon name="plus" size={14} />}
          {t(`dialogs.${k}.create`)}
        </button>
      </div>
    </form>
  )
}

function TrashBody({ rel, name, project, count }: { rel: string; name: string; project: boolean; count: number }): ReactElement {
  const { t } = useTranslation()
  const setDialog = useWs((s) => s.setDialog)
  const trash = useWs((s) => s.trash)
  const [busy, setBusy] = useState(false)
  return (
    <>
      <h2>
        <span className="dlg-ic danger">
          <Icon name="trash" size={20} />
        </span>
        {t('dialogs.trash.title', { name })}
      </h2>
      <p>{project ? t('dialogs.trash.projectBody') : t('dialogs.trash.folderBody', { count })}</p>
      <div className="acts">
        <button type="button" className="btn" onClick={() => setDialog(null)} autoFocus>
          {t('dialogs.cancel')}
        </button>
        <button
          type="button"
          className="btn danger solid"
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            await trash(rel, name)
            setBusy(false)
            setDialog(null)
          }}
        >
          {busy ? <span className="spin" /> : <Icon name="trash" size={14} />}
          {t('dialogs.trash.confirm')}
        </button>
      </div>
    </>
  )
}

export function WorkspaceDialogs(): ReactElement {
  const { t } = useTranslation()
  const live = useWs((s) => s.dialog)
  const setDialog = useWs((s) => s.setDialog)
  const [key, setKey] = useState(0)
  const [last, setLast] = useState<WsDialog>(null)
  useEffect(() => {
    if (live) {
      setLast(live)
      setKey((k) => k + 1)
    }
  }, [live])
  const dialog = live ?? last
  const label = dialog?.kind === 'trash' ? t('dialogs.trash.confirm') : dialog?.kind === 'newFolder' ? t('dialogs.newFolder.title') : t('dialogs.newProject.title')
  return (
    <Modal open={!!live} onClose={() => setDialog(null)} className={dialog?.kind === 'newProject' ? 'kinds-dlg' : undefined} label={label} role={dialog?.kind === 'trash' ? 'alertdialog' : 'dialog'}>
      {dialog?.kind === 'trash' ? (
        <TrashBody key={key} rel={dialog.rel} name={dialog.name} project={dialog.project} count={dialog.count} />
      ) : dialog ? (
        <NameForm key={key} mode={dialog.kind} parent={dialog.parent} />
      ) : null}
    </Modal>
  )
}
