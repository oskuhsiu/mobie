import { motion } from 'framer-motion'
import { useMemo } from 'react'
import { useGame } from '@/app/GameProvider'
import { buildBattlePokemon } from '@/game/stats'
import { PokemonSprite } from '@/ui/components/PokemonSprite'
import { TypeBadges } from '@/ui/components/TypeBadge'

export function EncounterScreen() {
  const { context, send } = useGame()
  const wild = useMemo(
    () => (context.wild ? buildBattlePokemon(context.wild) : null),
    [context.wild],
  )
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
          <PokemonSprite src={wild.artworkUrl} alt={wild.nameZh} shiny={wild.shiny} />
        </motion.div>

        <motion.div
          className="col center" style={{ gap: 8 }}
          initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}
        >
          <div className="eyebrow">野生的寶可夢出現了！</div>
          <div className="h-title" style={{ fontSize: 36 }}>
            {wild.nameZh} <span className="hpbar__lv">Lv.{wild.level}</span>
          </div>
          <TypeBadges types={wild.types} />
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
