import { useMemo, useState } from 'react'
import type { UpdateApi, UpdateSnapshot } from '@shared/update'
import { fallbackUpdateT, formatReleaseDate, useUpdateSnapshot, type UpdateT } from '../lib/updateText'
import { ReleaseNotes } from './UpdateBanner'
import '../styles/update.css'

export interface UpdateSettingsSectionProps {
  api: UpdateApi
  t?: UpdateT
  lang?: string
}

function stateLine(snap: UpdateSnapshot, t: UpdateT, lang: string): string {
  const line = baseLine(snap, t)
  const s = snap.state
  const date = 'date' in s ? formatReleaseDate(s.date, lang) : ''
  return date ? `${line} · ${t('releasedAt', { date })}` : line
}

function baseLine(snap: UpdateSnapshot, t: UpdateT): string {
  const s = snap.state
  switch (s.kind) {
    case 'idle':
      return t('stateIdle')
    case 'checking':
      return t('stateChecking')
    case 'available':
      return t('stateAvailable', { version: s.version })
    case 'notAvailable':
      return t('stateNotAvailable')
    case 'downloading':
      return t('stateDownloading', { version: s.version, percent: Math.round(s.percent) })
    case 'downloaded':
      return t('stateDownloaded', { version: s.version })
    case 'error':
      return t('stateError', { message: s.message })
    case 'dev':
      return t('stateDev')
  }
}

export function UpdateSettingsSection({ api, t, lang = 'vi' }: UpdateSettingsSectionProps): React.JSX.Element | null {
  const tr = useMemo(() => t ?? fallbackUpdateT(lang), [t, lang])
  const snap = useUpdateSnapshot(api)
  const [busy, setBusy] = useState(false)
  const [blocked, setBlocked] = useState(false)

  if (!snap) return null
  const s = snap.state
  const lastCheck = snap.lastCheckedAt
    ? new Date(snap.lastCheckedAt).toLocaleString(lang === 'en' ? 'en-US' : 'vi-VN')
    : tr('never')

  const run = async (fn: () => Promise<{ blocked?: boolean }>): Promise<void> => {
    setBusy(true)
    try {
      const res = await fn()
      setBlocked(Boolean(res.blocked))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="upd-settings">
      <h3 className="upd-settings-title">{tr('settingsTitle')}</h3>
      <div className="upd-kv">
        <span>{tr('currentVersion')}</span>
        <span className="upd-mono">{snap.currentVersion}</span>
      </div>
      <div className="upd-kv">
        <span>{tr('lastCheck')}</span>
        <span>{lastCheck}</span>
      </div>
      <div className={`upd-state upd-state-${s.kind}`}>{stateLine(snap, tr, lang)}</div>
      {s.kind === 'downloading' && (
        <div className="upd-bar">
          <div className="upd-bar-fill" style={{ width: `${Math.max(2, Math.min(100, s.percent))}%` }} />
        </div>
      )}
      {(s.kind === 'available' || s.kind === 'downloaded') && <ReleaseNotes notes={s.notes} t={tr} />}
      {blocked && s.kind === 'downloaded' && <div className="upd-blocked">{tr('blocked')}</div>}
      <div className="upd-actions upd-actions-start">
        <button
          className="btn sm"
          disabled={!snap.enabled || busy || s.kind === 'checking' || s.kind === 'downloading'}
          onClick={() => void run(api.check)}
        >
          {tr('checkNow')}
        </button>
        {s.kind === 'available' && (
          <button className="btn sm primary" disabled={busy} onClick={() => void run(api.download)}>
            {tr('download')}
          </button>
        )}
        {s.kind === 'downloaded' && (
          <button className="btn sm primary" disabled={busy} onClick={() => void run(api.install)}>
            {tr('restart')}
          </button>
        )}
      </div>
    </section>
  )
}

export default UpdateSettingsSection
