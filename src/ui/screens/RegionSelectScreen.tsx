import { motion } from 'framer-motion'
import { useGame } from '@/app/GameProvider'
import { REGIONS } from '@/game/data/regions'
import { PRACTICE_REGION } from '@/game/data/practiceRegion'

export function RegionSelectScreen() {
  const { send } = useGame()

  return (
    <div className="col" style={{ flex: 1, gap: 18 }}>
      <div className="col" style={{ gap: 4 }}>
        <div className="eyebrow">Step 1</div>
        <div className="h-title">選擇區域</div>
        <div className="h-sub">前往不同地帶遭遇野生寶可夢；新手可先去練習場練等</div>
      </div>

      {/* 練習場入口：低風險刷經驗，破解「要先贏才能變強」 */}
      <motion.button
        className="practice-cta"
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => send({ type: 'SELECT_REGION', regionId: PRACTICE_REGION.id })}
      >
        <span className="practice-cta__icon">{PRACTICE_REGION.icon}</span>
        <div className="practice-cta__body">
          <div className="practice-cta__title">練習對戰</div>
          <div className="practice-cta__sub">{PRACTICE_REGION.blurb}</div>
        </div>
        <span className="practice-cta__go">開始 →</span>
      </motion.button>

      <div className="region-grid scroll" style={{ paddingBottom: 8 }}>
        {REGIONS.map((r, i) => (
          <motion.button
            key={r.id}
            className="region-card"
            style={{ background: `linear-gradient(150deg, ${r.gradient[0]}, ${r.gradient[1]})` }}
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.06 * i, type: 'spring', stiffness: 140, damping: 16 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => send({ type: 'SELECT_REGION', regionId: r.id })}
          >
            <span className="region-card__glow" />
            <div className="region-card__icon">{r.icon}</div>
            <div>
              <div className="region-card__name">{r.name}</div>
              <div className="region-card__blurb">{r.blurb}</div>
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  )
}
