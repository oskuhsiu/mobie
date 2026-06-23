import { motion } from 'framer-motion'
import { useGame } from '@/app/GameProvider'
import type { Region } from '@/game/types'
import { REGIONS } from '@/game/data/regions'
import { PRACTICE_REGION } from '@/game/data/practiceRegion'
import { terrainDefsOf } from '@/game/data/terrains'

/** 區域地形提示文案（M8）：隨機地形區標「隨機」，否則列出固定/混合地形 icon+名。 */
function terrainHint(r: Region): string | null {
  if (r.randomTerrain) return '🌀 隨機地形'
  const defs = terrainDefsOf(r.terrains ?? [])
  if (defs.length === 0) return null
  return defs.map((d) => `${d.icon} ${d.name}`).join(' + ')
}

export function RegionSelectScreen() {
  const { send } = useGame()

  return (
    <div className="col" style={{ flex: 1, gap: 18, minHeight: 0 }}>
      <div className="col" style={{ gap: 4 }}>
        <div className="eyebrow">Step 1</div>
        <div className="h-title">選擇區域</div>
        <div className="h-sub">前往不同地帶遭遇野生寶可夢；新手可先去競技場練等</div>
      </div>

      {/* 競技場入口：中性地形、純得經驗、不可捕獲，低風險刷經驗 */}
      <motion.button
        className="practice-cta"
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => send({ type: 'SELECT_REGION', regionId: PRACTICE_REGION.id })}
      >
        <span className="practice-cta__icon">{PRACTICE_REGION.icon}</span>
        <div className="practice-cta__body">
          <div className="practice-cta__title">{PRACTICE_REGION.name}</div>
          <div className="practice-cta__sub">{PRACTICE_REGION.blurb}</div>
        </div>
        <span className="practice-cta__go">開始 →</span>
      </motion.button>

      <div className="region-grid scroll-y" style={{ paddingBottom: 8 }}>
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
              {terrainHint(r) && <div className="region-card__terrain">{terrainHint(r)}</div>}
            </div>
          </motion.button>
        ))}
      </div>
    </div>
  )
}
