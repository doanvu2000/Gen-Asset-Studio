import { useEffect, useMemo, useState, type DragEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { DIRECTIONS, NEW_ANIM_PRESETS, NEW_MAX_FRAMES, ROW_PRESETS, type DirSet, type SpriteProjectView, type ViewAngle } from '@shared/sprite'
import { Modal } from '@renderer/components/Modal'
import { Icon } from '@renderer/components/Icon'
import { Segmented } from '@renderer/components/Segmented'
import { useSprite } from '@renderer/store/sprite'
import { toast } from '@renderer/store/toast'

interface Char {
  path: string
  url: string
  w: number
  h: number
}

interface AnimRow {
  name: string
  frames: number
  on: boolean
  custom: boolean
}

const MIRROR_PAIRS: Array<[string, string]> = [
  ['E', 'W'],
  ['NE', 'NW'],
  ['SE', 'SW']
]

function slug(s: string): string {
  return (
    s
      .normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/đ/g, 'd')
      .replace(/Đ/g, 'D')
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 60) || 'sheet'
  )
}

function uniqueName(base: string, taken: Set<string>): string {
  let n = base
  for (let i = 2; taken.has(n); i++) n = `${base}_${i}`
  return n
}

function presetRows(): AnimRow[] {
  return NEW_ANIM_PRESETS.map((p) => ({ name: p.name, frames: p.frames, on: p.on, custom: false }))
}

function readImage(url: string): Promise<{ w: number; h: number }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight })
    img.onerror = () => resolve({ w: 0, h: 0 })
    img.src = url
  })
}

