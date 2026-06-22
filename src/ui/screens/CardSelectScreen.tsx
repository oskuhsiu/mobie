import { motion, AnimatePresence } from 'framer-motion'
import { useMemo, useState } from 'react'
import { useGame } from '@/app/GameProvider'
import { TEAM_SIZE } from '@/game/machine/gameMachine'
import { PLAYER_CARDS } from '@/game/data/playerCards'
import { buildBattlePokemon } from '@/game/stats'
import { typeEffectiveness } from '@/game/data/typeChart'
import { PokemonSprite } from '@/ui/components/PokemonSprite'
import { TypeBadges } from '@/ui/components/TypeBadge'

export function CardSelectScreen() {
  const { context, send } = useGame()
  const foeLead = useMemo(
    () => (context.foeTeam[0] ? buildBattlePokemon(context.foeTeam[0]) : null),
    [context.foeTeam],
  )

  const cards = useMemo(
    () => PLAYER_CARDS.map((c) => ({ card: c, mon: buildBattlePokemon(c) })),
    [],
  )

  // 已選卡片 id（依點選順序，最多 TEAM_SIZE 隻）
  const [picked, setPicked] = useState<string[]>([])

  const toggle = (cardId: string) => {
    setPicked((prev) => {
      if (prev.includes(cardId)) return prev.filter((id) => id !== cardId)
      if (prev.length >= TEAM_SIZE) return prev
      return [...prev, cardId]
    })
  }

  const engage = () => {
    if (picked.length !== TEAM_SIZE) return
    const chosen = picked
      .map((id) => PLAYER_CARDS.find((c) => c.cardId === id))
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
    send({ type: 'SELECT_TEAM', cards: chosen })
  }

  const ready = picked.length === TEAM_SIZE

  return (
    <div className="col" style={{ flex: 1, gap: 16 }}>
      <button className="btn btn--ghost" style={{ alignSelf: 'flex-start', padding: '10px 18px' }}
        onClick={() => send({ type: 'BACK' })}>
        ← 返回
      </button>

      <div className="col" style={{ gap: 4 }}>
        <div className="eyebrow">Step 2 · 組你的隊伍</div>
        <div className="h-title" style={{ fontSize: 30 }}>選擇出戰寶可夢</div>
        <div className="h-sub">挑 {TEAM_SIZE} 隻組隊，屬性相剋更有優勢</div>
      </div>

      <div className="hand scroll" style={{ paddingBottom: 8 }}>
        {cards.map(({ card, mon }, i) => {
          const eff = foeLead ? typeEffectiveness(mon.move.type, foeLead.types) : 1
          const advantage = eff >= 2 ? '剋制' : eff === 0 ? '無效' : eff < 1 ? '不利' : null
          const advColor = eff >= 2 ? 'var(--good)' : 'var(--bad)'
          const order = picked.indexOf(card.cardId)
          const isPicked = order >= 0
          return (
            <motion.button
              key={card.cardId}
              className={`poke-card ${isPicked ? 'poke-card--picked' : ''}`}
              initial={{ opacity: 0, rotateY: 35, y: 20 }}
              animate={{ opacity: 1, rotateY: 0, y: 0 }}
              transition={{ delay: 0.05 * i, type: 'spring', stiffness: 150, damping: 16 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => toggle(card.cardId)}
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
              <AnimatePresence>
                {isPicked && (
                  <motion.span
                    className="poke-card__pick"
                    initial={{ scale: 0, x: '-50%' }} animate={{ scale: 1, x: '-50%' }} exit={{ scale: 0, x: '-50%' }}
                  >
                    {order + 1}
                  </motion.span>
                )}
              </AnimatePresence>
              <div className="poke-card__art">
                <PokemonSprite src={mon.artworkUrl} alt={mon.nameZh} shiny={mon.shiny} />
              </div>
              <div className="poke-card__name">{mon.nameZh}</div>
              <div className="poke-card__types"><TypeBadges types={mon.types} /></div>
            </motion.button>
          )
        })}
      </div>

      <motion.button
        className="btn"
        style={{ alignSelf: 'center', fontSize: 19, padding: '16px 48px' }}
        animate={{ opacity: ready ? 1 : 0.5 }}
        whileTap={ready ? { scale: 0.96 } : undefined}
        disabled={!ready}
        onClick={engage}
      >
        ⚔ 出戰　<span style={{ fontSize: 14, opacity: 0.85 }}>{picked.length}/{TEAM_SIZE}</span>
      </motion.button>
    </div>
  )
}
