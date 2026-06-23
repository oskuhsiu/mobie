import { motion, AnimatePresence } from 'framer-motion'
import { useMemo, useState } from 'react'
import { useGame } from '@/app/GameProvider'
import { TEAM_SIZE } from '@/game/machine/gameMachine'
import { useRoster } from '@/store/rosterStore'
import { useSettings } from '@/store/settingsStore'
import { ownedToCard } from '@/game/growth'
import { buildBattlePokemon } from '@/game/stats'
import { scoreCardVsFoes, recommendTeamIds, type Matchup } from '@/game/recommend'
import { audio } from '@/audio/audioEngine'
import { PokemonSprite } from '@/ui/components/PokemonSprite'
import { TypeBadges } from '@/ui/components/TypeBadge'
import { IndividualInfo } from '@/ui/components/IndividualInfo'

export function CardSelectScreen() {
  const { context, send } = useGame()
  // 對手全隊（不只第一隻）：建議要考慮整隊相剋
  const foes = useMemo(() => context.foeTeam.map(buildBattlePokemon), [context.foeTeam])

  const roster = useRoster((s) => s.roster)
  const cards = useMemo(
    () => roster.map((u) => {
      const card = ownedToCard(u)
      return { card, mon: buildBattlePokemon(card) }
    }),
    [roster],
  )

  // 每張卡對「對手整隊」的攻防適配度（剋制數 / 弱勢數 / 評分）
  const matchups = useMemo(() => {
    const m: Record<string, Matchup> = {}
    for (const c of cards) m[c.card.cardId] = scoreCardVsFoes(c.mon, foes)
    return m
  }, [cards, foes])
  // 一鍵推薦的最佳 3 隻（依評分高→低）
  const recommendedIds = useMemo(
    () => recommendTeamIds(cards.map((c) => ({ id: c.card.cardId, mon: c.mon })), foes, TEAM_SIZE),
    [cards, foes],
  )
  const recommendedSet = useMemo(() => new Set(recommendedIds), [recommendedIds])

  // 已選卡片 id（依點選順序，最多 TEAM_SIZE 隻）
  const [picked, setPicked] = useState<string[]>([])

  // 生效羈絆（plan/09 §2）：用同一份 prep；羈絆模組關閉時 preBattleHooks 為空＝無 tag。
  const prep = useSettings((s) => s.prep)
  const pickedMons = useMemo(
    () => picked.map((id) => cards.find((c) => c.card.cardId === id)?.mon).filter((m): m is NonNullable<typeof m> => Boolean(m)),
    [picked, cards],
  )
  const synergies = useMemo(() => prep.preBattleHooks.flatMap((h) => h(pickedMons)), [prep, pickedMons])

  // 一鍵填入推薦陣容（玩家可再自行調整後再出戰）
  const pickRecommended = () => {
    audio.play('select')
    setPicked(recommendedIds)
  }

  const toggle = (cardId: string) => {
    audio.play('select')
    setPicked((prev) => {
      if (prev.includes(cardId)) return prev.filter((id) => id !== cardId)
      if (prev.length >= TEAM_SIZE) return prev
      return [...prev, cardId]
    })
  }

  const engage = () => {
    if (picked.length !== TEAM_SIZE) return
    const chosen = picked
      .map((id) => cards.find((c) => c.card.cardId === id)?.card)
      .filter((c): c is NonNullable<typeof c> => Boolean(c))
    send({ type: 'SELECT_TEAM', cards: chosen })
  }

  const ready = picked.length === TEAM_SIZE

  return (
    <div className="col" style={{ flex: 1, gap: 16, minHeight: 0 }}>
      <button className="btn btn--ghost" style={{ alignSelf: 'flex-start', padding: '10px 18px' }}
        onClick={() => send({ type: 'BACK' })}>
        ← 返回
      </button>

      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end', gap: 12 }}>
        <div className="col" style={{ gap: 4 }}>
          <div className="eyebrow">Step 2 · 組你的隊伍</div>
          <div className="h-title" style={{ fontSize: 28 }}>選擇出戰寶可夢</div>
          <div className="h-sub">挑 {TEAM_SIZE} 隻組隊；不熟屬性？按「推薦出戰」幫你挑剋制陣容</div>
        </div>
        <motion.button
          className="btn btn--ghost" style={{ padding: '12px 18px', whiteSpace: 'nowrap', fontSize: 15 }}
          whileTap={{ scale: 0.96 }}
          onClick={pickRecommended}
        >
          ✨ 推薦出戰
        </motion.button>
      </div>

      {/* 對手陣容（含屬性），讓玩家對照下方的剋/弱徽章 */}
      <div className="foe-strip">
        <span className="foe-strip__label">對手</span>
        <div className="foe-strip__list scroll">
          {foes.map((f, i) => (
            <div
              key={i}
              className={`foe-strip__mon ${i === foes.length - 1 ? 'foe-strip__mon--boss' : ''}`}
              title={`${f.nameZh} Lv.${f.level}`}
            >
              <img src={f.artworkUrl} alt={f.nameZh} />
              <div className="foe-strip__types"><TypeBadges types={f.types} /></div>
            </div>
          ))}
        </div>
      </div>

      <div className="hand scroll-y" style={{ paddingBottom: 8 }}>
        {cards.map(({ card, mon }, i) => {
          const mu = matchups[card.cardId]
          const isRec = recommendedSet.has(card.cardId)
          const order = picked.indexOf(card.cardId)
          const isPicked = order >= 0
          return (
            <motion.button
              key={card.cardId}
              className={`poke-card ${isPicked ? 'poke-card--picked' : ''} ${isRec ? 'poke-card--rec' : ''}`}
              initial={{ opacity: 0, rotateY: 35, y: 20 }}
              animate={{ opacity: 1, rotateY: 0, y: 0 }}
              transition={{ delay: 0.05 * i, type: 'spring', stiffness: 150, damping: 16 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => toggle(card.cardId)}
            >
              <span className="poke-card__lv">Lv.{mon.level}</span>
              <div className="matchup-badges">
                {mu && mu.counters > 0 && (
                  <span className="matchup-badge matchup-badge--good">剋 {mu.counters}</span>
                )}
                {mu && mu.weakTo > 0 && (
                  <span className="matchup-badge matchup-badge--bad">弱 {mu.weakTo}</span>
                )}
              </div>
              {isRec && <span className="poke-card__rec">⭐ 推薦</span>}
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
              <IndividualInfo mon={mon} />
            </motion.button>
          )
        })}
      </div>

      {synergies.length > 0 && (
        <motion.div className="synergy-tags" style={{ justifyContent: 'center' }}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
          {synergies.map((m, i) => (
            <span key={i} className="synergy-tag" title={m.label}>{m.icon} {m.label}</span>
          ))}
        </motion.div>
      )}

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
