import { motion, AnimatePresence } from 'framer-motion'
import { useMemo, useState } from 'react'
import { useGame } from '@/app/GameProvider'
import { TEAM_SIZE } from '@/game/machine/gameMachine'
import { useRoster } from '@/store/rosterStore'
import { PRODUCT_RUNTIME } from '@/game/ext/productRuntime'
import { ownedToCard } from '@/game/growth'
import { buildBattleMobie } from '@/game/stats'
import { scoreCardVsFoes, recommendTeamIds, type Matchup } from '@/game/recommend'
import { audio } from '@/audio/audioEngine'
import type { BattleMobie } from '@/game/types'
import { MobieSprite } from '@/ui/components/MobieSprite'
import { TypeBadges } from '@/ui/components/TypeBadge'
import { IndividualInfo } from '@/ui/components/IndividualInfo'
import { MobCard } from '@/ui/components/MobCard'
import { captureTargetOf } from '@/game/hunt'
import { canCaptureIn, lookupRegion } from '@/game/data/regionLookup'
import { rollEncounterAccidents } from '@/game/accidents'
import { useAccidents } from '@/store/accidentStore'

export function CardSelectScreen() {
  const { context, send } = useGame()
  // 對手全隊（不只第一隻）：建議要考慮整隊相剋
  const foes = useMemo(() => context.foeTeam.map(buildBattleMobie), [context.foeTeam])
  const target = captureTargetOf(foes)
  const captureEligible = canCaptureIn(context.regionId)
  const region = useMemo(() => {
    if (!context.regionId) return null
    try { return lookupRegion(context.regionId) } catch { return null }
  }, [context.regionId])
  const encounterAccidents = useMemo(
    () => region ? rollEncounterAccidents(region, context.foeTeam) : { luckyExpMult: 1, supply: null },
    [context.foeTeam, region],
  )
  const expMult = useAccidents((s) => s.expMult)
  const captureMult = useAccidents((s) => s.captureMult)
  const effectiveExpMult = Math.max(encounterAccidents.luckyExpMult, expMult)
  // M16：資訊卡（自己卡 owner 全顯、對手卡基本面+深度遮罩）
  const [cardView, setCardView] = useState<{ mon: BattleMobie; owner: boolean } | null>(null)

  const roster = useRoster((s) => s.roster)
  const cards = useMemo(
    () => roster.map((u) => {
      const card = ownedToCard(u)
      return { card, mon: buildBattleMobie(card) }
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
  const [adviceShown, setAdviceShown] = useState(false)

  // Preview the same fixed player synergy rules used by battle initialization.
  const pickedMons = useMemo(
    () => picked.map((id) => cards.find((c) => c.card.cardId === id)?.mon).filter((m): m is NonNullable<typeof m> => Boolean(m)),
    [picked, cards],
  )
  const synergies = useMemo(() => PRODUCT_RUNTIME.previewPlayerSynergy(pickedMons), [pickedMons])

  // 建議只揭露候選與理由；選取權始終留給玩家。
  const showAdvice = () => {
    audio.play('select')
    setAdviceShown(true)
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
          <div className="h-title" style={{ fontSize: 28 }}>選擇出戰Mobie</div>
          <div className="h-sub">挑 {TEAM_SIZE} 隻組隊；第一隻是先發，其餘依序後備</div>
        </div>
        <motion.button
          className="btn btn--ghost" style={{ padding: '12px 18px', whiteSpace: 'nowrap', fontSize: 15 }}
          whileTap={{ scale: 0.96 }}
          onClick={showAdvice}
          aria-pressed={adviceShown}
        >
          顯示建議
        </motion.button>
      </div>

      <div className="encounter-context encounter-context--team" data-encounter-context data-team-encounter-context>
        <div className="encounter-context__title">
          <span className="eyebrow">Encounter handoff</span>
          <span className="h-sub">{region?.name ?? '目前區域'} · {captureEligible ? '勝利後可嘗試收服 featured target' : '本場只結算經驗'}</span>
        </div>
        <div className="encounter-context__flags" data-accident-flags>
          {target && <span className="accident-tag">🎯 {captureEligible ? `捕獲承諾：${target.nameZh}` : `對戰主將：${target.nameZh}`}</span>}
          {effectiveExpMult > 1 && <span className="accident-tag">🍀 勝利經驗 ×{effectiveExpMult}</span>}
          {captureMult > 1 && <span className="accident-tag">🎯 捕獲率加成 ×{captureMult}</span>}
          {encounterAccidents.supply && <span className="accident-tag accident-tag--supply">📦 補給已選</span>}
        </div>
      </div>

      {/* 對手陣容（含屬性），讓玩家對照下方的剋/弱徽章 */}
      <div className="foe-strip">
        <span className="foe-strip__label capture-target-label">
          {target ? `${captureEligible ? '可收服目標' : '對戰主將'}：${target.nameZh}` : '對手'}
        </span>
        <div className="foe-strip__list scroll">
          {foes.map((f, i) => (
            <button
              key={i}
              className={`foe-strip__mon ${i === foes.length - 1 ? 'foe-strip__mon--boss' : ''}`}
              title={`${f.nameZh} Lv.${f.level}（看資訊卡）`}
              aria-label={`${f.nameZh}，${captureEligible && i === foes.length - 1 ? '可收服目標' : '對手隊伍成員'}`}
              onClick={() => { audio.play('select'); setCardView({ mon: f, owner: false }) }}
            >
              <span className="foe-strip__art"><MobieSprite src={f.artworkUrl} alt={f.nameZh} shiny={f.shiny} /></span>
              <div className="foe-strip__types"><TypeBadges types={f.types} /></div>
            </button>
          ))}
        </div>
      </div>

      <div className="hand scroll-y" style={{ paddingBottom: 8 }}>
        {cards.map(({ card, mon }, i) => {
          const mu = matchups[card.cardId]
          const isRec = recommendedSet.has(card.cardId)
          const order = picked.indexOf(card.cardId)
          const isPicked = order >= 0
          const positionLabel = order === 0 ? '先發' : `後備 ${order}`
          return (
            <motion.button
              key={card.cardId}
              className={`poke-card ${isPicked ? 'poke-card--picked' : ''} ${adviceShown && isRec ? 'poke-card--rec' : ''}`}
              aria-label={isPicked ? `取消選擇 ${mon.nameZh}，${positionLabel}` : `選擇 ${mon.nameZh}`}
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
              {adviceShown && isRec && <span className="poke-card__rec">⭐ 建議候選</span>}
              {adviceShown && mu && (
                <span className="col matchup-advice" style={{ gap: 2 }}>
                  <span className="matchup-advice__upside">進攻：{mu.counters > 0 ? `可克制 ${mu.counters} 名對手` : '缺少明顯屬性克制'}</span>
                  <span className="matchup-advice__risk">風險：{mu.weakTo > 0 ? `會被 ${mu.weakTo} 名對手克制` : '未發現明顯屬性弱點'}</span>
                </span>
              )}
              {/* ⓘ 開資訊卡（stopPropagation 不觸發選取，保留出戰手感） */}
              <span
                className="poke-card__info"
                role="button"
                title="查看資訊卡"
                onClick={(e) => { e.stopPropagation(); audio.play('select'); setCardView({ mon, owner: true }) }}
              >ⓘ</span>
              <AnimatePresence>
                {isPicked && (
                  <motion.span
                    className="poke-card__pick"
                    initial={{ scale: 0, x: '-50%' }} animate={{ scale: 1, x: '-50%' }} exit={{ scale: 0, x: '-50%' }}
                  >
                    {positionLabel}
                  </motion.span>
                )}
              </AnimatePresence>
              <div className="poke-card__art">
                <MobieSprite src={mon.artworkUrl} alt={mon.nameZh} shiny={mon.shiny} />
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

      <AnimatePresence>
        {cardView && (
          <MobCard mon={cardView.mon} owner={cardView.owner} revealed={false} onClose={() => setCardView(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}
