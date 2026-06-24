import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useAnimationControls } from 'framer-motion'
import { useGame } from '@/app/GameProvider'
import { useBattleStore, type Side, type HitFx } from '@/store/battleStore'
import { useSettings } from '@/store/settingsStore'
import { applyBattlePrep } from '@/store/ext'
import { buildBattleMobie } from '@/game/stats'
import {
  resolveTurn,
  chainEligible,
  type BattleEvent,
  type BattleState,
  type ChainHit,
  type SupportOutcome,
} from '@/game/battle/reducer'
import { chargeTier, type QteQuality } from '@/game/battle/engine'
import type { BattleMobie, TerrainId } from '@/game/types'
import { lookupRegion } from '@/game/data/regionLookup'
import { resolveBattleTerrains, resolveTerrainMult, terrainDefsOf } from '@/game/data/terrains'
import { TimingBar } from '@/ui/components/TimingBar'
import { FxCanvas, type FxHandle } from '@/scene/fx/FxCanvas'
import type { StageHandle } from '@/scene/r3f/BattleStage'
import { TYPE_HEX } from '@/ui/typeMeta'
import { getItem } from '@/game/ext/items'
import { getAbility } from '@/game/ext/abilities'
import { audio } from '@/audio/audioEngine'

// 3D 戰鬥舞台：較重（three/R3F），lazy 載入避免拖慢 title/region 等畫面
const BattleStage = lazy(() => import('@/scene/r3f/BattleStage'))

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms))
const monAt = (b: BattleState, side: Side, i: number) => b[side].members[i]
const SUPPORT_LABEL: Record<SupportOutcome, string> = {
  attackUp: '⚡ 攻擊力上升！',
  crit: '🎯 必定會心！',
  ally: '🤝 夥伴補刀！',
  dud: '… 可惜，摃龜',
}
// 星擊能量：QTE 表現累積（不綁隨機）；約 3 個好回合集滿（參數待玩測）
const QUALITY_ENERGY: Record<QteQuality, number> = { perfect: 46, good: 34, normal: 26, weak: 16 }
const energyGain = (q: QteQuality, mashCount: number) => QUALITY_ENERGY[q] + Math.min(24, mashCount) * 0.5
// HP 比例 → 色階 class（>50% 健康無 class / >20% mid / 其餘 low）
const hpToneClass = (frac: number, prefix: string) =>
  frac > 0.5 ? '' : frac > 0.2 ? `${prefix}--mid` : `${prefix}--low`
// FxCanvas 上的概略打點位置（對齊版面：敵方上、我方下）
const FX_POS: Record<Side, { nx: number; ny: number }> = {
  foe: { nx: 0.72, ny: 0.22 },
  player: { nx: 0.3, ny: 0.62 },
}

