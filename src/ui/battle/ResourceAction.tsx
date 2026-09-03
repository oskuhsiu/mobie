import { useEffect, useRef } from 'react'
import { resourceActionState } from './BattleActionModel'

const RESOURCE_COPY = {
  star: { icon: '★', label: '星擊' },
  chain: { icon: '🔗', label: '連鎖' },
} as const

export function ResourceAction({
  kind,
  current,
  max,
  activating,
  actionable = true,
  onActivate,
}: {
  kind: keyof typeof RESOURCE_COPY
  current: number
  max: number
  activating: boolean
  actionable?: boolean
  onActivate: () => void
}) {
  const copy = RESOURCE_COPY[kind]
  const state = resourceActionState({ current, max, activating })
  const submittedRef = useRef(false)
  const safeMax = Math.max(1, max)
  const safeCurrent = Math.max(0, Math.min(current, safeMax))
  const percent = Math.floor((safeCurrent / safeMax) * 100)

  useEffect(() => {
    if (state === 'charging') submittedRef.current = false
  }, [state])

  const activate = () => {
    if (state !== 'ready' || !actionable || submittedRef.current) return
    submittedRef.current = true
    onActivate()
  }

  return (
    <div
      className={`battle-resource battle-resource--${kind}`}
      data-resource-kind={kind}
      data-resource-state={state}
      aria-busy={state === 'activating'}
    >
      <div className="battle-resource__meter-row">
        <span className="battle-resource__label"><span aria-hidden="true">{copy.icon}</span> {copy.label}</span>
        <div
          className="battle-resource__track"
          role="meter"
          aria-label={`${copy.label}能量`}
          aria-valuemin={0}
          aria-valuemax={safeMax}
          aria-valuenow={safeCurrent}
          aria-valuetext={`${safeCurrent} / ${safeMax}，${percent}%`}
        >
          <span className="battle-resource__fill" style={{ width: `${percent}%` }} />
        </div>
        <span className="battle-resource__value">{percent}%</span>
      </div>
      {state === 'ready' && actionable && (
        <button
          type="button"
          className={`battle-resource__ready battle-resource__ready--${kind}`}
          data-battle-action={kind}
          aria-label={`${copy.label}發動`}
          onClick={activate}
        >
          {copy.icon} {copy.label}發動
        </button>
      )}
      {state === 'activating' && (
        <button
          type="button"
          className={`battle-resource__ready battle-resource__ready--${kind}`}
          aria-label={`${copy.label}發動中`}
          disabled
        >
          {copy.icon} {copy.label}發動中
        </button>
      )}
    </div>
  )
}
