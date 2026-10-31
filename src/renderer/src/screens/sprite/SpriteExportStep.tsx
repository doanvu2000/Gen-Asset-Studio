import { useEffect, useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { SheetSnippets, SheetView, SpriteExportResult, SpriteProjectView } from '@shared/sprite'
import { Segmented } from '@renderer/components/Segmented'
import { Icon } from '@renderer/components/Icon'
import { relTime } from '@renderer/lib/format'
import { isApproved } from '@renderer/lib/sprite'
import { useApp } from '@renderer/store/app'
import { useSprite } from '@renderer/store/sprite'
import { toast } from '@renderer/store/toast'

function defaultOut(dir: string): string {
  return `${dir.replace(/[\\/]+$/, '')}${dir.includes('/') && !dir.includes('\\') ? '/' : '\\'}output`
}

type SnipTab = 'flame' | 'android' | 'ios'

function Snippets({ rel, sheet }: { rel: string; sheet: SheetView }): ReactElement {
  const { t } = useTranslation()
  const [data, setData] = useState<SheetSnippets | null>(null)
  const [tab, setTab] = useState<SnipTab>('flame')
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let live = true
    setFailed(false)
    window.gas.spriteGen
      .snippets(rel, sheet.id)
      .then((r) => {
        if (!live) return
        setData(r)
        setFailed(!r)
      })
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [rel, sheet.id, sheet.anims])
  const code = data ? data[tab] : ''
  const copy = async (): Promise<void> => {
    if (!code) return
    await navigator.clipboard.writeText(code)
    toast(t('spriteProject.export.copied'))
  }
  return (
    <div className="spx-snip">
      <div className="spx-snip-head">
        <b>{sheet.name}</b>
        {data && (
          <span className="muted mono">
            {data.image} · {data.json}
          </span>
        )}
        <span className="grow" />
        <Segmented<SnipTab>
          value={tab}
          ariaLabel={t('spriteProject.export.useTitle')}
          options={[
            { value: 'flame', label: 'Flame' },
            { value: 'android', label: 'Android (Kotlin)' },
            { value: 'ios', label: 'iOS (Swift)' }
          ]}
          onChange={setTab}
        />
        <button type="button" className="btn sm" disabled={!code} onClick={() => void copy()}>
          <Icon name="copy" size={13} />
          {t('spriteProject.export.copy')}
        </button>
      </div>
      {failed ? <div className="note warn">{t('spriteProject.export.snipFailed')}</div> : <pre className="spx-code mono">{code || '…'}</pre>}
    </div>
  )
}

