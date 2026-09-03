import { useRef } from 'react'
import { motion } from 'framer-motion'
import type { BattleMobie } from '@/game/types'
import { useDialogFocusTrap } from '@/ui/accessibility/useDialogFocusTrap'
import type { SwitchAvailability } from './BattleActionModel'

const hpToneClass = (fraction: number) => (
  fraction > 0.5 ? '' : fraction > 0.2 ? 'hpbar__fill--mid' : 'hpbar__fill--low'
)

export function SwitchAction({
  availability,
  onOpen,
}: {
  availability: SwitchAvailability
  onOpen: (invoker: HTMLButtonElement) => void
}) {
  const disabled = availability.disabledReason !== null
  return (
    <div className="switch-action">
      <motion.button
        type="button"
        className="btn btn--ghost"
        data-battle-action="switch"
        whileTap={disabled ? undefined : { scale: 0.96 }}
        disabled={disabled}
        aria-label={disabled ? `換人，無法使用：${availability.disabledReason}` : '換人'}
        aria-describedby="switch-action-cost switch-action-reason"
        onClick={(event) => onOpen(event.currentTarget)}
      >
        🔄 換人
      </motion.button>
      <div id="switch-action-cost" className="switch-action__cost">{availability.consequence}</div>
      <div id="switch-action-reason" className="switch-action__reason" role={disabled ? 'status' : undefined}>
        {availability.disabledReason ?? '可選擇一名未倒下的替補'}
      </div>
    </div>
  )
}

export function SwitchSheet({
  members,
  legalIndices,
  onPick,
  onCancel,
}: {
  members: readonly BattleMobie[]
  legalIndices: readonly number[]
  onPick: (index: number) => void
  onCancel: () => void
}) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const firstRef = useRef<HTMLButtonElement>(null)

  useDialogFocusTrap({ dialogRef, initialFocusRef: firstRef, onEscape: onCancel })

  return (
    <motion.div
      ref={dialogRef}
      className="switch-panel"
      role="dialog"
      aria-modal="true"
      aria-label="選擇換上的夥伴"
      tabIndex={-1}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <div className="switch-panel__title">換上哪一隻？</div>
      <div className="switch-panel__list">
        {legalIndices.map((index, legalPosition) => {
          const member = members[index]
          if (!member) return null
          const fraction = Math.max(0, member.currentHp) / member.maxHp
          return (
            <button
              ref={legalPosition === 0 ? firstRef : undefined}
              key={index}
              type="button"
              className="switch-card"
              aria-label={`換上${member.nameZh}，等級 ${member.level}，HP ${Math.ceil(member.currentHp)} / ${member.maxHp}`}
              onClick={() => onPick(index)}
            >
              <div className="switch-card__art">
                <img src={member.artworkUrl} alt="" />
              </div>
              <div className="switch-card__name">{member.nameZh} <span className="hpbar__lv">Lv.{member.level}</span></div>
              <div className="hpbar__track" role="meter" aria-label={`${member.nameZh} HP`} aria-valuemin={0} aria-valuemax={member.maxHp} aria-valuenow={Math.ceil(member.currentHp)}>
                <div className={`hpbar__fill ${hpToneClass(fraction)}`} style={{ width: `${fraction * 100}%` }} />
              </div>
            </button>
          )
        })}
      </div>
      <button type="button" className="btn btn--ghost switch-panel__cancel" onClick={onCancel}>取消</button>
    </motion.div>
  )
}