function Body({ v, onClose }: { v: SpriteProjectView; onClose: () => void }): ReactElement {
  const { t } = useTranslation()
  const setSettings = useSprite((s) => s.setSettings)
  const st = v.settings
  const taken = useMemo(() => new Set(v.sheets.map((s) => s.name.replace(/\.[^.]+$/, '').toLowerCase())), [v.sheets])
  const [char, setChar] = useState<Char | null>(null)
  const [name, setName] = useState(() => uniqueName(slug(v.name), taken))
  const [desc, setDesc] = useState('')
  const [cell, setCell] = useState<64 | 128 | 256>(st.cell)
  const [rows, setRows] = useState<AnimRow[]>(presetRows)
  const [customName, setCustomName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [over, setOver] = useState(false)

  useEffect(() => {
    return () => {
      if (char?.url.startsWith('blob:')) URL.revokeObjectURL(char.url)
    }
  }, [char])

  const pick = async (): Promise<void> => {
    const r = await window.gas.spriteGen.pickCharacter()
    if (r) {
      setChar({ path: r.path, url: r.url, w: r.w, h: r.h })
      setError(null)
    }
  }

  const onDrop = async (e: DragEvent): Promise<void> => {
    e.preventDefault()
    setOver(false)
    const file = [...e.dataTransfer.files].find((f) => /\.(png|jpe?g|webp)$/i.test(f.name))
    if (!file) {
      setError(t('spriteProject.create.dropBad'))
      return
    }
    const path = window.gas.files.pathFor(file)
    if (!path) return
    const url = URL.createObjectURL(file)
    const size = await readImage(url)
    setChar({ path, url, w: size.w, h: size.h })
    setError(null)
  }

  const setDirs = (dirSet: DirSet): void => {
    const preset = st.rowPreset === 'custom' ? 'flame' : st.rowPreset
    void setSettings({ dirSet, rowPreset: preset, rowOrder: dirSet ? ROW_PRESETS[preset][dirSet] : [] })
  }

  const selected = rows.filter((r) => r.on)
  const dirList = st.dirSet ? (st.rowOrder.length ? st.rowOrder : DIRECTIONS[st.dirSet]) : []
  const dirCount = Math.max(1, dirList.length)
  const mirrored = st.mirror && st.dirSet ? MIRROR_PAIRS.filter(([a, b]) => dirList.includes(a as never) && dirList.includes(b as never)).length : 0
  const sheetRows = selected.length * dirCount
  const sheetCols = selected.reduce((m, r) => Math.max(m, r.frames), 0)
  const gens = selected.length * (dirCount - mirrored)
  const cleanName = slug(name)
  const nameTaken = taken.has(cleanName)
  const canCreate = !!char && !!cleanName && !nameTaken && selected.length > 0 && !busy

  const create = async (): Promise<void> => {
    if (!char || !canCreate) return
    setBusy(true)
    setError(null)
    try {
      const r = await window.gas.spriteGen.createSheet(v.rel, {
        name: cleanName,
        character: char.path,
        description: desc.trim(),
        anims: selected.map((a) => ({ name: a.name.trim(), frames: a.frames })),
        cell
      })
      if (r.error || !r.view) {
        setError(r.error === 'noCharacter' ? t('spriteProject.create.errNoCharacter') : r.error === 'noAnims' ? t('spriteProject.create.errNoAnims') : r.error ?? t('spriteProject.create.failed'))
        return
      }
      useSprite.setState({ view: r.view, sheetId: r.sheetId ?? useSprite.getState().sheetId })
      toast(t('spriteProject.create.created', { name: `${cleanName}.png` }))
      onClose()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const addCustom = (): void => {
    const n = customName.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '')
    if (!n || rows.some((r) => r.name === n)) return
    setRows([...rows, { name: n, frames: 6, on: true, custom: true }])
    setCustomName('')
  }

  return (
    <div className="nsd">
      <h2>
        <span className="dlg-ic">
          <Icon name="sparkles" size={20} />
        </span>
        {t('spriteProject.create.title')}
      </h2>
      <p className="nsd-sub muted">{t('spriteProject.create.desc')}</p>
      <div className="nsd-cols">
        <div className="nsd-left">
          <div
            className={over ? 'nsd-char ck over' : 'nsd-char ck'}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes('Files')) return
              e.preventDefault()
              setOver(true)
            }}
            onDragLeave={() => setOver(false)}
            onDrop={(e) => void onDrop(e)}
          >
            {char ? (
              <img src={char.url} alt="" draggable={false} />
            ) : (
              <div className="nsd-char-empty">
                <Icon name="image" size={30} />
                <span>{t('spriteProject.create.charEmpty')}</span>
              </div>
            )}
          </div>
          <div className="nsd-char-row">
            <button type="button" className="btn sm" onClick={() => void pick()}>
              <Icon name="upload" size={13} />
              {char ? t('spriteProject.create.charChange') : t('spriteProject.create.charPick')}
            </button>
            {char && <span className="muted mono">{char.w} × {char.h}</span>}
          </div>
          <small className="muted">{t('spriteProject.create.charHint')}</small>
          <label className="fld">
            <span>{t('spriteProject.create.describe')}</span>
            <textarea className="inp" rows={3} value={desc} maxLength={600} placeholder={t('spriteProject.create.describePh')} onChange={(e) => setDesc(e.target.value)} />
          </label>
        </div>
        <div className="nsd-right">
          <label className="fld">
            <span>{t('spriteProject.create.name')}</span>
            <div className="nsd-name">
              <input className="inp" value={name} maxLength={60} spellCheck={false} onChange={(e) => setName(e.target.value)} />
              <span className="muted mono">.png</span>
            </div>
            {nameTaken && <small className="fld-err">{t('spriteProject.create.nameTaken')}</small>}
          </label>
          <div className="nsd-grid2">
            <label className="fld">
              <span>{t('spriteProject.settings.dirs')}</span>
              <Segmented<'4' | '6' | '8' | '0'>
                value={String(st.dirSet) as '4' | '6' | '8' | '0'}
                ariaLabel={t('spriteProject.settings.dirs')}
                options={(['4', '6', '8', '0'] as const).map((k) => ({ value: k, label: t(`spriteProject.settings.dir_${k}`) }))}
                onChange={(k) => setDirs(Number(k) as DirSet)}
              />
            </label>
            <label className="fld">
              <span>{t('spriteProject.settings.cell')}</span>
              <Segmented<'64' | '128' | '256'>
                value={String(cell) as '64' | '128' | '256'}
                ariaLabel={t('spriteProject.settings.cell')}
                options={(['64', '128', '256'] as const).map((k) => ({ value: k, label: `${k} px` }))}
                onChange={(k) => setCell(Number(k) as 64 | 128 | 256)}
              />
            </label>
          </div>
          <label className="fld">
            <span>{t('spriteProject.settings.view')}</span>
            <Segmented<ViewAngle>
              value={st.view}
              ariaLabel={t('spriteProject.settings.view')}
              options={(['topdown', 'iso', 'side'] as const).map((k) => ({ value: k, label: t(`spriteProject.view.${k}`) }))}
              onChange={(view) => void setSettings({ view })}
            />
          </label>
          <div className="fld">
            <span>{t('spriteProject.create.anims')}</span>
            <div className="nsd-anims">
              {rows.map((r, i) => (
                <div key={r.name} className={r.on ? 'nsd-anim on' : 'nsd-anim'}>
                  <label>
                    <input type="checkbox" checked={r.on} onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, on: e.target.checked } : x)))} />
                    <b>{r.name}</b>
                    {!r.custom && <small className="muted">{t(`spriteProject.create.anim_${r.name as 'idle' | 'walk' | 'run' | 'attack' | 'hurt' | 'die'}`)}</small>}
                  </label>
                  <div className="nsd-step">
                    <button type="button" className="btn ghost sm" disabled={!r.on || r.frames <= 2} aria-label="-" onClick={() => setRows(rows.map((x, j) => (j === i ? { ...x, frames: Math.max(2, x.frames - 1) } : x)))}>
                      −
                    </button>
                    <span className="mono">{t('spriteProject.create.frames', { count: r.frames })}</span>
                    <button
                      type="button"
                      className="btn ghost sm"
                      disabled={!r.on || r.frames >= NEW_MAX_FRAMES}
                      aria-label="+"
                      onClick={() => setRows(rows.map((x, j) => (j === i ? { ...x, frames: Math.min(NEW_MAX_FRAMES, x.frames + 1) } : x)))}
                    >
                      +
                    </button>
                    {r.custom && (
                      <button type="button" className="btn ghost sm danger" aria-label={t('spriteProject.create.removeAnim')} onClick={() => setRows(rows.filter((_, j) => j !== i))}>
                        <Icon name="x" size={12} />
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div className="nsd-add">
                <input
                  className="inp"
                  value={customName}
                  maxLength={30}
                  placeholder={t('spriteProject.create.customPh')}
                  onChange={(e) => setCustomName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      addCustom()
                    }
                  }}
                />
                <button type="button" className="btn sm" disabled={!customName.trim()} onClick={addCustom}>
                  <Icon name="plus" size={12} />
                  {t('spriteProject.create.addAnim')}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div className="nsd-sum">
        <Icon name="grid" size={14} />
        <span>
          {t('spriteProject.create.summary', { rows: sheetRows, cols: sheetCols, w: sheetCols * cell, h: sheetRows * cell, gens })}
          {mirrored > 0 && ` · ${t('spriteProject.create.mirrorNote', { count: selected.length * mirrored })}`}
        </span>
      </div>
      {error && <div className="fld-err">{error}</div>}
      <div className="acts">
        <button type="button" className="btn" onClick={onClose}>
          {t('dialogs.cancel')}
        </button>
        <button type="button" className="btn primary" disabled={!canCreate} onClick={() => void create()}>
          {busy ? <span className="spin" /> : <Icon name="plus" size={14} />}
          {t('spriteProject.create.create')}
        </button>
      </div>
    </div>
  )
}

export function NewSheetDialog({ open, v, onClose }: { open: boolean; v: SpriteProjectView; onClose: () => void }): ReactElement {
  const { t } = useTranslation()
  return (
    <Modal open={open} onClose={onClose} className="kinds-dlg nsd-dlg" label={t('spriteProject.create.title')}>
      {open && <Body v={v} onClose={onClose} />}
    </Modal>
  )
}
