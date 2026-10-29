import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Icon, type IconName } from './Icon'

type StepKey = 'input' | 'style' | 'gen' | 'review' | 'export'

const STEP_ICON: Record<StepKey, IconName> = {
  input: 'upload',
  style: 'palette',
  gen: 'sparkles',
  review: 'eye',
  export: 'download'
}

export function StepIntro({ step, n, total }: { step: StepKey; n: number; total: number }): ReactElement {
  const { t } = useTranslation()
  return (
    <div className="step-intro">
      <span className="si-ic">
        <Icon name={STEP_ICON[step]} size={16} />
      </span>
      <div className="si-t">
        <b>
          {t('intro.stepOf', { n, total })} · {t(`project.steps.${step}`)}
        </b>
        <span>{t(`intro.${step}.what`)}</span>
      </div>
      <span className="si-next">
        <Icon name="right" size={12} />
        {t(`intro.${step}.next`)}
      </span>
    </div>
  )
}
