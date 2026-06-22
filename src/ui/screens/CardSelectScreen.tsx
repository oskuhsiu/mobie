import { motion } from 'framer-motion'
import { useMemo } from 'react'
import { useGame } from '@/app/GameProvider'
import { PLAYER_CARDS } from '@/game/data/playerCards'
import { buildBattlePokemon } from '@/game/stats'
import { typeEffectiveness } from '@/game/data/typeChart'
import { PokemonSprite } from '@/ui/components/PokemonSprite'
import { TypeBadges } from '@/ui/components/TypeBadge'
import type { Card } from '@/game/types'

export function CardSelectScreen() {
  const { context, send } = useGame()
  const wild = useMemo(
    () => (context.wild ? buildBattlePokemon(context.wild) : null),
    [context.wild],
  )

  const cards = useMemo(
    () => PLAYER_CARDS.map((c) => ({ card: c, mon: buildBattlePokemon(c) })),
    [],
  )

  const pick = (card: Card) => send({ type: 'SELECT_CARD', card })

  return (
    <div className="col" style={{ flex: 1, gap: 18 }}>
      <button className="btn btn--ghost" style={{ alignSelf: 'flex-start', padding: '10px 18px' }}
        onClick={() => send({ type: 'BACK' })}>
        ← 返回
      </button>

      <div className="col" style={{ gap: 4 }}>
        <div className="eyebrow">Step 2 · 掃描你的卡</div>
        <div className="h-title" style={{ fontSize: 32 }}>選擇出戰寶可夢</div>
        <div className="h-sub">挑選屬性相剋的寶可夢更有優勢</div>
      </div>

      <div className="hand scroll" style={{ paddingBottom: 8 }}>
        {cards.map(({ card, mon }, i) => {
          const eff = wild ? typeEffectiveness(mon.move.type, wild.types) : 1
          const advantage = eff >= 2 ? '剋制' : eff === 0 ? '無效' : eff < 1 ? '不利' : null
          const advColor = eff >= 2 ? 'var(--good)' : 'var(--bad)'
          return (
            <motion.button
              key={card.cardId}
              className="poke-card"
              initial={{ opacity: 0, rotateY: 35, y: 20 }}
              animate={{ opacity: 1, rotateY: 0, y: 0 }}
              transition={{ delay: 0.05 * i, type: 'spring', stiffness: 150, damping: 16 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => pick(card)}
            >
              <span className="poke-card__lv">Lv.{mon.level}</span>
              {advantage && (
                <span
                  style={{
                    position: 'absolute', top: 10, right: 12, fontSize: 11, fontWeight: 900,
                    color: advColor, border: `1px solid ${advColor}`, borderRadius: 999,
                    padding: '2px 8px',
                  }}
                >
                  {advantage}
                </span>
              )}
              <div className="poke-card__art">
                <PokemonSprite src={mon.artworkUrl} alt={mon.nameZh} shiny={mon.shiny} />
              </div>
              <div className="poke-card__name">{mon.nameZh}</div>
              <div className="poke-card__types"><TypeBadges types={mon.types} /></div>
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}
