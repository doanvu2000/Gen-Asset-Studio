import { useEffect, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { SpinePlayer } from '@esotericsoftware/spine-player'
import type { SpineProjectView } from '@shared/spine'
import { Icon } from '@renderer/components/Icon'
import { SpineCompare } from '@renderer/components/spine/SpineCompare'
import { useViewer } from '@renderer/components/spine/SpinePreview'
import { RigEditor } from '@renderer/components/spine/RigEditor'
import { useSpine } from '@renderer/store/spine'

export function SpineRigStep({ v }: { v: SpineProjectView }): ReactElement {
  const { t } = useTranslation()
  const orig = useSpine((s) => s.orig)
  const next = useSpine((s) => s.next)
  const setRig = useSpine((s) => s.setRig)
  const flushRig = useSpine((s) => s.flushRig)
  const setStep = useSpine((s) => s.setStep)
  const viewer = useViewer()
  const [player, setPlayer] = useState<SpinePlayer | null>(null)
  const [slots, setSlots] = useState<string[]>([])

  useEffect(() => () => void flushRig(), [flushRig])

  if (!v.skeleton) return <div className="proj-state muted">{t('spineProject.lock.import')}</div>
  return (
    <div className="srig-wrap">
      <div className="srig-pv">
        <SpineCompare viewer={viewer} orig={orig} next={next} highlightSlots={slots} height={420} onNewPlayer={setPlayer} />
        <div className="tip">
          <Icon name="help" size={14} />
          <span>{t('spineProject.rig.tip')}</span>
        </div>
      </div>
      <aside className="srig-side">
        <RigEditor skeleton={v.skeleton} origJson={orig?.json ?? null} rig={v.rig} player={player} onChange={setRig} onSelectSlots={setSlots} />
        <div className="srig-acts">
          <button type="button" className="btn primary" onClick={() => void flushRig().then(() => setStep(6))}>
            {t('spineProject.rig.next')}
            <Icon name="right" size={14} />
          </button>
        </div>
      </aside>
    </div>
  )
}