export function SpriteExportStep({ v }: { v: SpriteProjectView }): ReactElement {
  const { t } = useTranslation()
  const lang = useApp((s) => s.settings.lang)
  const refresh = useSprite((s) => s.refresh)
  const [outDir, setOutDir] = useState(v.export.outDir || defaultOut(v.dir))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SpriteExportResult | null>(null)

  const rows = useMemo(
    () =>
      v.sheets.map((sheet) => {
        const strips = v.strips.filter((s) => s.sheetId === sheet.id)
        const ok = strips.filter((s) => isApproved(v, s))
        const replaced = new Set<number>()
        for (const s of ok) for (const f of sheet.anims.find((a) => a.id === s.animId)?.frames ?? []) replaced.add(f)
        const total = sheet.frames.length - sheet.empty.length
        return { sheet, strips: strips.length, ok: ok.length, replaced: replaced.size, kept: Math.max(0, total - replaced.size) }
      }),
    [v]
  )
  const any = rows.some((r) => r.ok > 0)
  const newSheets = v.sheets.filter((sh) => sh.origin === 'new')

  const pick = async (): Promise<void> => {
    const d = await window.gas.spriteGen.exportDir(v.rel)
    if (d) setOutDir(d)
  }

  const run = async (): Promise<void> => {
    if (busy || !any) return
    setBusy(true)
    setResult(null)
    try {
      const r = await window.gas.spriteGen.exportRun(v.rel, outDir)
      setResult(r)
      if (r.ok) toast(t('spriteProject.export.done', { count: r.sheets.length }))
      else toast(r.error ?? t('spriteProject.export.failed'), 'err')
      void refresh()
    } catch (e) {
      toast(String((e as Error).message ?? e), 'err')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="spx-wrap">
      <section className="spx-card">
        <h3>
          <Icon name="folder" size={14} />
          {t('spriteProject.export.outDir')}
        </h3>
        <div className="spx-dir">
          <span className="mono" title={outDir}>
            {outDir}
          </span>
          <button type="button" className="btn sm" onClick={() => void pick()}>
            {t('spriteProject.export.change')}
          </button>
        </div>
        <p className="muted">{t('spriteProject.export.desc')}</p>
        {v.export.lastAt > 0 && <p className="muted">{t('spriteProject.export.last', { count: v.export.lastSheets, frames: v.export.lastFrames, time: relTime(v.export.lastAt, lang) })}</p>}
      </section>
      <section className="spx-card">
        <h3>
          <Icon name="grid" size={14} />
          {t('spriteProject.export.sheets')}
        </h3>
        <table className="spx-table">
          <thead>
            <tr>
              <th>{t('spriteProject.export.sheet')}</th>
              <th>{t('spriteProject.export.strips')}</th>
              <th>{t('spriteProject.export.replaced')}</th>
              <th>{t('spriteProject.export.kept')}</th>
              <th>{t('spriteProject.export.atlas')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.sheet.id} className={r.ok ? undefined : 'dim'}>
                <td>
                  <b>{r.sheet.name}</b>
                  <small className="mono">
                    {r.sheet.w}×{r.sheet.h}
                  </small>
                </td>
                <td>
                  {r.ok}/{r.strips}
                </td>
                <td>{r.replaced}</td>
                <td>{r.kept}</td>
                <td>{r.sheet.origin === 'new' ? <span className="chip c-orange">{t('spriteProject.export.atlasNew', { name: r.sheet.name.replace(/\.[^.]+$/, '') })}</span> : (r.sheet.atlasName ?? '—')}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!any && (
          <div className="note warn">
            <Icon name="alert" size={14} />
            <span>{t('spriteProject.export.none')}</span>
          </div>
        )}
        <div className="spx-acts">
          <button type="button" className="btn primary" disabled={!any || busy} onClick={() => void run()}>
            {busy ? <span className="spin" /> : <Icon name="download" size={14} />}
            {t('spriteProject.export.run')}
          </button>
        </div>
      </section>
      {newSheets.length > 0 && (
        <section className="spx-card">
          <h3>
            <Icon name="terminal" size={14} />
            {t('spriteProject.export.useTitle')}
          </h3>
          <p className="muted">{t('spriteProject.export.useDesc')}</p>
          {newSheets.map((sh) => (
            <Snippets key={sh.id} rel={v.rel} sheet={sh} />
          ))}
        </section>
      )}
      {result && (
        <section className="spx-card">
          <h3>
            <Icon name={result.ok ? 'check' : 'alert'} size={14} />
            {result.ok ? t('spriteProject.export.resultOk') : t('spriteProject.export.failed')}
          </h3>
          {result.error && <div className="note err">{result.error}</div>}
          <ul className="spx-res">
            {result.sheets.map((s) => (
              <li key={s.file}>
                <b>{s.name}</b>
                <span className="muted">{t('spriteProject.export.resLine', { frames: s.frames, kept: s.kept })}</span>
                {s.atlas && <span className="chip c-blue">{s.atlas}</span>}
                {s.snippets && (
                  <span className="chip c-orange" title={s.snippets}>
                    {s.snippets.split(/[\\/]/).pop()}
                  </span>
                )}
              </li>
            ))}
          </ul>
          {result.sheets.some((x) => x.snippets) && <p className="muted">{t('spriteProject.export.newNote')}</p>}
          {result.backupDir && <p className="muted">{t('spriteProject.export.backup', { path: result.backupDir })}</p>}
          <button type="button" className="btn" onClick={() => void window.gas.spriteGen.reveal(result.outDir)}>
            <Icon name="external" size={14} />
            {t('spriteProject.export.open')}
          </button>
        </section>
      )}
    </div>
  )
}
