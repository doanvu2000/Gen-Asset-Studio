import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { SpineExportResult, SpineProjectView } from '@shared/spine'
import { Icon } from '@renderer/components/Icon'
import { relTime } from '@renderer/lib/format'
import { useApp } from '@renderer/store/app'
import { useSpine } from '@renderer/store/spine'
import { toast } from '@renderer/store/toast'

function defaultOut(dir: string): string {
  return `${dir.replace(/[\\/]+$/, '')}${dir.includes('/') && !dir.includes('\\') ? '/' : '\\'}output`
}

export function SpineExportStep({ v }: { v: SpineProjectView }): ReactElement {
  const { t } = useTranslation()
  const lang = useApp((s) => s.settings.lang)
  const refresh = useSpine((s) => s.refresh)
  const flushRig = useSpine((s) => s.flushRig)
  const [outDir, setOutDir] = useState(v.export.outDir || defaultOut(v.dir))
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<SpineExportResult | null>(null)
  const rigN = Object.keys(v.rig.bones).length + Object.keys(v.rig.attachments).length

  const rows = useMemo(
    () =>
      v.pages.map((p) => {
        const regions = v.regions.filter((r) => r.page === p.name)
        const ok = regions.filter((r) => r.decision === 'approved' && r.url)
        return { page: p, total: regions.length, ok: ok.length, kept: regions.length - ok.length }
      }),
    [v.pages, v.regions]
  )
  const any = rows.some((r) => r.ok > 0) || rigN > 0

  const pick = async (): Promise<void> => {
    const d = await window.gas.spine.exportDir(v.rel)
    if (d) setOutDir(d)
  }

  const run = async (): Promise<void> => {
    if (busy || !any) return
    setBusy(true)
    setResult(null)
    try {
      await flushRig()
      const r = await window.gas.spine.exportRun(v.rel, outDir)
      setResult(r)
      if (r.ok) toast(t('spineProject.export.done', { count: r.pages.length }))
      else toast(r.error ?? t('spineProject.export.failed'), 'err')
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
        <p className="muted">{t('spineProject.export.desc')}</p>
        {v.export.lastAt > 0 && <p className="muted">{t('spineProject.export.last', { pages: v.export.lastPages, regions: v.export.lastRegions, time: relTime(v.export.lastAt, lang) })}</p>}
      </section>
      <section className="spx-card">
        <h3>
          <Icon name="image" size={14} />
          {t('spineProject.export.pages')}
        </h3>
        <table className="spx-table">
          <thead>
            <tr>
              <th>{t('spineProject.export.page')}</th>
              <th>{t('spineProject.export.replaced')}</th>
              <th>{t('spineProject.export.kept')}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.page.name} className={r.ok ? undefined : 'dim'}>
                <td>
                  <b>{r.page.name}</b>
                  <small className="mono">
                    {r.page.w}×{r.page.h}
                  </small>
                </td>
                <td>
                  {r.ok}/{r.total}
                </td>
                <td>{r.kept}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className={rigN ? 'note warn' : 'note'}>
          <Icon name={rigN ? 'link' : 'file'} size={14} />
          <span>{rigN ? t('spineProject.export.rigNew', { count: rigN, name: v.skeletonName ?? '' }) : t('spineProject.export.rigCopy', { name: v.skeletonName ?? '' })}</span>
        </div>
        <p className="muted">{t('spineProject.export.atlasCopy')}</p>
        {!any && (
          <div className="note warn">
            <Icon name="alert" size={14} />
            <span>{t('spineProject.export.none')}</span>
          </div>
        )}
        <div className="spx-acts">
          <button type="button" className="btn primary" disabled={!any || busy} onClick={() => void run()}>
            {busy ? <span className="spin" /> : <Icon name="download" size={14} />}
            {t('spineProject.export.run')}
          </button>
        </div>
      </section>
      {result && (
        <section className="spx-card">
          <h3>
            <Icon name={result.ok ? 'check' : 'alert'} size={14} />
            {result.ok ? t('spineProject.export.resultOk') : t('spineProject.export.failed')}
          </h3>
          {result.error && <div className="note err">{result.error}</div>}
          <ul className="spx-res">
            {result.pages.map((p) => (
              <li key={p.name}>
                <b>{p.name}</b>
                <span className="muted">{t('spineProject.export.resLine', { regions: p.regions, kept: p.kept })}</span>
              </li>
            ))}
            {result.skeleton && (
              <li>
                <b>{result.skeleton}</b>
                <span className={result.rigChanged ? 'chip c-orange' : 'chip c-gray'}>{result.rigChanged ? t('spineProject.export.jsonNew') : t('spineProject.export.jsonCopy')}</span>
              </li>
            )}
          </ul>
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
