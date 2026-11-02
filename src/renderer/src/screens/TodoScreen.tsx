import { useMemo, type ReactElement } from 'react'
import { motion } from 'motion/react'
import { useTranslation } from 'react-i18next'
import type { TodoArea, TodoItem } from '@shared/workspace'
import { Icon, type IconName } from '@renderer/components/Icon'
import { KindBadge } from '@renderer/components/ProjectKinds'
import { Segmented } from '@renderer/components/Segmented'
import { EASE } from '@renderer/lib/motion'
import { relTime } from '@renderer/lib/format'
import { useApp } from '@renderer/store/app'
import { useTodo, type TodoFilter } from '@renderer/store/todo'
import { useWs } from '@renderer/store/workspace'

const AREAS: TodoArea[] = ['review', 'qa', 'export', 'queue']
const ICON: Record<TodoArea, [IconName, string]> = {
  review: ['eye', 'c-orange'],
  qa: ['alert', 'c-red'],
  export: ['upload', 'c-blue'],
  queue: ['queue', 'c-red']
}

function Row({ item }: { item: TodoItem }): ReactElement {
  const { t } = useTranslation()
  const lang = useApp((s) => s.settings.lang)
  const open = useTodo((s) => s.open)
  const [icon, tone] = ICON[item.area]
  return (
    <button type="button" className="todo-row" onClick={() => void open(item)}>
      <span className={`todo-ic ${tone}`}>
        <Icon name={icon} size={15} />
      </span>
      <span className="todo-txt">
        <b>{t(`todo.row.${item.area}`, { count: item.count })}</b>
        <small title={item.label}>{item.label}</small>
      </span>
      <span className="todo-n">{item.count}</span>
      <span className="muted todo-when">{relTime(item.updatedAt, lang)}</span>
      <span className="btn sm todo-go">
        {t('todo.open')}
        <Icon name="right" size={12} />
      </span>
    </button>
  )
}

export function TodoScreen(): ReactElement {
  const { t } = useTranslation()
  const items = useTodo((s) => s.items)
  const loaded = useTodo((s) => s.loaded)
  const filter = useTodo((s) => s.filter)
  const setFilter = useTodo((s) => s.setFilter)
  const ready = useWs((s) => !!s.snap?.exists)

  const shown = useMemo(() => (filter === 'all' ? items : items.filter((i) => i.area === filter)), [items, filter])
  const groups = useMemo(() => {
    const by = new Map<string, TodoItem[]>()
    for (const i of shown) by.set(i.projectRel, [...(by.get(i.projectRel) ?? []), i])
    return [...by.values()].map((list) => list.sort((a, b) => AREAS.indexOf(a.area) - AREAS.indexOf(b.area)))
  }, [shown])
  const present = useMemo(() => new Set(items.map((i) => i.area)), [items])

  return (
    <>
      <div className="mhead">
        <div className="mh-title">
          <h1>{t('todo.title')}</h1>
          <p className="sub">{t('todo.subtitle', { count: items.length })}</p>
        </div>
        <div className="mh-actions">
          <Segmented<TodoFilter>
            value={filter}
            ariaLabel={t('todo.filterLabel')}
            onChange={setFilter}
            options={[{ value: 'all', label: t('todo.filter.all') }, ...AREAS.filter((a) => present.has(a) || a === filter).map((a) => ({ value: a, label: t(`todo.filter.${a}`) }))]}
          />
        </div>
      </div>
      <div className="todo-list">
        {!ready ? (
          <div className="empty">
            <Icon name="folder" size={34} />
            <h3>{t('todo.noWorkspace')}</h3>
          </div>
        ) : !loaded ? null : groups.length ? (
          groups.map((list, gi) => (
            <motion.section
              key={list[0].projectRel}
              className="todo-group"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.28, ease: EASE, delay: Math.min(gi, 10) * 0.03 }}
            >
              <header>
                <b>{list[0].projectName}</b>
                <KindBadge kind={list[0].kind} />
                {list[0].projectRel.includes('/') && <span className="muted">{list[0].projectRel.split('/').slice(0, -1).join(' / ')}</span>}
              </header>
              {list.map((i) => (
                <Row key={`${i.area}|${i.target.variantId ?? ''}|${i.target.assetId ?? i.target.stripKey ?? i.target.region ?? ''}`} item={i} />
              ))}
            </motion.section>
          ))
        ) : (
          <div className="empty">
            <Icon name="check" size={34} />
            <h3>{t('todo.empty')}</h3>
            <p>{t('todo.emptyDesc')}</p>
          </div>
        )}
      </div>
    </>
  )
}
