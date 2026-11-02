import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { skinNameError, type SpineProjectView } from '@shared/spine'
import { Icon } from '@renderer/components/Icon'
import { Modal } from '@renderer/components/Modal'
import { useSpine } from '@renderer/store/spine'

export function SkinPicker({ v }: { v: SpineProjectView }): ReactElement {
  const { t } = useTranslation()
  const setVariant = useSpine((s) => s.setVariant)
  const addVariant = useSpine((s) => s.addVariant)
  const removeVariant = useSpine((s) => s.removeVariant)
  const [adding, setAdding] = useState(false)
  const [name, setName] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState(false)
  const cur = v.variants.find((x) => x.id === v.variant && x.id)
  const typed = name.trim()
  const localErr = typed ? skinNameError(typed, [...v.variants.map((x) => x.name), ...(v.skeleton?.skins ?? [])]) : null
  const shownErr = localErr ?? err

  const create = async (): Promise<void> => {
    if (!typed || localErr || busy) return
    setBusy(true)
    const e = await addVariant(typed)
    setBusy(false)
    if (e) setErr(e)
    else setAdding(false)
  }

  return (
    <div className="toolbar spine-skins">
      <Icon name="palette" size={13} />
      <span className="muted">{t('spine.skin.label')}</span>
      <select className="inp sm" value={v.variant} onChange={(e) => void setVariant(e.target.value)} aria-label={t('spine.skin.label')}>
        {v.variants.map((x) => (
          <option key={x.id} value={x.id}>
            {x.id ? x.name : t('spine.skin.base')}
            {x.approved ? ` · ${t('spine.skin.approved', { count: x.approved })}` : ''}
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn sm"
        onClick={() => {
          setName('')
          setErr(null)
          setAdding(true)
        }}
      >
        <Icon name="plus" size={13} />
        {t('spine.skin.add')}
      </button>
      {cur && (
        <button type="button" className="btn ghost sm danger" title={t('spine.skin.remove')} aria-label={t('spine.skin.remove')} onClick={() => setConfirm(true)}>
          <Icon name="trash" size={13} />
        </button>
      )}
      <small className="muted">{cur ? t('spine.skin.hintVariant', { name: cur.name }) : t('spine.skin.hintBase')}</small>
      <Modal open={adding} onClose={() => setAdding(false)} label={t('spine.skin.addTitle')}>
        <h2>
          <span className="dlg-ic">
            <Icon name="palette" size={22} />
          </span>
          {t('spine.skin.addTitle')}
        </h2>
        <p>{t('spine.skin.addDesc')}</p>
        <input
          className="inp"
          autoFocus
          value={name}
          maxLength={40}
          placeholder={t('spine.skin.namePlaceholder')}
          aria-label={t('spine.skin.name')}
          onChange={(e) => {
            setName(e.target.value)
            setErr(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void create()
          }}
        />
        {shownErr && <small className="note err">{t(`spine.skin.err.${shownErr === 'invalid' || shownErr === 'taken' ? shownErr : 'failed'}`)}</small>}
        <div className="acts">
          <button type="button" className="btn" onClick={() => setAdding(false)}>
            {t('dialogs.cancel')}
          </button>
          <button type="button" className="btn primary" disabled={!typed || !!localErr || busy} onClick={() => void create()}>
            {busy ? <span className="spin" /> : <Icon name="plus" size={14} />}
            {t('spine.skin.create')}
          </button>
        </div>
      </Modal>
      <Modal open={confirm} onClose={() => setConfirm(false)} label={t('spine.skin.remove')} role="alertdialog">
        <h2>
          <span className="dlg-ic danger">
            <Icon name="trash" size={22} />
          </span>
          {t('spine.skin.removeTitle', { name: cur?.name ?? '' })}
        </h2>
        <p>{t('spine.skin.removeDesc')}</p>
        <div className="acts">
          <button type="button" className="btn" onClick={() => setConfirm(false)}>
            {t('dialogs.cancel')}
          </button>
          <button
            type="button"
            className="btn danger solid"
            onClick={() => {
              setConfirm(false)
              if (cur) void removeVariant(cur.id)
            }}
          >
            <Icon name="trash" size={14} />
            {t('spine.skin.remove')}
          </button>
        </div>
      </Modal>
    </div>
  )
}
