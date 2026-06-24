import { motion } from 'framer-motion'
import { useGame } from '@/app/GameProvider'
import type { Region } from '@/game/types'
import { REGIONS } from '@/game/data/regions'
import { PRACTICE_REGION } from '@/game/data/practiceRegion'
import { terrainDefsOf } from '@/game/data/terrains'
import { ToolsMenu } from '@/ui/components/ToolsMenu'

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
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
        <div className="col" style={{ gap: 4 }}>
          <div className="eyebrow">Step 1</div>
          <div className="h-title">選擇區域</div>
          <div className="h-sub">前往不同地帶遭遇野生Mobie；新手可先去競技場練等</div>
        </div>
        <button className="btn btn--ghost btn--sm" onClick={() => send({ type: 'BACK' })}>🏠 首頁</button>
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

      {/* M11 連勝塔入口：連續 escalating 戰鬥、Ascension 難度、依深度給 SP */}
      <motion.button
        className="practice-cta tower-cta"
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}
        whileTap={{ scale: 0.98 }}
        onClick={() => send({ type: 'OPEN_TOWER' })}
      >
        <span className="practice-cta__icon">🗼</span>
        <div className="practice-cta__body">
          <div className="practice-cta__title">連勝塔 · 遠征</div>
          <div className="practice-cta__sub">連續對戰、樓層越高敵越強；通關得 SP 與難度解鎖。輸一場即結算。</div>
        </div>
        <span className="practice-cta__go">挑戰 →</span>
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

      {/* 遊戲中樞的共用工具列：開始遊戲後仍可開隊伍/招式/圖鑑/設定等（修「首頁功能開始後就找不到」） */}
      <div className="region-tools">
        <ToolsMenu />
      </div>
    </div>
  )
}
