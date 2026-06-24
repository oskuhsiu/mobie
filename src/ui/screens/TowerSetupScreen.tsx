import { motion, AnimatePresence } from 'framer-motion'
import { useMemo, useState } from 'react'
import { useGame } from '@/app/GameProvider'
import { TEAM_SIZE } from '@/game/machine/gameMachine'
import { useRoster } from '@/store/rosterStore'
import { useRun } from '@/store/runStore'
import { ownedToCard } from '@/game/growth'
import { buildBattleMobie } from '@/game/stats'
import { ASCENSIONS } from '@/game/tower'
import { audio } from '@/audio/audioEngine'
import { MobieSprite } from '@/ui/components/MobieSprite'
import { TypeBadges } from '@/ui/components/TypeBadge'

/**
 * M11 連勝塔出戰準備：選 3 隻 run 隊伍 + 難度階（Ascension，受 runStore 解鎖上限限制）→ 開始遠征。
 * 塔戰無捕獲/地形/野外意外；連續 escalating 戰鬥，輸一場即結算、依到達樓層給 SP/經驗。
 */
export function TowerSetupScreen() {
  const { send } = useGame()
  const roster = useRoster((s) => s.roster)
  const bestFloor = useRun((s) => s.bestFloor)
  const ascensionUnlocked = useRun((s) => s.ascensionUnlocked)
  const cards = useMemo(
    () => roster.map((u) => { const card = ownedToCard(u); return { card, mon: buildBattleMobie(card) } }),
    [roster],
  )
  const [picked, setPicked] = useState<string[]>([])
  const [ascension, setAscension] = useState(0)

  const toggle = (cardId: string) => {
    audio.play('select')
    setPicked((prev) => prev.includes(cardId) ? prev.filter((id) => id !== cardId) : prev.length >= TEAM_SIZE ? prev : [...prev, cardId])
  }

  const ready = picked.length === TEAM_SIZE
  const start = () => {
    if (!ready) return
    const chosen = picked.map((id) => cards.find((c) => c.card.cardId === id)?.card).filter((c): c is NonNullable<typeof c> => Boolean(c))
    const seed = `${Date.now()}-${Math.floor(Math.random() * 1e6)}` // run-unique 種子（決定論 foe）
    audio.play('super')
    send({ type: 'START_TOWER', cards: chosen, ascension, seed })
  }

  return (
    <div className="col" style={{ flex: 1, gap: 16, minHeight: 0 }}>
      <button className="btn btn--ghost" style={{ alignSelf: 'flex-start', padding: '10px 18px' }} onClick={() => send({ type: 'BACK' })}>
        ← 返回
      </button>

      <div className="col" style={{ gap: 4 }}>
        <div className="eyebrow">🗼 連勝塔 · 遠征</div>
        <div className="h-title" style={{ fontSize: 28 }}>挑戰連勝塔</div>
        <div className="h-sub">連續對戰、樓層越高敵越強；輸一場即結算。最高紀錄：第 {bestFloor} 層</div>
      </div>

      {/* 難度階選擇（受解鎖上限限制） */}
      <div className="col" style={{ gap: 6 }}>
        <div className="trainer-sec" style={{ margin: 0 }}>難度階（Ascension，越高敵越強、SP 越多）</div>
        <div className="row" style={{ gap: 8, flexWrap: 'wrap' }}>
          {ASCENSIONS.map((a) => {
            const locked = a.level > ascensionUnlocked
            return (
              <button
                key={a.level}
                className={`asc-chip ${ascension === a.level ? 'asc-chip--on' : ''}`}
                disabled={locked}
                onClick={() => { audio.play('select'); setAscension(a.level) }}
              >
                {locked ? '🔒 ' : ''}{a.name}{a.levelBonus > 0 ? ` +${a.levelBonus}` : ''}
              </button>
            )
          })}
        </div>
      </div>

      <div className="trainer-sec" style={{ margin: 0 }}>選 {TEAM_SIZE} 隻出戰（整場遠征固定）</div>
      <div className="hand scroll-y" style={{ paddingBottom: 8 }}>
        {cards.map(({ card, mon }, i) => {
          const order = picked.indexOf(card.cardId)
          const isPicked = order >= 0
          return (
            <motion.button
              key={card.cardId}
              className={`poke-card ${isPicked ? 'poke-card--picked' : ''}`}
              initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.03 * i }}
              whileTap={{ scale: 0.95 }}
              onClick={() => toggle(card.cardId)}
            >
              <span className="poke-card__lv">Lv.{mon.level}</span>
              <AnimatePresence>
                {isPicked && (
                  <motion.span className="poke-card__pick" initial={{ scale: 0, x: '-50%' }} animate={{ scale: 1, x: '-50%' }} exit={{ scale: 0, x: '-50%' }}>
                    {order + 1}
                  </motion.span>
                )}
              </AnimatePresence>
              <div className="poke-card__art"><MobieSprite src={mon.artworkUrl} alt={mon.nameZh} shiny={mon.shiny} /></div>
              <div className="poke-card__name">{mon.nameZh}</div>
              <div className="poke-card__types"><TypeBadges types={mon.types} /></div>
            </motion.button>
          )
        })}
      </div>

      <motion.button
        className="btn" style={{ alignSelf: 'center', fontSize: 19, padding: '16px 48px' }}
        animate={{ opacity: ready ? 1 : 0.5 }} whileTap={ready ? { scale: 0.96 } : undefined}
        disabled={!ready} onClick={start}
      >
        🗼 開始遠征　<span style={{ fontSize: 14, opacity: 0.85 }}>{picked.length}/{TEAM_SIZE}</span>
      </motion.button>
    </div>
  )
}
