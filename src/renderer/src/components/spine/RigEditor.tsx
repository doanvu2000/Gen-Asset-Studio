import { useCallback, useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { SpinePlayer } from '@esotericsoftware/spine-player'
import { attachmentKey, type SpineAttachmentEdit, type SpineBoneEdit, type SpineRig, type SpineSkeletonInfo } from '@shared/spine'
import { Icon } from '@renderer/components/Icon'

type Field = 'x' | 'y' | 'rotation' | 'scaleX' | 'scaleY'
const FIELDS: Field[] = ['x', 'y', 'rotation', 'scaleX', 'scaleY']
const DEFAULTS: Record<Field, number> = { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 }

type Values = Record<Field, number>

export interface OrigRig {
  bones: Record<string, Values>
  attachments: Record<string, Values & { type: string }>
}

function num(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : d
}

function values(o: Record<string, unknown>): Values {
  return { x: num(o.x, 0), y: num(o.y, 0), rotation: num(o.rotation, 0), scaleX: num(o.scaleX, 1), scaleY: num(o.scaleY, 1) }
}

export function parseOrigRig(json: string | null): OrigRig {
  const out: OrigRig = { bones: {}, attachments: {} }
  if (!json) return out
  try {
    const raw = JSON.parse(json) as Record<string, unknown>
    for (const b of Array.isArray(raw.bones) ? (raw.bones as Array<Record<string, unknown>>) : []) {
      if (typeof b.name === 'string') out.bones[b.name] = values(b)
    }
    const skins: Array<[string, Record<string, unknown>]> = Array.isArray(raw.skins)
      ? (raw.skins as Array<Record<string, unknown>>).map((s) => [String(s.name ?? 'default'), (s.attachments ?? {}) as Record<string, unknown>])
      : Object.entries((raw.skins ?? {}) as Record<string, Record<string, unknown>>)
    for (const [skin, slots] of skins) {
      for (const [slot, atts] of Object.entries(slots ?? {})) {
        for (const [name, a] of Object.entries((atts ?? {}) as Record<string, Record<string, unknown>>)) {
          out.attachments[attachmentKey(skin, slot, name)] = { ...values(a ?? {}), type: typeof a?.type === 'string' ? a.type : 'region' }
        }
      }
    }
  } catch {
    return out
  }
  return out
}

export function applyRig(player: SpinePlayer | null, orig: OrigRig, rig: SpineRig): void {
  const data = player?.skeleton?.data
  if (!data) return
  for (const bd of data.bones) {
    const o = orig.bones[bd.name]
    if (!o) continue
    const e = rig.bones[bd.name] ?? {}
    bd.x = e.x ?? o.x
    bd.y = e.y ?? o.y
    bd.rotation = e.rotation ?? o.rotation
    bd.scaleX = e.scaleX ?? o.scaleX
    bd.scaleY = e.scaleY ?? o.scaleY
  }
  for (const [key, o] of Object.entries(orig.attachments)) {
    if (o.type !== 'region') continue
    const [skinName, slotName, ...rest] = key.split('/')
    const name = rest.join('/')
    const skin = data.findSkin(skinName)
    const slot = data.findSlot(slotName)
    if (!skin || !slot) continue
    const att = skin.getAttachment(slot.index, name) as unknown as (Values & { updateRegion?: () => void }) | null
    if (!att || typeof att.updateRegion !== 'function') continue
    const e = rig.attachments[key] ?? {}
    att.x = e.x ?? o.x
    att.y = e.y ?? o.y
    att.rotation = e.rotation ?? o.rotation
    att.scaleX = e.scaleX ?? o.scaleX
    att.scaleY = e.scaleY ?? o.scaleY
    try {
      att.updateRegion()
    } catch {
      continue
    }
  }
}

export function rigCount(rig: SpineRig): number {
  return Object.keys(rig.bones).length + Object.keys(rig.attachments).length
}

function clean<T extends SpineBoneEdit | SpineAttachmentEdit>(edit: T, base: Values): T | null {
  const out: Record<string, number> = {}
  for (const f of FIELDS) {
    const v = edit[f]
    if (typeof v === 'number' && Math.abs(v - base[f]) > 1e-6) out[f] = Math.round(v * 1000) / 1000
  }
  return Object.keys(out).length ? (out as unknown as T) : null
}

function FieldRow({ f, base, value, onSet }: { f: Field; base: number; value: number; onSet: (v: number) => void }): ReactElement {
  const { t } = useTranslation()
  const [text, setText] = useState(String(value))
  useEffect(() => setText(String(Math.round(value * 1000) / 1000)), [value])
  const step = f === 'scaleX' || f === 'scaleY' ? 0.05 : 1
  const big = f === 'scaleX' || f === 'scaleY' ? 0.2 : 5
  const delta = value - base
  const commit = (): void => {
    const n = Number(text)
    if (Number.isFinite(n)) onSet(n)
    else setText(String(value))
  }
  return (
    <div className={Math.abs(delta) > 1e-6 ? 'rig-f changed' : 'rig-f'}>
      <span className="rig-l">{t(`spineProject.rig.f.${f}`)}</span>
      <button type="button" className="rig-n" onClick={() => onSet(value - big)}>
        −{big}
      </button>
      <button type="button" className="rig-n" onClick={() => onSet(value - step)}>
        −{step}
      </button>
      <input className="inp sm mono" value={text} onChange={(e) => setText(e.target.value)} onBlur={commit} onKeyDown={(e) => e.key === 'Enter' && commit()} />
      <button type="button" className="rig-n" onClick={() => onSet(value + step)}>
        +{step}
      </button>
      <button type="button" className="rig-n" onClick={() => onSet(value + big)}>
        +{big}
      </button>
      <small className="rig-base mono" title={t('spineProject.rig.base')}>
        {Math.round(base * 1000) / 1000}
        {Math.abs(delta) > 1e-6 && <em>{` ${delta > 0 ? '+' : ''}${Math.round(delta * 1000) / 1000}`}</em>}
      </small>
    </div>
  )
}

interface Props {
  skeleton: SpineSkeletonInfo
  origJson: string | null
  rig: SpineRig
  player: SpinePlayer | null
  onChange: (rig: SpineRig) => void
  onSelectSlots?: (slots: string[]) => void
}

export function RigEditor({ skeleton, origJson, rig, player, onChange, onSelectSlots }: Props): ReactElement {
  const { t } = useTranslation()
  const orig = useMemo(() => parseOrigRig(origJson), [origJson])
  const [bone, setBone] = useState<string>(skeleton.bones[0]?.name ?? '')
  const past = useRef<SpineRig[]>([])
  const future = useRef<SpineRig[]>([])
  const [, force] = useState(0)

  useEffect(() => {
    applyRig(player, orig, rig)
  }, [player, orig, rig])

  const commit = useCallback(
    (next: SpineRig) => {
      past.current.push(rig)
      if (past.current.length > 100) past.current.shift()
      future.current = []
      onChange(next)
      force((n) => n + 1)
    },
    [rig, onChange]
  )

  const undo = useCallback(() => {
    const prev = past.current.pop()
    if (!prev) return
    future.current.push(rig)
    onChange(prev)
    force((n) => n + 1)
  }, [rig, onChange])

  const redo = useCallback(() => {
    const next = future.current.pop()
    if (!next) return
    past.current.push(rig)
    onChange(next)
    force((n) => n + 1)
  }, [rig, onChange])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey)) return
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA') return
      if (e.key === 'z' && !e.shiftKey) {
        e.preventDefault()
        undo()
      } else if (e.key === 'y' || (e.key === 'z' && e.shiftKey) || e.key === 'Z') {
        e.preventDefault()
        redo()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  const children = useMemo(() => {
    const m = new Map<string | null, string[]>()
    for (const b of skeleton.bones) {
      const list = m.get(b.parent) ?? []
      list.push(b.name)
      m.set(b.parent, list)
    }
    return m
  }, [skeleton.bones])

  const slotsOf = useMemo(() => skeleton.slots.filter((s) => s.bone === bone).map((s) => s.name), [skeleton.slots, bone])
  useEffect(() => onSelectSlots?.(slotsOf), [slotsOf, onSelectSlots])
  const atts = skeleton.attachments.filter((a) => slotsOf.includes(a.slot))
  const baseBone: Values = orig.bones[bone] ?? DEFAULTS

  const setBoneField = (f: Field, v: number): void => {
    const cur = { ...(rig.bones[bone] ?? {}), [f]: v }
    const c = clean(cur, baseBone)
    const bones = { ...rig.bones }
    if (c) bones[bone] = c
    else delete bones[bone]
    commit({ ...rig, bones })
  }

  const setAttField = (key: string, f: Field, v: number): void => {
    const base = orig.attachments[key] ?? { ...DEFAULTS, type: 'region' }
    const cur = { ...(rig.attachments[key] ?? {}), [f]: v }
    const c = clean(cur, base)
    const attachments = { ...rig.attachments }
    if (c) attachments[key] = c
    else delete attachments[key]
    commit({ ...rig, attachments })
  }

  const tree = (parent: string | null, depth: number): ReactElement[] =>
    (children.get(parent) ?? []).flatMap((name) => [
      <button
        key={name}
        type="button"
        className={['rig-bone', name === bone && 'on', (rig.bones[name] || skeleton.attachments.some((a) => rig.attachments[attachmentKey(a.skin, a.slot, a.name)] && skeleton.slots.find((s) => s.name === a.slot)?.bone === name)) && 'edited'].filter(Boolean).join(' ')}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => setBone(name)}
      >
        <Icon name="link" size={11} />
        {name}
      </button>,
      ...tree(name, depth + 1)
    ])

  const boneVals: Values = { ...baseBone, ...(rig.bones[bone] ?? {}) } as Values

  return (
    <div className="rig">
      <div className="rig-tree">
        <div className="rig-head">
          <b>{t('spineProject.rig.bones')}</b>
          <div className="grow" />
          <button type="button" className="icon-btn" disabled={!past.current.length} onClick={undo} title="Ctrl+Z" aria-label={t('spineProject.rig.undo')}>
            <Icon name="left" size={13} />
          </button>
          <button type="button" className="icon-btn" disabled={!future.current.length} onClick={redo} title="Ctrl+Y" aria-label={t('spineProject.rig.redo')}>
            <Icon name="right" size={13} />
          </button>
        </div>
        <div className="rig-list">{tree(null, 0)}</div>
        <div className="rig-foot">
          <small className="muted">{t('spineProject.rig.count', { count: rigCount(rig) })}</small>
          <button type="button" className="btn ghost sm danger" disabled={!rigCount(rig)} onClick={() => commit({ bones: {}, attachments: {} })}>
            {t('spineProject.rig.resetAll')}
          </button>
        </div>
      </div>
      <div className="rig-form">
        <section>
          <div className="rig-head">
            <b>
              <Icon name="link" size={13} /> {bone}
            </b>
            <div className="grow" />
            <button
              type="button"
              className="btn ghost sm"
              disabled={!rig.bones[bone]}
              onClick={() => {
                const bones = { ...rig.bones }
                delete bones[bone]
                commit({ ...rig, bones })
              }}
            >
              {t('spineProject.rig.reset')}
            </button>
          </div>
          {FIELDS.map((f) => (
            <FieldRow key={f} f={f} base={baseBone[f]} value={boneVals[f]} onSet={(v) => setBoneField(f, v)} />
          ))}
        </section>
        {atts.map((a) => {
          const key = attachmentKey(a.skin, a.slot, a.name)
          const base = orig.attachments[key] ?? { ...DEFAULTS, type: a.kind }
          const vals = { ...base, ...(rig.attachments[key] ?? {}) } as Values
          const editable = a.kind === 'region'
          return (
            <section key={key}>
              <div className="rig-head">
                <b>
                  <Icon name="image" size={13} /> {a.name}
                </b>
                <small className="muted">
                  {a.slot} · {a.skin}
                </small>
                <div className="grow" />
                {editable && (
                  <button
                    type="button"
                    className="btn ghost sm"
                    disabled={!rig.attachments[key]}
                    onClick={() => {
                      const attachments = { ...rig.attachments }
                      delete attachments[key]
                      commit({ ...rig, attachments })
                    }}
                  >
                    {t('spineProject.rig.reset')}
                  </button>
                )}
              </div>
              {editable ? (
                FIELDS.map((f) => <FieldRow key={f} f={f} base={base[f]} value={vals[f]} onSet={(v) => setAttField(key, f, v)} />)
              ) : (
                <p className="muted rig-note">{t('spineProject.rig.meshNote')}</p>
              )}
            </section>
          )
        })}
        {!atts.length && <p className="muted rig-note">{t('spineProject.rig.noAtt')}</p>}
      </div>
    </div>
  )
}
