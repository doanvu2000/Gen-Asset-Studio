import { useCallback, useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { CleanEntry, CleanId, DriveInfo, MoveCheck, MoveProgress, StorageScan, StorageSnapshot } from '@shared/storage'
import { formatBytes } from '@renderer/lib/updateText'
import { tDyn } from '@renderer/lib/env'
import { toast } from '@renderer/store/toast'
import { Icon } from './Icon'
import { Segmented } from './Segmented'

function DriveBar({ free, total }: { free: number; total: number }): ReactElement {
  const used = total > 0 ? Math.min(1, Math.max(0, (total - free) / total)) : 0
  const tone = free < 3 * 1024 ** 3 ? 'crit' : free < 10 * 1024 ** 3 ? 'low' : 'ok'
  return (
    <span className={`stg-bar ${tone}`} aria-hidden>
      <span style={{ width: `${Math.round(used * 100)}%` }} />
    </span>
  )
}

export function useStorageSnapshot(): [StorageSnapshot | null, () => Promise<void>] {
  const [snap, setSnap] = useState<StorageSnapshot | null>(null)
  const reload = useCallback(async () => setSnap(await window.gas.storage.get()), [])
  useEffect(() => {
    void reload()
    return window.gas.storage.onChange(setSnap)
  }, [reload])
  return [snap, reload]
}

export function useMoveProgress(): MoveProgress | null {
  const [p, setP] = useState<MoveProgress | null>(null)
  useEffect(() => window.gas.storage.onProgress(setP), [])
  return p
}

export function MoveProgressView({ progress }: { progress: MoveProgress }): ReactElement {
  const { t } = useTranslation()
  const pct = progress.total > 0 ? Math.round((progress.copied / progress.total) * 100) : 0
  return (
    <div className={progress.phase === 'error' ? 'stg-move err' : 'stg-move'} role="status" aria-live="polite">
      <div className="stg-move-h">
        <Icon name={progress.phase === 'error' ? 'alert' : 'refresh'} size={14} />
        <b>{t(`storage.phase.${progress.phase}`)}</b>
        {progress.phase === 'copy' && (
          <span className="muted mono">
            {formatBytes(progress.copied)} / {formatBytes(progress.total)}
          </span>
        )}
      </div>
      {(progress.phase === 'copy' || progress.phase === 'verify') && (
        <span className="stg-bar ok">
          <span style={{ width: `${progress.phase === 'verify' ? 100 : pct}%` }} />
        </span>
      )}
      {progress.error && <span className="muted mono">{t(`storage.moveError.${progress.error}`, { defaultValue: progress.error })}</span>}
    </div>
  )
}

export function MovePicker({ snap, onDone }: { snap: StorageSnapshot; onDone?: () => void }): ReactElement {
  const { t } = useTranslation()
  const [drives, setDrives] = useState<DriveInfo[] | null>(null)
  const [check, setCheck] = useState<MoveCheck | null>(null)
  const [checking, setChecking] = useState(false)
  const progress = useMoveProgress()
  const moving = !!progress && progress.phase !== 'idle' && progress.phase !== 'error'

  useEffect(() => {
    void window.gas.storage.drives().then(setDrives)
  }, [])

  const runCheck = async (dir: string): Promise<void> => {
    setChecking(true)
    try {
      setCheck(await window.gas.storage.check(dir))
    } finally {
      setChecking(false)
    }
  }

  const pickOther = async (): Promise<void> => {
    const dir = await window.gas.storage.pickDir()
    if (dir) await runCheck(dir)
  }

  const start = async (): Promise<void> => {
    if (!check?.ok) return
    const r = await window.gas.storage.move(check.target)
    if (r.phase === 'error') toast(t(`storage.moveError.${r.error ?? 'invalid'}`, { defaultValue: r.error ?? '' }), 'err')
    else onDone?.()
  }

  const currentRoot = snap.dataRoot.slice(0, 3).toLowerCase()

  return (
    <div className="stg-picker">
      <div className="stg-drives">
        {drives === null && <span className="muted">{t('storage.loadingDrives')}</span>}
        {drives?.map((d) => {
          const on = check ? check.target.slice(0, 3).toLowerCase() === d.root.toLowerCase() : false
          const here = d.root.toLowerCase() === currentRoot
          return (
            <button
              key={d.root}
              type="button"
              className={on ? 'stg-drive on' : 'stg-drive'}
              disabled={moving || checking}
              onClick={() => void runCheck(d.root)}
            >
              <span className="stg-drive-h">
                <Icon name="drive" size={16} />
                <b>{d.root.replace(/\\$/, '')}</b>
                {d.label && <span className="muted">{d.label}</span>}
                {d.system && <span className="chip c-gray">{t('storage.systemDrive')}</span>}
                {d.kind === 'removable' && <span className="chip c-orange">{t('storage.removable')}</span>}
                {here && <span className="chip c-blue">{t('storage.current')}</span>}
              </span>
              <DriveBar free={d.free} total={d.total} />
              <span className="muted">{t('storage.freeOf', { free: formatBytes(d.free), total: formatBytes(d.total) })}</span>
            </button>
          )
        })}
      </div>
      <div className="stg-picker-a">
        <button type="button" className="btn sm" disabled={moving || checking} onClick={() => void pickOther()}>
          <Icon name="folder" size={13} />
          {t('storage.pickFolder')}
        </button>
        {snap.custom && (
          <button type="button" className="btn sm" disabled={moving || checking} onClick={() => void runCheck(snap.defaultRoot)}>
            <Icon name="refresh" size={13} />
            {t('storage.backToDefault')}
          </button>
        )}
      </div>
      {check && !moving && (
        <div className={check.ok ? 'stg-check' : 'stg-check err'}>
          <div>
            <span className="muted">{t('storage.target')}</span> <span className="mono">{check.target}</span>
          </div>
          <div className="muted">{t('storage.needFree', { need: formatBytes(check.need), free: formatBytes(check.free) })}</div>
          {check.error && <div className="stg-err">{t(`storage.moveError.${check.error}`)}</div>}
          {check.removable && check.ok && <div className="stg-warn">{t('storage.removableWarn')}</div>}
          {check.ok && (
            <>
              <div className="muted">{t('storage.moveNote')}</div>
              <button type="button" className="btn sm primary" onClick={() => void start()}>
                <Icon name="right" size={13} />
                {t('storage.moveNow')}
              </button>
            </>
          )}
        </div>
      )}
      {progress && progress.phase !== 'idle' && <MoveProgressView progress={progress} />}
    </div>
  )
}

const CLEAN_ORDER: CleanId[] = ['codexImages', 'codexSessions', 'oldCodex', 'cache', 'updater']

export function StorageTab(): ReactElement {
  const { t } = useTranslation()
  const [snap] = useStorageSnapshot()
  const [scan, setScan] = useState<StorageScan | null>(null)
  const [plan, setPlan] = useState<CleanEntry[] | null>(null)
  const [pick, setPick] = useState<Set<CleanId>>(new Set(CLEAN_ORDER))
  const [moveOpen, setMoveOpen] = useState(false)
  const [cleaning, setCleaning] = useState(false)

  const refresh = useCallback(async () => {
    setScan(null)
    setPlan(null)
    const [s, p] = await Promise.all([window.gas.storage.scan(), window.gas.storage.cleanPlan()])
    setScan(s)
    setPlan(p)
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const toggle = (id: CleanId): void => {
    setPick((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const selected = (plan ?? []).filter((e) => pick.has(e.id) && e.bytes > 0)
  const selectedBytes = selected.reduce((s, e) => s + e.bytes, 0)

  const clean = async (): Promise<void> => {
    if (!selected.length) return
    setCleaning(true)
    try {
      const r = await window.gas.storage.clean(selected.map((e) => e.id))
      toast(t('storage.cleaned', { size: formatBytes(r.freed) }), r.errors ? 'warn' : 'ok')
      await refresh()
    } finally {
      setCleaning(false)
    }
  }

  if (!snap) return <div className="muted">{t('storage.loading')}</div>

  return (
    <>
      {snap.warn !== 'none' && (
        <div className={snap.warn === 'critical' ? 'stg-alert crit' : 'stg-alert'}>
          <Icon name="alert" size={14} />
          {t(snap.warn === 'critical' ? 'storage.warnCritical' : 'storage.warnLow', { free: formatBytes(snap.dataDrive?.free ?? 0) })}
        </div>
      )}
      <div className="group">
        <div className="row">
          <div className="rl">
            {t('storage.dataRoot')}
            <small className="muted mono stg-path">{snap.dataRoot}</small>
            {snap.dataDrive && (
              <small className="muted">
                <DriveBar free={snap.dataDrive.free} total={snap.dataDrive.total} />{' '}
                {t('storage.freeOf', { free: formatBytes(snap.dataDrive.free), total: formatBytes(snap.dataDrive.total) })}
              </small>
            )}
          </div>
          <button type="button" className="btn sm" onClick={() => void window.gas.storage.open(snap.dataRoot)}>
            <Icon name="folder" size={13} />
            {t('storage.open')}
          </button>
          <button type="button" className={moveOpen ? 'btn sm' : 'btn sm primary'} onClick={() => setMoveOpen((v) => !v)}>
            <Icon name="drive" size={13} />
            {t('storage.move')}
          </button>
        </div>
        {snap.dataDrive?.system && !snap.custom && <div className="row stg-hint muted">{t('storage.systemHint')}</div>}
        {snap.codexHomeOverridden && <div className="row stg-hint muted">{t('storage.codexHomeEnv')}</div>}
        {moveOpen && (
          <div className="row stg-row-block">
            <MovePicker snap={snap} />
          </div>
        )}
      </div>

      <div className="group">
        <div className="row">
          <div className="rl">
            {t('storage.autoClean')}
            <small className="muted">{t('storage.autoCleanHint')}</small>
          </div>
          <Segmented
            value={snap.autoClean ? 'on' : 'off'}
            options={[
              { value: 'on', label: t('storage.on') },
              { value: 'off', label: t('storage.off') }
            ]}
            onChange={(v) => void window.gas.storage.setAutoClean(v === 'on')}
            ariaLabel={t('storage.autoClean')}
          />
        </div>
        {CLEAN_ORDER.map((id) => {
          const e = plan?.find((x) => x.id === id)
          return (
            <label key={id} className="row stg-clean">
              <input type="checkbox" checked={pick.has(id)} disabled={!e || e.bytes === 0} onChange={() => toggle(id)} />
              <div className="rl">
                {t(`storage.clean.${id}`)}
                <small className="muted">{t(`storage.clean.${id}Hint`)}</small>
              </div>
              <span className="mono muted">{e ? formatBytes(e.bytes) : '…'}</span>
            </label>
          )
        })}
        <div className="row">
          <div className="rl muted">{plan ? t('storage.cleanTotal', { size: formatBytes(selectedBytes) }) : t('storage.scanning')}</div>
          <button type="button" className="btn sm primary" disabled={cleaning || !selected.length} onClick={() => void clean()}>
            <Icon name="trash" size={13} />
            {t('storage.cleanNow')}
          </button>
        </div>
      </div>

      <div className="group">
        <div className="row">
          <div className="rl">{t('storage.usage')}</div>
          <button type="button" className="btn sm" onClick={() => void refresh()} disabled={!scan}>
            <Icon name="refresh" size={13} />
            {t('storage.rescan')}
          </button>
        </div>
        {!scan && <div className="row muted">{t('storage.scanning')}</div>}
        {scan?.items.map((it) => (
          <div key={it.id} className="row">
            <div className="rl">
              {t(`storage.item.${it.id}`)}
              <small className="muted mono stg-path" title={it.path}>
                {it.path}
              </small>
              {!it.movable && <small className="muted">{tDyn(t, `storage.item.${it.id}Note`)}</small>}
            </div>
            <span className="mono">{formatBytes(it.bytes)}</span>
            <button type="button" className="icon-btn" title={t('storage.open')} aria-label={t('storage.open')} onClick={() => void window.gas.storage.open(it.path)}>
              <Icon name="folder" size={14} />
            </button>
          </div>
        ))}
      </div>
    </>
  )
}
