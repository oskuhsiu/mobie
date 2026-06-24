import { motion } from 'framer-motion'
import { useEffect, useMemo } from 'react'
import { useGame } from '@/app/GameProvider'
import { buildBattleMobie } from '@/game/stats'
import { useMeta } from '@/store/metaStore'
import { MobieSprite } from '@/ui/components/MobieSprite'
import { TypeBadges } from '@/ui/components/TypeBadge'
import { IndividualInfo } from '@/ui/components/IndividualInfo'

export function EncounterScreen() {
  const { context, send } = useGame()
  const foes = useMemo(
    () => context.foeTeam.map(buildBattleMobie),
    [context.foeTeam],
  )
  // 圖鑑：遭遇即把對手隊伍全部記為「看過」（seen；尚未捕獲）
  useEffect(() => {
    if (context.foeTeam.length > 0) useMeta.getState().recordSeen(context.foeTeam.map((c) => c.speciesId))
  }, [context.foeTeam])
  const wild = foes[0] ?? null
  if (!wild) return null

  return (
    <div className="col" style={{ flex: 1 }}>
      <button className="btn btn--ghost" style={{ alignSelf: 'flex-start', padding: '10px 18px' }}
        onClick={() => send({ type: 'BACK' })}>
        ← 返回
      </button>

      <div className="center" style={{ flex: 1, gap: 18 }}>
        <motion.div
          initial={{ opacity: 0, scale: 0.6, y: -40 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          transition={{ type: 'spring', stiffness: 120, damping: 12 }}
          style={{ width: 'min(60vw, 300px)', height: 'min(60vw, 300px)', position: 'relative' }}
        >
          <div className="platform" />
          <MobieSprite src={wild.artworkUrl} alt={wild.nameZh} shiny={wild.shiny} />
        </motion.div>

        <motion.div
          className="col center" style={{ gap: 8 }}
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
        >
          <div className="eyebrow">對手帶著 {foes.length} 隻寶可夢出現了！</div>
          <div className="h-title" style={{ fontSize: 36 }}>
            {wild.nameZh} <span className="hpbar__lv">Lv.{wild.level}</span>
          </div>
          <TypeBadges types={wild.types} />
          <IndividualInfo mon={wild} detailed />
          {/* 對手隊伍縮圖（最後一隻為 boss） */}
          <div className="row" style={{ gap: 10, marginTop: 6 }}>
            {foes.map((f, i) => (
              <div
                key={i}
                style={{
                  width: 46, height: 46, borderRadius: 12, padding: 3,
                  border: `1px solid ${i === foes.length - 1 ? 'var(--accent)' : 'var(--stroke)'}`,
                  background: 'rgba(0,0,0,0.3)',
                }}
                title={i === foes.length - 1 ? `${f.nameZh}（boss）` : f.nameZh}
              >
                <img src={f.artworkUrl} alt={f.nameZh} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              </div>
            ))}
          </div>
        </motion.div>
      </div>

      <motion.button
        className="btn" style={{ alignSelf: 'center', fontSize: 19, padding: '16px 44px' }}
        initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.5 }}
        whileTap={{ scale: 0.96 }}
        onClick={() => send({ type: 'ENGAGE' })}
      >
        ⚔ 出戰
      </motion.button>
    </div>
  )
}
