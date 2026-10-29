import { useMemo, useState } from 'react'
import { parseReleaseNotes, type NoteSectionKind, type UpdateApi } from '@shared/update'
import { fallbackUpdateT, formatBytes, useUpdateSnapshot, type UpdateKey, type UpdateT } from '../lib/updateText'
import '../styles/update.css'

const SECTION_KEY: Record<NoteSectionKind, UpdateKey | null> = {
  update: 'sectionUpdate',
  add: 'sectionAdd',
  remove: 'sectionRemove',
  fixbug: 'sectionFixbug',
  other: null
}

export function ReleaseNotes({ notes, t }: { notes: string; t: UpdateT }): React.JSX.Element {
  const sections = useMemo(() => parseReleaseNotes(notes), [notes])
  if (sections.length === 0) return <div className="upd-notes-empty">{t('noNotes')}</div>
  return (
    <div className="upd-notes">
      {sections.map((s, i) => {
        const key = SECTION_KEY[s.kind]
        return (
          <div className="upd-section" key={`${s.kind}-${i}`}>
            {key && <span className={`upd-label upd-label-${s.kind}`}>{t(key)}</span>}
            <ul>
              {s.items.map((item, j) => (
                <li key={j}>{item}</li>
              ))}
            </ul>
          </div>
        )
      })}
    </div>
  )
}

export interface UpdateBannerProps {
  api: UpdateApi
  t?: UpdateT
  lang?: string
}

export function UpdateBanner({ api, t, lang = 'vi' }: UpdateBannerProps): React.JSX.Element | null {
  const tr = useMemo(() => t ?? fallbackUpdateT(lang), [t, lang])
  const snap = useUpdateSnapshot(api)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [acted, setActed] = useState(false)
  const [blockedFor, setBlockedFor] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!snap) return null
  const state = snap.state
  const version = 'version' in state ? state.version : ''
  const key = `${state.kind}:${version}`

  const visible =
    (state.kind === 'available' || state.kind === 'downloading' || state.kind === 'downloaded') && dismissed !== key
  const showError = state.kind === 'error' && acted && dismissed !== key
  if (!visible && !showError) return null

  const later = (): void => {
    setDismissed(key)
    setBlockedFor(null)
  }

  const download = async (): Promise<void> => {
    setActed(true)
    setBusy(true)
    try {
      await api.download()
    } finally {
      setBusy(false)
    }
  }

  const restart = async (): Promise<void> => {
    setActed(true)
    setBusy(true)
    try {
      const res = await api.install()
      setBlockedFor(res.blocked ? version : null)
    } finally {
      setBusy(false)
    }
  }

  const retry = async (): Promise<void> => {
    setBusy(true)
    try {
      await api.check()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="upd-banner" role="dialog" aria-live="polite">
      <div className="upd-head">
        <div className="upd-icon" aria-hidden>
          <svg viewBox="0 0 24 24" width="18" height="18">
            <path d="M12 4v11m0 0-4.5-4.5M12 15l4.5-4.5M5 19h14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="upd-titles">
          {state.kind === 'available' && (
            <>
              <div className="upd-title">{tr('availableTitle', { version })}</div>
              <div className="upd-sub">{tr('availableSub', { current: snap.currentVersion })}</div>
            </>
          )}
          {state.kind === 'downloading' && <div className="upd-title">{tr('downloadingTitle', { version })}</div>}
          {state.kind === 'downloaded' && (
            <>
              <div className="upd-title">{tr('downloadedTitle', { version })}</div>
              <div className="upd-sub">{tr('downloadedSub')}</div>
            </>
          )}
          {state.kind === 'error' && (
            <>
              <div className="upd-title">{tr('errorTitle')}</div>
              <div className="upd-sub upd-error">{state.message}</div>
            </>
          )}
        </div>
      </div>

      {(state.kind === 'available' || state.kind === 'downloaded') && (
        <div className="upd-notes-wrap">
          <div className="upd-notes-title">{tr('notesTitle')}</div>
          <ReleaseNotes notes={state.notes} t={tr} />
        </div>
      )}

      {state.kind === 'downloading' && (
        <div className="upd-progress">
          <div className="upd-bar">
            <div className="upd-bar-fill" style={{ width: `${Math.max(2, Math.min(100, state.percent))}%` }} />
          </div>
          <div className="upd-progress-text">
            <span>{Math.round(state.percent)}%</span>
            <span>
              {tr('progress', {
                transferred: formatBytes(state.transferred),
                total: formatBytes(state.total),
                speed: formatBytes(state.bytesPerSecond)
              })}
            </span>
          </div>
        </div>
      )}

      {state.kind === 'downloaded' && blockedFor === version && <div className="upd-blocked">{tr('blocked')}</div>}

      <div className="upd-actions">
        {state.kind === 'available' && (
          <>
            <button className="btn sm ghost" onClick={later}>
              {tr('later')}
            </button>
            <button className="btn sm primary" disabled={busy} onClick={() => void download()}>
              {tr('download')}
            </button>
          </>
        )}
        {state.kind === 'downloading' && (
          <button className="btn sm ghost" onClick={later}>
            {tr('later')}
          </button>
        )}
        {state.kind === 'downloaded' && (
          <>
            <button className="btn sm ghost" onClick={later}>
              {tr('later')}
            </button>
            <button className="btn sm primary" disabled={busy} onClick={() => void restart()}>
              {tr('restart')}
            </button>
          </>
        )}
        {state.kind === 'error' && (
          <>
            <button className="btn sm ghost" onClick={later}>
              {tr('close')}
            </button>
            <button className="btn sm" disabled={busy} onClick={() => void retry()}>
              {tr('retry')}
            </button>
          </>
        )}
      </div>
    </div>
  )
}

export default UpdateBanner
