import { useMemo, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { skinAtlasName, skinSkeletonName, type SpineExportResult, type SpineProjectView } from '@shared/spine'
import { Icon } from '@renderer/components/Icon'
import i18n from '@renderer/i18n'
import { relTime } from '@renderer/lib/format'
import { useApp } from '@renderer/store/app'
import { useSpine } from '@renderer/store/spine'
import { toast } from '@renderer/store/toast'

const EXPORT_ERR = ['outIsSource', 'nothingApproved', 'noSkeleton', 'sourceChanged', 'pagePath'] as const

function exportErrorText(code: string): string {
  const k = code.split(':')[0]
  if (k === 'skinExists') return i18n.t('spine.skin.err.exists', { name: code.slice(k.length + 1) })
  return (EXPORT_ERR as readonly string[]).includes(k) ? i18n.t(`spineProject.export.err.${k as (typeof EXPORT_ERR)[number]}`) : i18n.t('spineProject.export.err.unknown', { detail: code })
}

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

  const baseStats = v.variants.find((x) => !x.id)
  const rows = useMemo(
    () =>
      v.pages.map((p) => {
        const total = v.regions.filter((r) => r.page === p.name).length
        const ok = baseStats?.pages[p.name] ?? 0
        return { page: p, total, ok, kept: total - ok }
      }),
    [v.pages, v.regions, baseStats]
  )
  const skinList = v.variants.filter((x) => x.id)
  const [skins, setSkins] = useState<string[]>(() => skinList.filter((x) => x.approved > 0).map((x) => x.id))
  const chosen = skinList.filter((x) => x.approved > 0 && skins.includes(x.id))
  const any = rows.some((r) => r.ok > 0) || rigN > 0 || chosen.length > 0

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
      const r = await window.gas.spine.exportRun(v.rel, outDir, chosen.map((x) => x.id))
      setResult(r)
      if (r.ok) toast(t('spineProject.export.done', { count: r.pages.length }))
      else toast(r.error ? exportErrorText(r.error) : t('spineProject.export.failed'), 'err')
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
        {skinList.length > 0 && (
          <fieldset className="spx-skins">
            <legend>{t('spine.skin.exportTitle')}</legend>
            {skinList.map((x) => (
              <label key={x.id} className={x.approved ? undefined : 'dim'}>
                <input
                  type="checkbox"
                  disabled={!x.approved}
                  checked={x.approved > 0 && skins.includes(x.id)}
                  onChange={(e) => setSkins((cur) => (e.target.checked ? [...cur, x.id] : cur.filter((id) => id !== x.id)))}
                />
                <b>{x.name}</b>
                <small className="muted">{x.approved ? t('spine.skin.approved', { count: x.approved }) : t('spine.skin.noneApproved')}</small>
              </label>
            ))}
            {chosen.length > 0 && <small className="muted">{t('spine.skin.exportHint', { skeleton: skinSkeletonName(v.skeletonName ?? ''), atlas: skinAtlasName(v.atlasPath?.split(/[\\/]/).pop() ?? '') })}</small>}
          </fieldset>
        )}
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
          {result.error && <div className="note err">{exportErrorText(result.error)}</div>}
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
            {result.skins && (
              <li>
                <b>
                  {result.skins.skeleton} · {result.skins.atlas}
                </b>
                <span className="muted">{result.skins.skins.map((x) => `${x.name} (${x.pages.join(', ')}: ${t('spine.skin.approved', { count: x.regions })})`).join(' · ')}</span>
              </li>
            )}
          </ul>
          {result.backupDir && <p className="muted">{t('spriteProject.export.backup', { path: result.backupDir })}</p>}
          <button type="button" className="btn spx-open" onClick={() => void window.gas.spriteGen.reveal(result.outDir)}>
            <Icon name="external" size={14} />
            {t('spriteProject.export.open')}
          </button>
        </section>
      )}
    </div>
  )
}
