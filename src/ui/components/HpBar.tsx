import { motion } from 'framer-motion'

interface HpBarProps {
  name: string
  level: number
  currentHp: number
  maxHp: number
  /** 是否顯示精確數字（自家顯示，野生不顯示） */
  showNumbers?: boolean
}

export function HpBar({ name, level, currentHp, maxHp, showNumbers }: HpBarProps) {
  const ratio = Math.max(0, currentHp / maxHp)
  const pct = ratio * 100
  const tone = ratio > 0.5 ? '' : ratio > 0.2 ? 'hpbar__fill--mid' : 'hpbar__fill--low'

  return (
    <div className="hpbar panel" style={{ padding: '12px 16px' }}>
      <div className="hpbar__top">
        <span className="hpbar__name">{name}</span>
        <span className="hpbar__lv">Lv.{level}</span>
      </div>
      <div className="hpbar__track">
        <motion.div
          className={`hpbar__fill ${tone}`}
          initial={false}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.55, ease: 'easeOut' }}
        />
      </div>
      {showNumbers && (
        <div className="hpbar__num">{Math.ceil(currentHp)} / {maxHp}</div>
      )}
    </div>
  )
}
