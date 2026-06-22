import { useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { useGame } from '@/app/GameProvider'
import { useBattleStore, type Side, type HitFx } from '@/store/battleStore'
import { buildBattlePokemon } from '@/game/stats'
import { resolveTurn, type BattleEvent, type BattleState } from '@/game/battle/reducer'
import type { QteQuality } from '@/game/battle/engine'
import type { BattlePokemon } from '@/game/types'
import { PokemonSprite } from '@/ui/components/PokemonSprite'
import { HpBar } from '@/ui/components/HpBar'
import { TimingBar } from '@/ui/components/TimingBar'
import { FxCanvas, type FxHandle } from '@/scene/fx/FxCanvas'
import { TYPE_HEX } from '@/ui/typeMeta'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const monAt = (b: BattleState, side: Side, i: number) => b[side].members[i]
// FxCanvas 上的概略打點位置（對齊版面：敵方上、我方下）
const FX_POS: Record<Side, { nx: number; ny: number }> = {
  foe: { nx: 0.72, ny: 0.22 },
  player: { nx: 0.3, ny: 0.62 },
}

function Combatant({
  mon, side, attacking, hitFx, fainting,
}: { mon: BattlePokemon; side: Side; attacking: Side | null; hitFx: HitFx | null; fainting: Side | null }) {
  const lunge = useAnimationControls()
  const shake = useAnimationControls()
  const isFoe = side === 'foe'
  const isFainting = fainting === side

  useEffect(() => {
    if (attacking === side) {
      lunge.start({
        x: isFoe ? [0, -52, 0] : [0, 52, 0],
        y: isFoe ? [0, 44, 0] : [0, -44, 0],
        transition: { duration: 0.42, times: [0, 0.4, 1] },
      })
    }
  }, [attacking, side, isFoe, lunge])

  useEffect(() => {
    if (hitFx && hitFx.target === side && !hitFx.missed && hitFx.amount > 0) {
      shake.start({
        x: [0, -10, 9, -7, 5, 0],
        filter: ['brightness(1)', 'brightness(2.4)', 'brightness(1)'],
        transition: { duration: 0.42 },
      })
    }
  }, [hitFx, side, shake])

  const showDmg = hitFx && hitFx.target === side && !hitFx.missed && hitFx.amount > 0

  return (
    <motion.div
      animate={lunge}
      style={{ position: 'relative', width: 'min(46vw, 230px)', height: 'min(46vw, 230px)' }}
    >
      {/* 換上場時整體入場（key 變動會重掛此節點觸發 initial→animate） */}
      <motion.div
        initial={{ opacity: 0, scale: 0.55, y: isFoe ? -20 : 20 }}
        animate={isFainting
          ? { opacity: 0.1, scale: 0.75, y: 12, filter: 'grayscale(1) brightness(0.6)' }
          : { opacity: 1, scale: 1, y: 0, filter: 'grayscale(0)' }}
        transition={isFainting ? { duration: 0.5, ease: 'easeIn' } : { type: 'spring', stiffness: 160, damping: 15 }}
        style={{ width: '100%', height: '100%', position: 'relative' }}
      >
        <div className="platform" />
        <motion.div animate={shake} style={{ width: '100%', height: '100%' }}>
          <PokemonSprite src={mon.artworkUrl} alt={mon.nameZh} shiny={mon.shiny} flip={!isFoe} />
        </motion.div>
      </motion.div>

      <AnimatePresence>
        {showDmg && (
          <motion.div
            key={hitFx!.id}
            className={`float-dmg ${hitFx!.crit ? 'float-dmg--crit' : ''}`}
            style={{ left: '50%', top: '20%' }}
            initial={{ y: 10, opacity: 0, scale: 0.6, x: '-50%' }}
            animate={{ y: -54, opacity: 1, scale: 1, x: '-50%' }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.5 }}
          >
            -{hitFx!.amount}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

/** 底部常駐隊伍 tray：每隻一顆 HP pip，倒下灰階、在場高亮 */
function TeamTray({ members, activeIndex, align }: {
  members: BattlePokemon[]; activeIndex: number; align: 'start' | 'end'
}) {
  return (
    <div className="tray" style={{ justifyContent: align === 'end' ? 'flex-end' : 'flex-start' }}>
      {members.map((m, i) => {
        const frac = Math.max(0, m.currentHp) / m.maxHp
        const fainted = m.currentHp <= 0
        const tone = frac > 0.5 ? '' : frac > 0.2 ? 'tray__fill--mid' : 'tray__fill--low'
        return (
          <div
            key={i}
            className={`tray__pip ${i === activeIndex ? 'tray__pip--active' : ''} ${fainted ? 'tray__pip--out' : ''}`}
            title={m.nameZh}
          >
            <div className={`tray__fill ${tone}`} style={{ width: `${frac * 100}%` }} />
            {fainted && <span className="tray__x">✕</span>}
          </div>
        )
      })}
    </div>
  )
}

/** 換人面板：選一個未倒下、非在場、未鎖的隊友換上 */
function SwitchPanel({ members, activeIndex, lockedIndex, onPick, onCancel }: {
  members: BattlePokemon[]
  activeIndex: number
  lockedIndex: number | null
  onPick: (i: number) => void
  onCancel: () => void
}) {
  return (
    <motion.div
      className="switch-panel"
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
    >
      <div className="switch-panel__title">換上哪一隻？</div>
      <div className="switch-panel__list">
        {members.map((m, i) => {
          const fainted = m.currentHp <= 0
          const isActive = i === activeIndex
          const locked = i === lockedIndex
          const disabled = fainted || isActive || locked
          const frac = Math.max(0, m.currentHp) / m.maxHp
          const tone = frac > 0.5 ? '' : frac > 0.2 ? 'hpbar__fill--mid' : 'hpbar__fill--low'
          const tag = isActive ? '出戰中' : fainted ? '倒下' : locked ? '剛換下' : null
          return (
            <button
              key={i}
              className="switch-card"
              disabled={disabled}
              onClick={() => !disabled && onPick(i)}
            >
              <div className="switch-card__art">
                <img src={m.artworkUrl} alt={m.nameZh} style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
              </div>
              <div className="switch-card__name">{m.nameZh} <span className="hpbar__lv">Lv.{m.level}</span></div>
              <div className="hpbar__track" style={{ height: 8 }}>
                <div className={`hpbar__fill ${tone}`} style={{ width: `${frac * 100}%` }} />
              </div>
              {tag && <span className="switch-card__tag">{tag}</span>}
            </button>
          )
        })}
      </div>
      <button className="btn btn--ghost" style={{ alignSelf: 'center', padding: '10px 28px' }} onClick={onCancel}>
        取消
      </button>
    </motion.div>
  )
}

export function BattleScreen() {
  const { context, send } = useGame()
  const battle = useBattleStore((s) => s.battle)
  const phase = useBattleStore((s) => s.phase)
  const banner = useBattleStore((s) => s.banner)
  const attacking = useBattleStore((s) => s.attacking)
  const hitFx = useBattleStore((s) => s.hitFx)
  const fainting = useBattleStore((s) => s.fainting)
  const log = useBattleStore((s) => s.log)

  const fxRef = useRef<FxHandle>(null)
  const rootShake = useAnimationControls()
  const initedRef = useRef(false)
  // 換人面板選中的隊友索引（等防禦 QTE）
  const [pendingSwitch, setPendingSwitch] = useState<number | null>(null)
  // 防濫用：剛換下的那隻，下一個換人不能立刻換回（一回合後解鎖）
  const [lockedIndex, setLockedIndex] = useState<number | null>(null)

  // 初始化：建出雙方 3 隻隊伍，進場
  useEffect(() => {
    if (initedRef.current || context.playerTeam.length === 0 || context.foeTeam.length === 0) return
    initedRef.current = true
    const players = context.playerTeam.map(buildBattlePokemon)
    const foes = context.foeTeam.map(buildBattlePokemon)
    const s = useBattleStore.getState()
    s.init(players, foes)
    ;(async () => {
      await wait(700)
      s.pushLog(`對手派出了 ${foes[0].nameZh}！`)
      await wait(280)
      s.pushLog(`上吧，${players[0].nameZh}！`)
      s.setPhase('playerChoice')
    })()
  }, [context])

  // 戰鬥結束 → 通知流程狀態機
  useEffect(() => {
    if (phase !== 'won' && phase !== 'lost') return
    const t = setTimeout(
      () => send({ type: 'END_BATTLE', outcome: phase === 'won' ? 'win' : 'lose' }),
      1100,
    )
    return () => clearTimeout(t)
  }, [phase, send])

  // 依序消費 reducer events：一次算完、畫面慢慢演
  const playEvents = useCallback(async (b0: BattleState, events: BattleEvent[]) => {
    const store = () => useBattleStore.getState()
    for (const e of events) {
      if (e.type === 'damageApplied') {
        const atk = monAt(b0, e.attackerSide, e.attackerIndex)
        const def = monAt(b0, e.targetSide, e.targetIndex)
        const atkPrefix = e.attackerSide === 'foe' ? '對手的 ' : ''
        store().setAttacking(e.attackerSide)
        store().setBanner(`${atkPrefix}${atk.nameZh} 使出 ${atk.move.nameZh}！`)
        await wait(440)

        store().setMemberHp(e.targetSide, e.targetIndex, e.hpAfter)
        store().showHit({
          target: e.targetSide, amount: e.amount,
          crit: e.crit, effText: e.effectivenessText, missed: e.missed,
        })
        // 粒子 / 螢幕震動（不過 React state）
        if (!e.missed && e.amount > 0) {
          const pos = FX_POS[e.targetSide]
          const color = TYPE_HEX[atk.move.type]
          const strong = e.crit || e.effectiveness >= 2
          fxRef.current?.burst({ ...pos, color, count: strong ? 24 : 16, power: strong ? 1.4 : 1 })
          if (e.crit) {
            fxRef.current?.burst({ ...pos, color: '#ffd23f', count: 14, power: 1.6, kind: 'spark' })
            fxRef.current?.ring({ ...pos, color: '#ffd23f' })
            fxRef.current?.flash('#ffffff', 0.45)
          } else if (e.effectiveness >= 2) {
            fxRef.current?.ring({ ...pos, color })
          }
          const mag = e.crit ? 16 : e.effectiveness >= 2 ? 11 : 6
          rootShake.start({ x: [0, -mag, mag * 0.8, -mag * 0.5, 0], transition: { duration: 0.34 } })
        }
        if (e.missed) {
          store().setBanner('攻擊沒有命中…')
          store().pushLog(`${atk.nameZh} 的攻擊落空了！`)
        } else if (e.effectiveness === 0) {
          store().setBanner('沒有效果…')
          store().pushLog(`對 ${def.nameZh} 完全沒有效果…`)
        } else {
          const bits: string[] = []
          if (e.crit) bits.push('會心一擊！')
          if (e.effectivenessText) bits.push(e.effectivenessText)
          store().setBanner(bits.join('　') || null)
          store().pushLog(`對 ${def.nameZh} 造成 ${e.amount} 點傷害`)
        }
        await wait(820)
        store().clearFx()
        store().setBanner(null)
        await wait(140)
      } else if (e.type === 'memberFainted') {
        const m = monAt(b0, e.side, e.index)
        const prefix = e.side === 'foe' ? '對手的 ' : ''
        store().setFainting(e.side) // 觸發倒下淡出
        fxRef.current?.burst({ ...FX_POS[e.side], color: '#8893a8', count: 18, kind: 'puff' })
        store().pushLog(`${prefix}${m.nameZh} 倒下了！`)
        await wait(620)
      } else if (e.type === 'activeChanged') {
        store().setFainting(null) // 換上新的一隻 → 清掉淡出
        store().setActiveIndex(e.side, e.toIndex)
        const m = monAt(b0, e.side, e.toIndex)
        // 放出開球閃光
        fxRef.current?.ring({ ...FX_POS[e.side], color: '#ffffff' })
        if (e.side === 'player') fxRef.current?.flash('#ffffff', 0.3)
        store().setBanner(e.side === 'player' ? `上吧，${m.nameZh}！` : `對手派出了 ${m.nameZh}！`)
        await wait(640)
        store().setBanner(null)
        await wait(120)
      } else if (e.type === 'switchDefenseResolved') {
        const pct = Math.round((1 - e.damageMult) * 100)
        const label =
          e.defenseQuality === 'perfect' ? '完美防禦！'
            : e.defenseQuality === 'good' ? '防禦成功！'
              : e.defenseQuality === 'normal' ? '勉強防禦' : '防禦失敗…'
        store().setBanner(pct > 0 ? `${label}　減傷 ${pct}%` : label)
        store().pushLog(`${label}（減傷 ${pct}%）`)
        await wait(640)
        store().setBanner(null)
        await wait(110)
      }
      // battleEnded：迴圈結束後依 nextState.winner 設 phase
    }
  }, [rootShake])

  const runPlayerTurn = useCallback(async (quality: QteQuality) => {
    const store = useBattleStore.getState
    const b0 = store().battle
    if (!b0) return
    store().setPhase('busy')

    const { nextState, events } = resolveTurn(b0, { type: 'ATTACK', quality })
    await playEvents(b0, events)
    store().setBattle(nextState) // snap turn/winner（HP/active 已動畫到位）

    setLockedIndex(null) // 攻擊一回合後解除換回鎖
    if (nextState.winner === 'player') store().setPhase('won')
    else if (nextState.winner === 'foe') store().setPhase('lost')
    else store().setPhase('playerChoice')
  }, [playEvents])

  // 主動換人：收回換上 index → 對手打換上的 → 防禦 QTE 抵減
  const runSwitchTurn = useCallback(async (index: number, defenseQuality: QteQuality) => {
    const store = useBattleStore.getState
    const b0 = store().battle
    if (!b0) return
    const fromIndex = b0.player.activeIndex
    setPendingSwitch(null)
    store().setPhase('busy')

    const { nextState, events } = resolveTurn(b0, { type: 'SWITCH', index, defenseQuality })
    await playEvents(b0, events)
    store().setBattle(nextState)

    setLockedIndex(fromIndex) // 剛換下的不能立刻換回
    if (nextState.winner === 'player') store().setPhase('won')
    else if (nextState.winner === 'foe') store().setPhase('lost')
    else store().setPhase('playerChoice')
  }, [playEvents])

  if (!battle) return <div className="center" style={{ flex: 1 }}>準備戰鬥…</div>

  const player = battle.player.members[battle.player.activeIndex]
  const foe = battle.foe.members[battle.foe.activeIndex]
  const switchable = battle.player.members.some(
    (m, i) => i !== battle.player.activeIndex && m.currentHp > 0 && i !== lockedIndex,
  )

  return (
    <motion.div className="col" style={{ flex: 1, position: 'relative' }} animate={rootShake}>
      <FxCanvas ref={fxRef} />
      {/* 敵方 */}
      <div className="col" style={{ gap: 6 }}>
        <div className="row" style={{ justifyContent: 'flex-start' }}>
          <div style={{ width: '58%', maxWidth: 320 }}>
            <HpBar name={`對手的 ${foe.nameZh}`} level={foe.level} currentHp={foe.currentHp} maxHp={foe.maxHp} />
          </div>
          <div className="spacer" />
          <TeamTray members={battle.foe.members} activeIndex={battle.foe.activeIndex} align="end" />
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: -6 }}>
        <Combatant key={`foe-${battle.foe.activeIndex}`} mon={foe} side="foe" attacking={attacking} hitFx={hitFx} fainting={fainting} />
      </div>

      {/* 中央播報 */}
      <AnimatePresence>
        {banner && (
          <motion.div
            key={banner}
            className="battle-banner"
            initial={{ opacity: 0, y: 8, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.2 }}
          >
            {banner}
          </motion.div>
        )}
      </AnimatePresence>

      {/* 我方 */}
      <div className="row" style={{ justifyContent: 'flex-start', marginTop: 'auto' }}>
        <Combatant key={`player-${battle.player.activeIndex}`} mon={player} side="player" attacking={attacking} hitFx={hitFx} fainting={fainting} />
      </div>
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-end' }}>
        <TeamTray members={battle.player.members} activeIndex={battle.player.activeIndex} align="start" />
        <div style={{ width: '58%', maxWidth: 340 }}>
          <HpBar name={player.nameZh} level={player.level} currentHp={player.currentHp} maxHp={player.maxHp} showNumbers />
        </div>
      </div>

      {/* 底部控制區 */}
      <div className="col center" style={{ gap: 12, marginTop: 14, minHeight: 120 }}>
        <div className="battle-log">
          {log.length === 0 ? (
            <span className="battle-log__line--dim">戰鬥開始！</span>
          ) : (
            log.map((line, i) => (
              <div key={i} className={`battle-log__line ${i < log.length - 1 ? 'battle-log__line--dim' : ''}`}>
                {line}
              </div>
            ))
          )}
        </div>

        {phase === 'playerChoice' && (
          <motion.div className="row" style={{ gap: 12, justifyContent: 'center' }}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            <motion.button
              className="btn" style={{ fontSize: 19, padding: '16px 36px' }}
              whileTap={{ scale: 0.96 }}
              onClick={() => useBattleStore.getState().setPhase('qte')}
            >
              ⚔ 攻擊　<span style={{ fontSize: 14, opacity: 0.8 }}>{player.move.nameZh}</span>
            </motion.button>
            <motion.button
              className="btn btn--ghost" style={{ fontSize: 18, padding: '16px 26px' }}
              whileTap={switchable ? { scale: 0.96 } : undefined}
              disabled={!switchable}
              onClick={() => useBattleStore.getState().setPhase('switchSelect')}
            >
              🔄 換人
            </motion.button>
          </motion.div>
        )}

        {phase === 'switchSelect' && (
          <SwitchPanel
            members={battle.player.members}
            activeIndex={battle.player.activeIndex}
            lockedIndex={lockedIndex}
            onPick={(i) => { setPendingSwitch(i); useBattleStore.getState().setPhase('defenseQte') }}
            onCancel={() => useBattleStore.getState().setPhase('playerChoice')}
          />
        )}

        {phase === 'qte' && <TimingBar onResult={runPlayerTurn} />}

        {phase === 'defenseQte' && (
          <TimingBar
            hint="換人中！點擊停在正中可大幅減傷！"
            onResult={(q) => { if (pendingSwitch !== null) runSwitchTurn(pendingSwitch, q) }}
          />
        )}

        {(phase === 'busy' || phase === 'intro') && (
          <div className="hpbar__num" style={{ height: 46, display: 'grid', placeItems: 'center' }}>…</div>
        )}
      </div>
    </motion.div>
  )
}