/** 浮傷數字：3D 場景之上的 DOM 疊層，依 FX_POS 對齊在受擊方上方。 */
function FloatDamage({ hitFx }: { hitFx: HitFx | null }) {
  const show = hitFx && !hitFx.missed && hitFx.amount > 0
  return (
    <AnimatePresence>
      {show && (
        <motion.div
          key={hitFx!.id}
          className={`float-dmg ${hitFx!.crit ? 'float-dmg--crit' : ''}`}
          style={{
            position: 'absolute',
            left: `${FX_POS[hitFx!.target].nx * 100}%`,
            top: `${FX_POS[hitFx!.target].ny * 100}%`,
            zIndex: 8,
          }}
          initial={{ y: 10, opacity: 0, scale: 0.6, x: '-50%' }}
          animate={{ y: -54, opacity: 1, scale: 1, x: '-50%' }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
        >
          -{hitFx!.amount}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

/** 場域地形小徽章（常駐 HUD）：顯示目前生效地形 icon + 名稱；中性/無地形不顯示。 */
function TerrainChip({ terrainIds }: { terrainIds: TerrainId[] }) {
  const defs = terrainDefsOf(terrainIds)
  if (defs.length === 0) return null
  return (
    <div className="terrain-chip" title="場域地形：影響該屬性招式的威力">
      {defs.map((d) => (
        <span key={d.id} className="terrain-chip__item">{d.icon} {d.name}</span>
      ))}
    </div>
  )
}

/** 底部常駐隊伍 tray：每隻一顆 HP pip，倒下灰階、在場高亮 */
function TeamTray({ members, activeIndex, align }: {
  members: BattleMobie[]; activeIndex: number; align: 'start' | 'end'
}) {
  return (
    <div className="tray" style={{ justifyContent: align === 'end' ? 'flex-end' : 'flex-start' }}>
      {members.map((m, i) => {
        const frac = Math.max(0, m.currentHp) / m.maxHp
        const fainted = m.currentHp <= 0
        const tone = hpToneClass(frac, 'tray__fill')
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

/** 緊貼立繪的精簡 HP 牌：名稱 + Lv + 血條（自家顯示數字）。放在角色同側，避免看錯誰的血。 */
function HpPlate({ mon, owner, label }: { mon: BattleMobie; owner: boolean; label: string }) {
  const ratio = Math.max(0, mon.currentHp) / mon.maxHp
  const tone = hpToneClass(ratio, 'hpbar__fill')
  const item = getItem(mon.heldItemId)
  const ability = getAbility(mon.abilityId)
  return (
    <div className={`hp-plate ${owner ? 'hp-plate--owner' : 'hp-plate--foe'}`}>
      <div className="hp-plate__top">
        <span className="hp-plate__name">{label}</span>
        <span className="hpbar__lv">Lv.{mon.level}</span>
        {ability && <span className="battle-badge" title={ability.desc}>{ability.icon} {ability.name}</span>}
        {item && <span className="battle-badge" title={item.name}>{item.icon}</span>}
      </div>
      <div className="hp-plate__track">
        <motion.div
          className={`hpbar__fill ${tone}`}
          initial={false}
          animate={{ width: `${ratio * 100}%` }}
          transition={{ duration: 0.5, ease: 'easeOut' }}
        />
      </div>
      {owner && (
        <div className="hp-plate__num">{Math.ceil(Math.max(0, mon.currentHp))} / {mon.maxHp}</div>
      )}
    </div>
  )
}

/** 換人面板：選一個未倒下、非在場、未鎖的隊友換上 */
function SwitchPanel({ members, activeIndex, lockedIndex, onPick, onCancel }: {
  members: BattleMobie[]
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
          const tone = hpToneClass(frac, 'hpbar__fill')
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

/** 連打蓄力：限時內瘋狂點擊累積色階加成（計數走 ref，不過 React state） */
function MashMeter({ onDone }: { onDone: (count: number) => void }) {
  const countRef = useRef(0)
  const barRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef(false)

  useEffect(() => {
    countRef.current = 0
    doneRef.current = false
    const t = setTimeout(() => {
      if (doneRef.current) return
      doneRef.current = true
      onDone(countRef.current)
    }, 950)
    return () => clearTimeout(t)
  }, [onDone])

  const tap = () => {
    if (doneRef.current) return
    const c = (countRef.current += 1)
    const tier = chargeTier(c)
    if (barRef.current) {
      barRef.current.style.width = `${Math.min(100, (c / 24) * 100)}%`
      barRef.current.style.background = tier.color
    }
    if (labelRef.current) labelRef.current.textContent = tier.label || '蓄力中…'
  }

  return (
    <div className="mash" onPointerDown={tap} role="button" tabIndex={0}>
      <div className="mash__hint">連打蓄力！瘋狂點擊衝高傷害</div>
      <div className="mash__track"><div ref={barRef} className="mash__fill" style={{ width: '0%' }} /></div>
      <div ref={labelRef} className="mash__tier">蓄力中…</div>
    </div>
  )
}

export function BattleScreen() {
  const { context, send } = useGame()
  const battle = useBattleStore((s) => s.battle)
  const phase = useBattleStore((s) => s.phase)
  const banner = useBattleStore((s) => s.banner)
  const hitFx = useBattleStore((s) => s.hitFx)
  const support = useBattleStore((s) => s.support)
  const energy = useBattleStore((s) => s.energy)
  const combo = useBattleStore((s) => s.combo)
  const log = useBattleStore((s) => s.log)
  // 已啟用模組組成的注入能力包（plan/09 §0）：ext=戰中縫（S3/S4/S5）、prep=戰前縫（S1/S2）。
  // 全關＝EMPTY_EXT/EMPTY_PREP＝零行為改變。
  const ext = useSettings((s) => s.ext)
  const prep = useSettings((s) => s.prep)

  const fxRef = useRef<FxHandle>(null)
  const stageRef = useRef<StageHandle>(null)
  const rootShake = useAnimationControls()
  const initedRef = useRef(false)
  // 換人面板選中的隊友索引（等防禦 QTE）
  const [pendingSwitch, setPendingSwitch] = useState<number | null>(null)
  // timing QTE 命中品質暫存，待連打蓄力結束才解算回合
  const pendingQualityRef = useRef<QteQuality>('normal')
  // 防濫用：剛換下的那隻，下一個換人不能立刻換回（一回合後解鎖）
  const [lockedIndex, setLockedIndex] = useState<number | null>(null)
  // M9 連鎖：連續 QTE 序列（participants=參與隊友索引、step=目前第幾段、hits=已收集宣告）
  const [chainSeq, setChainSeq] = useState<{ participants: number[]; step: number; hits: ChainHit[] } | null>(null)

  // 初始化：建出雙方 3 隻隊伍，進場
  useEffect(() => {
    if (initedRef.current || context.playerTeam.length === 0 || context.foeTeam.length === 0) return
    initedRef.current = true
    // 戰前縫：S1 道具/特性 statMod（兩方）+ S2 羈絆（只玩家隊）。全關＝原封不動。
    const { team: players, modifiers } = applyBattlePrep(context.playerTeam.map(buildBattleMobie), prep, true)
    const { team: foes } = applyBattlePrep(context.foeTeam.map(buildBattleMobie), prep, false)
    // 場域地形（M8）：依 region.mode/terrains/randomTerrain 解析；隨機地形以 foe 隊伍 cardId 當 seed
    // 決定論抽（同一場遭遇穩定、不隨 re-render 變動）。arena/無地形＝空＝中性。
    const region = context.regionId ? lookupRegion(context.regionId) : null
    const terrainSeed = context.foeTeam.map((c) => c.cardId).join('|')
    const terrains = region ? resolveBattleTerrains(region, terrainSeed) : []
    const terrainDefs = terrainDefsOf(terrains)
    const s = useBattleStore.getState()
    s.init(players, foes, terrains)
    ;(async () => {
      await wait(700)
      s.pushLog(`對手派出了 ${foes[0].nameZh}！`)
      await wait(280)
      s.pushLog(`上吧，${players[0].nameZh}！`)
      // 開場地形揭示（plan/11 §1.3）：有地形才演 banner
      if (terrainDefs.length > 0) {
        await wait(220)
        s.setBanner(`${terrainDefs.map((d) => d.icon).join('')} 場域地形：${terrainDefs.map((d) => d.name).join(' + ')}`)
        s.pushLog(`場域地形：${terrainDefs.map((d) => `${d.icon}${d.name}`).join(' + ')}（影響對應屬性招式威力）`)
        await wait(1100)
        s.setBanner(null)
        await wait(140)
      }
      if (modifiers.length > 0) {
        await wait(220)
        s.setBanner(`✦ 羈絆發動！ ${modifiers.map((m) => m.icon).join(' ')}`)
        for (const m of modifiers) s.pushLog(`羈絆：${m.label}`)
        await wait(1000)
        s.setBanner(null)
        await wait(140)
      }
      s.setPhase('playerChoice')
    })()
  }, [context, prep])

  // 戰鬥結束 → 通知流程狀態機
  useEffect(() => {
    if (phase !== 'won' && phase !== 'lost') return
    audio.play(phase === 'won' ? 'victory' : 'defeat')
    const t = setTimeout(
      () => send({ type: 'END_BATTLE', outcome: phase === 'won' ? 'win' : 'lose' }),
      1100,
    )
    return () => clearTimeout(t)
  }, [phase, send])

  // 低血量緊張度 → BGM 濾波/警報（依我方在場 HP）
  useEffect(() => {
    if (!battle) return
    const a = battle.player.members[battle.player.activeIndex]
    if (a && a.maxHp > 0) audio.setIntensity(1 - Math.max(0, a.currentHp) / a.maxHp)
  }, [battle])

  // 依序消費 reducer events：一次算完、畫面慢慢演
  const playEvents = useCallback(async (b0: BattleState, events: BattleEvent[]) => {
    const store = () => useBattleStore.getState()
    for (const e of events) {
      if (e.type === 'damageApplied') {
        const atk = monAt(b0, e.attackerSide, e.attackerIndex)
        const def = monAt(b0, e.targetSide, e.targetIndex)
        const atkPrefix = e.attackerSide === 'foe' ? '對手的 ' : ''
        stageRef.current?.lunge(e.attackerSide) // 3D：出手方撲擊
        store().setBanner(`${atkPrefix}${atk.nameZh} 使出 ${atk.move.nameZh}！`)
        audio.play('attack')
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
          stageRef.current?.hitReact(e.targetSide, strong ? 1.6 : 1) // 3D：受擊抖動
          audio.play(e.crit ? 'crit' : e.effectiveness >= 2 ? 'super' : 'hit')
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
        stageRef.current?.faint(e.side) // 3D：傾倒淡沉
        fxRef.current?.burst({ ...FX_POS[e.side], color: '#8893a8', count: 18, kind: 'puff' })
        audio.play('faint')
        store().pushLog(`${prefix}${m.nameZh} 倒下了！`)
        await wait(620)
      } else if (e.type === 'heal') {
        const m = monAt(b0, e.side, e.index)
        // 回血來源可能是道具（剩飯）或日後的特性——兩邊查，誰有就用誰
        const src = getItem(e.source) ?? getAbility(e.source)
        store().setMemberHp(e.side, e.index, e.hpAfter)
        fxRef.current?.burst({ ...FX_POS[e.side], color: '#4ade80', count: 12, power: 1, kind: 'spark' })
        audio.play('select')
        const prefix = e.side === 'foe' ? '對手的 ' : ''
        store().setBanner(`${src?.icon ?? '✨'} ${prefix}${m.nameZh} 回復了 ${e.amount} HP`)
        store().pushLog(`${prefix}${m.nameZh} 回復 ${e.amount} HP（${src?.name ?? e.source}）`)
        await wait(720)
        store().setBanner(null)
        await wait(120)
      } else if (e.type === 'activeChanged') {
        store().setActiveIndex(e.side, e.toIndex)
        stageRef.current?.enter(e.side) // 3D：新一隻落場入場（並清除倒下狀態）
        const m = monAt(b0, e.side, e.toIndex)
        // 放出開球閃光
        fxRef.current?.ring({ ...FX_POS[e.side], color: '#ffffff' })
        if (e.side === 'player') fxRef.current?.flash('#ffffff', 0.3)
        audio.play('switch')
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
      } else if (e.type === 'random' && e.event.type === 'supportRoulette') {
        const outcome = e.event.outcome as SupportOutcome
        store().setSupport(outcome)
        audio.play('select')
        await wait(950)
        audio.play(outcome === 'dud' ? 'select' : 'super')
        store().pushLog(`支援輪盤：${SUPPORT_LABEL[outcome]}`)
        await wait(800)
        store().setSupport(null)
        await wait(150)
      } else if (e.type === 'battleEnded' && e.reason === 'timeout') {
        // 回合上限：依剩餘血量判定，給玩家一個明確說明
        store().setBanner('達回合上限！依剩餘血量判定勝負')
        store().pushLog('回合數達上限，依雙方剩餘血量判定勝負')
        await wait(1150)
        store().setBanner(null)
        await wait(150)
      } else if (e.type === 'chainOpportunity') {
        // M9：連鎖槽集滿、可發動連鎖（下個 playerChoice 亮起連鎖鈕）
        store().setBanner('🔗 連鎖就緒！')
        store().pushLog('連鎖槽集滿！可發動連鎖攻擊')
        audio.play('super')
        fxRef.current?.flash('#7ae0ff', 0.3)
        await wait(680)
        store().setBanner(null)
        await wait(120)
      } else if (e.type === 'chainHit') {
        // M9：連鎖第 comboCount 段——亮連段數字 + spark；緊接的 damageApplied 演出實際傷害
        store().setCombo(e.comboCount)
        fxRef.current?.burst({ ...FX_POS.foe, color: '#7ae0ff', count: 12, power: 1.2, kind: 'spark' })
        audio.play('select')
        await wait(180)
      }
      // 其餘 random（accuracy/crit）：UI 不另演，已併入 damageApplied
      // battleEnded（自然勝負）：迴圈結束後依 nextState.winner 設 phase
    }
  }, [rootShake])

  const runPlayerTurn = useCallback(async (quality: QteQuality, mashCount = 0) => {
    const store = useBattleStore.getState
    const b0 = store().battle
    if (!b0) return
    store().setPhase('busy')

    const { nextState, events } = resolveTurn(b0, { type: 'ATTACK', quality, mashCount }, { ext, terrainMultiplier: resolveTerrainMult })
    await playEvents(b0, events)
    store().setBattle(nextState) // snap turn/winner（HP/active 已動畫到位）

    // 星擊能量：依 QTE 表現 + 是否命中（連鎖）累積
    const dealt = events.some((e) => e.type === 'damageApplied' && e.attackerSide === 'player' && !e.missed && e.amount > 0)
    store().addEnergy(energyGain(quality, mashCount), dealt)

    setLockedIndex(null) // 攻擊一回合後解除換回鎖
    if (nextState.winner === 'player') store().setPhase('won')
    else if (nextState.winner === 'foe') store().setPhase('lost')
    else store().setPhase('playerChoice')
  }, [playEvents, ext])

  // 星擊 Finisher：滿槽放，大倍率必定會心 + 華麗演出
  const runStarStrike = useCallback(async () => {
    const store = useBattleStore.getState
    const b0 = store().battle
    if (!b0) return
    store().setPhase('busy')
    store().resetEnergy()
    store().setBanner('★ 星擊發動！')
    audio.play('crit')
    fxRef.current?.flash('#ffffff', 0.7)
    fxRef.current?.ring({ ...FX_POS.foe, color: '#ff7ae0' })
    rootShake.start({ x: [0, -20, 18, -14, 10, 0], transition: { duration: 0.5 } })
    await wait(620)
    fxRef.current?.burst({ ...FX_POS.foe, color: '#ff7ae0', count: 40, power: 2, kind: 'spark' })

    const { nextState, events } = resolveTurn(b0, { type: 'ATTACK', starStrike: true }, { ext, terrainMultiplier: resolveTerrainMult })
    await playEvents(b0, events)
    store().setBattle(nextState)
    store().setBanner(null)
    store().addEnergy(0, false) // 連鎖歸零（星擊消耗）

    if (nextState.winner === 'player') store().setPhase('won')
    else if (nextState.winner === 'foe') store().setPhase('lost')
    else store().setPhase('playerChoice')
  }, [playEvents, rootShake, ext])

  // 主動換人：收回換上 index → 對手打換上的 → 防禦 QTE 抵減
  const runSwitchTurn = useCallback(async (index: number, defenseQuality: QteQuality) => {
    const store = useBattleStore.getState
    const b0 = store().battle
    if (!b0) return
    const fromIndex = b0.player.activeIndex
    setPendingSwitch(null)
    store().setPhase('busy')

    const { nextState, events } = resolveTurn(b0, { type: 'SWITCH', index, defenseQuality }, { ext, terrainMultiplier: resolveTerrainMult })
    await playEvents(b0, events)
    store().setBattle(nextState)

    setLockedIndex(fromIndex) // 剛換下的不能立刻換回
    if (nextState.winner === 'player') store().setPhase('won')
    else if (nextState.winner === 'foe') store().setPhase('lost')
    else store().setPhase('playerChoice')
  }, [playEvents, ext])

  // M9 連鎖：提交收集到的 hits → reducer 同步重驗 + 結算（吃速度/截斷在 reducer）
  const runChain = useCallback(async (hits: ChainHit[]) => {
    const store = useBattleStore.getState
    const b0 = store().battle
    if (!b0) return
    store().setPhase('busy')
    store().setBanner('🔗 連鎖攻擊！')
    audio.play('crit')
    fxRef.current?.flash('#7ae0ff', 0.4)
    await wait(420)

    const { nextState, events } = resolveTurn(b0, { type: 'SUBMIT_CHAIN_RESULT', hits }, { ext, terrainMultiplier: resolveTerrainMult })
    await playEvents(b0, events)
    store().setBattle(nextState)
    await wait(180)
    store().setCombo(null) // 連段 overlay 收尾

    setLockedIndex(null)
    if (nextState.winner === 'player') store().setPhase('won')
    else if (nextState.winner === 'foe') store().setPhase('lost')
    else store().setPhase('playerChoice')
  }, [playEvents, ext])

  // M9 連鎖：發動 → 依當前戰況算出參與隊友、開始連續 QTE 序列
  const startChain = useCallback(() => {
    const b = useBattleStore.getState().battle
    if (!b) return
    const maxHits = ext.chain?.maxHits ?? 3
    const participants = chainEligible(b.player, maxHits)
    if (participants.length === 0) return
    audio.play('select')
    setChainSeq({ participants, step: 0, hits: [] })
    useBattleStore.getState().setPhase('chainQte')
  }, [ext])

  // M9 連鎖：一段 QTE 結束 → 記錄宣告、推進到下一隻；全部跑完才提交
  const onChainQteResult = useCallback((q: QteQuality) => {
    setChainSeq((prev) => {
      if (!prev) return null
      const hits = [...prev.hits, { attackerIndex: prev.participants[prev.step], quality: q }]
      const nextStep = prev.step + 1
      if (nextStep >= prev.participants.length) {
        void runChain(hits)
        return null
      }
      return { ...prev, step: nextStep, hits }
    })
  }, [runChain])

  // 連打蓄力結束 → 帶 timing 品質 + 連打次數解算攻擊回合
  const onMashDone = useCallback((count: number) => {
    void runPlayerTurn(pendingQualityRef.current, count)
  }, [runPlayerTurn])

  if (!battle) return <div className="center" style={{ flex: 1 }}>準備戰鬥…</div>

  const player = battle.player.members[battle.player.activeIndex]
  const foe = battle.foe.members[battle.foe.activeIndex]
  const switchable = battle.player.members.some(
    (m, i) => i !== battle.player.activeIndex && m.currentHp > 0 && i !== lockedIndex,
  )
  // M9 連鎖：模組開啟才顯示連鎖槽；集滿可發動。連鎖槽住 reducer 的 battle.chainGauge（暫態）。
  const chainOn = !!ext.chain
  const chainMax = ext.chain?.gaugeFull ?? 100
  const chainPct = chainOn ? Math.min(100, (battle.chainGauge / chainMax) * 100) : 0
  const chainReady = chainOn && battle.chainGauge >= chainMax

  return (
    <motion.div className="col" style={{ flex: 1, position: 'relative' }} animate={rootShake}>
      {/* 3D 戰鬥舞台（背景層）：兩隻在場Mobie + 地台/光照/相機 */}
      <Suspense fallback={null}>
        <BattleStage ref={stageRef} player={player} foe={foe} />
      </Suspense>
      <FxCanvas ref={fxRef} />
      <FloatDamage hitFx={hitFx} />

      {/* 前景 HUD（疊在 3D 之上） */}
      <div className="col battle-fg" style={{ flex: 1, position: 'relative', zIndex: 10 }}>
      {/* 場域地形徽章（頂部置中常駐；中性/無地形不顯示） */}
      <TerrainChip terrainIds={battle.field.terrainEffects.current} />
      {/* 敵方：HP 牌與隊伍狀態（畫面上方右側） */}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <div className="combat-hud combat-hud--foe">
          <HpPlate mon={foe} owner={false} label={`對手的 ${foe.nameZh}`} />
          <TeamTray members={battle.foe.members} activeIndex={battle.foe.activeIndex} align="end" />
        </div>
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

      {/* 支援輪盤 overlay */}
      <AnimatePresence>
        {support && (
          <motion.div
            key="support"
            className="support-overlay"
            initial={{ opacity: 0, scale: 0.6, rotate: -8 }}
            animate={{ opacity: 1, scale: 1, rotate: 0 }}
            exit={{ opacity: 0, scale: 1.2 }}
            transition={{ type: 'spring', stiffness: 220, damping: 14 }}
          >
            <div className="support-overlay__title">支援輪盤！</div>
            <div className={`support-overlay__result ${support === 'dud' ? 'is-dud' : ''}`}>
              {SUPPORT_LABEL[support]}
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* M9 連鎖連段數 overlay（連鎖中各段命中時彈出） */}
      <AnimatePresence>
        {combo !== null && (
          <motion.div
            key={`combo-${combo}`}
            className="combo-overlay"
            initial={{ opacity: 0, scale: 0.5, y: 10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 1.3 }}
            transition={{ type: 'spring', stiffness: 320, damping: 16 }}
          >
            <span className="combo-overlay__num">{combo}</span>
            <span className="combo-overlay__label">CHAIN</span>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 我方：HP 牌與隊伍狀態（畫面下方左側），marginTop:auto 把後段推到底部 */}
      <div className="row" style={{ justifyContent: 'flex-start', marginTop: 'auto' }}>
        <div className="combat-hud combat-hud--player">
          <HpPlate mon={player} owner label={player.nameZh} />
          <TeamTray members={battle.player.members} activeIndex={battle.player.activeIndex} align="start" />
        </div>
      </div>

      {/* 底部控制區 */}
      <div className="col center" style={{ gap: 12, marginTop: 14, minHeight: 120 }}>
        {/* 星擊能量槽（極簡細條） */}
        <div className={`star-gauge ${energy >= 100 ? 'star-gauge--full' : ''}`}>
          <span className="star-gauge__icon">★</span>
          <div className="star-gauge__track">
            <div className="star-gauge__fill" style={{ width: `${energy}%` }} />
          </div>
          <span className="star-gauge__pct">{Math.floor(energy)}%</span>
        </div>

        {/* M9 連鎖槽（模組開啟才顯示；集滿亮起可發動連鎖） */}
        {chainOn && (
          <div className={`star-gauge chain-gauge ${chainReady ? 'star-gauge--full chain-gauge--full' : ''}`}>
            <span className="star-gauge__icon">🔗</span>
            <div className="star-gauge__track">
              <div className="star-gauge__fill chain-gauge__fill" style={{ width: `${chainPct}%` }} />
            </div>
            <span className="star-gauge__pct">{Math.floor(chainPct)}%</span>
          </div>
        )}

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
              onClick={() => { audio.play('select'); useBattleStore.getState().setPhase('qte') }}
            >
              ⚔ 攻擊　<span style={{ fontSize: 14, opacity: 0.8 }}>{player.move.nameZh}</span>
            </motion.button>
            <motion.button
              className="btn btn--ghost" style={{ fontSize: 18, padding: '16px 26px' }}
              whileTap={switchable ? { scale: 0.96 } : undefined}
              disabled={!switchable}
              onClick={() => { audio.play('select'); useBattleStore.getState().setPhase('switchSelect') }}
            >
              🔄 換人
            </motion.button>
            {energy >= 100 && (
              <motion.button
                className="btn btn--star" style={{ fontSize: 18, padding: '16px 24px' }}
                initial={{ scale: 0.8 }} animate={{ scale: [1, 1.06, 1] }}
                transition={{ duration: 1.1, repeat: Infinity }}
                whileTap={{ scale: 0.95 }}
                onClick={() => { audio.play('select'); void runStarStrike() }}
              >
                ★ 星擊
              </motion.button>
            )}
            {chainReady && (
              <motion.button
                className="btn btn--chain" style={{ fontSize: 18, padding: '16px 24px' }}
                initial={{ scale: 0.8 }} animate={{ scale: [1, 1.06, 1] }}
                transition={{ duration: 1.1, repeat: Infinity }}
                whileTap={{ scale: 0.95 }}
                onClick={startChain}
              >
                🔗 連鎖
              </motion.button>
            )}
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

        {phase === 'qte' && (
          <TimingBar onResult={(q) => { pendingQualityRef.current = q; useBattleStore.getState().setPhase('mash') }} />
        )}

        {phase === 'mash' && <MashMeter onDone={onMashDone} />}

        {phase === 'defenseQte' && (
          <TimingBar
            hint="換人中！點擊停在正中可大幅減傷！"
            onResult={(q) => { if (pendingSwitch !== null) runSwitchTurn(pendingSwitch, q) }}
          />
        )}

        {phase === 'chainQte' && chainSeq && (
          <TimingBar
            key={`chain-${chainSeq.step}`} /* 每段重掛 → 指針動畫重置 */
            hint={`🔗 連鎖 ${chainSeq.step + 1}/${chainSeq.participants.length}　${battle.player.members[chainSeq.participants[chainSeq.step]].nameZh}！抓準時機連續出擊`}
            onResult={onChainQteResult}
          />
        )}

        {(phase === 'busy' || phase === 'intro') && (
          <div className="hpbar__num" style={{ height: 46, display: 'grid', placeItems: 'center' }}>…</div>
        )}
      </div>
      </div>
    </motion.div>
  )
}
