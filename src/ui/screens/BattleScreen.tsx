import { useCallback, useEffect, useRef } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { useGame } from '@/app/GameProvider'
import { useBattleStore, type Side, type HitFx } from '@/store/battleStore'
import { buildBattlePokemon } from '@/game/stats'
import { playerActsFirst, type QteQuality } from '@/game/battle/engine'
import type { BattlePokemon } from '@/game/types'
import { PokemonSprite } from '@/ui/components/PokemonSprite'
import { HpBar } from '@/ui/components/HpBar'
import { TimingBar } from '@/ui/components/TimingBar'

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))

function Combatant({
  mon, side, attacking, hitFx,
}: { mon: BattlePokemon; side: Side; attacking: Side | null; hitFx: HitFx | null }) {
  const lunge = useAnimationControls()
  const shake = useAnimationControls()
  const isFoe = side === 'foe'

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
    <motion.div animate={lunge} style={{ position: 'relative', width: 'min(46vw, 230px)', height: 'min(46vw, 230px)' }}>
      <div className="platform" />
      <motion.div animate={shake} style={{ width: '100%', height: '100%' }}>
        <PokemonSprite src={mon.artworkUrl} alt={mon.nameZh} shiny={mon.shiny} flip={!isFoe} />
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

export function BattleScreen() {
  const { context, send } = useGame()
  const player = useBattleStore((s) => s.player)
  const foe = useBattleStore((s) => s.foe)
  const phase = useBattleStore((s) => s.phase)
  const banner = useBattleStore((s) => s.banner)
  const attacking = useBattleStore((s) => s.attacking)
  const hitFx = useBattleStore((s) => s.hitFx)
  const log = useBattleStore((s) => s.log)

  const initedRef = useRef(false)

  useEffect(() => {
    if (initedRef.current || !context.wild || !context.playerCard) return
    initedRef.current = true
    const p = buildBattlePokemon(context.playerCard)
    const f = buildBattlePokemon(context.wild)
    const s = useBattleStore.getState()
    s.init(p, f)
    ;(async () => {
      await wait(750)
      s.pushLog(`你派出了 ${p.nameZh}！`)
      s.setPhase('playerChoice')
    })()
  }, [context])

  // 戰鬥結束 → 通知流程狀態機
  useEffect(() => {
    if (phase !== 'won' && phase !== 'lost') return
    const t = setTimeout(
      () => send({ type: 'END_BATTLE', outcome: phase === 'won' ? 'win' : 'lose' }),
      1050,
    )
    return () => clearTimeout(t)
  }, [phase, send])

  const doAttack = useCallback(async (side: Side, quality?: QteQuality) => {
    const s = useBattleStore.getState()
    const atkMon = side === 'player' ? s.player! : s.foe!
    const defName = side === 'player' ? s.foe!.nameZh : s.player!.nameZh
    const prefix = side === 'foe' ? '野生的 ' : ''
    s.setAttacking(side)
    s.setBanner(`${prefix}${atkMon.nameZh} 使出 ${atkMon.move.nameZh}！`)
    await wait(440)

    const result = s.applyHit(side, quality)
    if (result.missed) {
      s.setBanner('攻擊沒有命中…')
      s.pushLog(`${atkMon.nameZh} 的攻擊落空了！`)
    } else if (result.effectiveness === 0) {
      s.setBanner('沒有效果…')
      s.pushLog(`對 ${defName} 完全沒有效果…`)
    } else {
      const bits: string[] = []
      if (result.crit) bits.push('會心一擊！')
      if (result.effectivenessText) bits.push(result.effectivenessText)
      s.setBanner(bits.join('　') || null)
      s.pushLog(`對 ${defName} 造成 ${result.damage} 點傷害`)
    }
    await wait(840)
    s.clearFx()
    s.setBanner(null)
    await wait(150)
  }, [])

  const runTurn = useCallback(async (quality: QteQuality) => {
    const s0 = useBattleStore.getState()
    s0.setPhase('busy')
    const order: Side[] = playerActsFirst(s0.player!, s0.foe!) ? ['player', 'foe'] : ['foe', 'player']
    for (const side of order) {
      const cur = useBattleStore.getState()
      if (cur.phase === 'won' || cur.phase === 'lost') break
      await doAttack(side, side === 'player' ? quality : undefined)
    }
    const after = useBattleStore.getState()
    if (after.phase !== 'won' && after.phase !== 'lost') after.setPhase('playerChoice')
  }, [doAttack])

  if (!player || !foe) return <div className="center" style={{ flex: 1 }}>準備戰鬥…</div>

  return (
    <div className="col" style={{ flex: 1, position: 'relative' }}>
      {/* 敵方 */}
      <div className="row" style={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ width: '54%', maxWidth: 320 }}>
          <HpBar name={`野生的 ${foe.nameZh}`} level={foe.level} currentHp={foe.currentHp} maxHp={foe.maxHp} />
        </div>
      </div>
      <div className="row" style={{ justifyContent: 'flex-end', marginTop: -6 }}>
        <Combatant mon={foe} side="foe" attacking={attacking} hitFx={hitFx} />
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
        <Combatant mon={player} side="player" attacking={attacking} hitFx={hitFx} />
      </div>
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <div style={{ width: '60%', maxWidth: 340 }}>
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
          <motion.button
            className="btn" style={{ fontSize: 19, padding: '16px 52px' }}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}
            whileTap={{ scale: 0.96 }}
            onClick={() => useBattleStore.getState().setPhase('qte')}
          >
            ⚔ 攻擊　<span style={{ fontSize: 14, opacity: 0.8 }}>{player.move.nameZh}</span>
          </motion.button>
        )}

        {phase === 'qte' && <TimingBar onResult={runTurn} />}

        {(phase === 'busy' || phase === 'intro') && (
          <div className="hpbar__num" style={{ height: 46, display: 'grid', placeItems: 'center' }}>…</div>
        )}
      </div>
    </div>
  )
}
