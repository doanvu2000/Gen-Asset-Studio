import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { StatsGroup, StatsSummary } from '@shared/stats'
import { Segmented } from './Segmented'

type RangeDays = '7' | '30'

const DAY_MS = 86_400_000

function pct(part: number, whole: number): string {
  return whole > 0 ? `${Math.round((part / whole) * 100)}%` : '-'
}

function range(days: number): { from: number; to: number } {
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  return { from: start.getTime() - (days - 1) * DAY_MS, to: Date.now() }
}

function Chart({ days }: { days: StatsSummary['byDay'] }): ReactElement {
  const max = Math.max(1, ...days.map((d) => d.count))
  return (
    <div className="stats-chart" role="img" aria-label={days.map((d) => `${d.day}: ${d.count}`).join(', ')}>
      {days.map((d) => (
        <div key={d.day} className="stats-col" title={`${d.day}: ${d.count}`}>
          <span className="stats-bar" style={{ height: `${(d.count / max) * 100}%` }}>
            {d.errors > 0 && <i style={{ height: `${(d.errors / d.count) * 100}%` }} />}
          </span>
        </div>
      ))}
    </div>
  )
}

function Table({ title, rows }: { title: string; rows: StatsGroup[] }): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="group stats-table">
      <div className="stats-th">
        <b>{title}</b>
        <span>{t('stats.count')}</span>
        <span>{t('stats.firstPass')}</span>
        <span>{t('stats.regen')}</span>
      </div>
      {rows.map((r) => (
        <div key={r.key} className="stats-tr">
          <span className="stats-name" title={r.key}>
            {r.name}
          </span>
          <span>{r.count}</span>
          <span>{pct(r.firstTryPass, r.firstTry)}</span>
          <span>{r.regen}</span>
        </div>
      ))}
    </div>
  )
}

export function StatsTab(): ReactElement {
  const { t } = useTranslation()
  const [days, setDays] = useState<RangeDays>('7')
  const [data, setData] = useState<StatsSummary | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    setFailed(false)
    window.gas.stats
      .summary(range(Number(days)))
      .then((s) => live && setData(s))
      .catch(() => live && setFailed(true))
    return () => {
      live = false
    }
  }, [days])

  const options = [
    { value: '7', label: t('stats.days7') },
    { value: '30', label: t('stats.days30') }
  ] as const

  return (
    <>
      <div className="row stats-head">
        <div className="rl">
          <b>{t('stats.title')}</b>
          <p className="muted small">{t('stats.hint')}</p>
        </div>
        <Segmented value={days} options={options} onChange={setDays} ariaLabel={t('stats.range')} />
      </div>
      {failed && <p className="muted">{t('stats.failed')}</p>}
      {!failed && data && data.total === 0 && (
        <div className="stats-empty">
          <b>{t('stats.emptyTitle')}</b>
          <p className="muted small">{t('stats.emptyBody')}</p>
        </div>
      )}
      {!failed && data && data.total > 0 && (
        <>
          <div className="stats-kpis">
            <div>
              <b>{data.total}</b>
              <span>{t('stats.total')}</span>
            </div>
            <div>
              <b>{pct(data.firstTryPass, data.firstTry)}</b>
              <span>{t('stats.firstPass')}</span>
            </div>
            <div>
              <b>{data.regen}</b>
              <span>{t('stats.regen')}</span>
            </div>
            <div>
              <b>{data.errors}</b>
              <span>{t('stats.errors')}</span>
            </div>
          </div>
          <div className="group stats-chart-box">
            <span className="muted small">{t('stats.perDay')}</span>
            <Chart days={data.byDay} />
            <div className="stats-axis">
              <span>{data.byDay[0]?.day.slice(5)}</span>
              <span>{data.byDay[data.byDay.length - 1]?.day.slice(5)}</span>
            </div>
          </div>
          <Table title={t('stats.byProject')} rows={data.byProject} />
          <Table title={t('stats.byStyle')} rows={data.byStyle} />
          {data.errorCodes.length > 0 && (
            <p className="muted small stats-codes">
              {t('stats.errorCodes')}: {data.errorCodes.map((c) => `${c.code} ×${c.count}`).join(' · ')}
            </p>
          )}
        </>
      )}
    </>
  )
}
