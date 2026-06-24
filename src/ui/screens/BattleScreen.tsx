import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import type { BattleMobie, Move, TerrainId } from '@/game/types'
import { getMove } from '@/game/data/moves'
import { lookupRegion } from '@/game/data/regionLookup'
import { resolveBattleTerrains, resolveTerrainMult, terrainDefsOf, TERRAINS, lookupTerrain } from '@/game/data/terrains'
import { makeWildEvents } from '@/game/accidents'
import { usePlayerSkills } from '@/store/playerSkillsStore'
import { learnedPartnerSkills, teamBuffStatuses, type PartnerSkillDef } from '@/game/ext/partnerSkills'
import { TimingBar } from '@/ui/components/TimingBar'
import { MobCard } from '@/ui/components/MobCard'
import { HoldChargeRing, RhythmTap } from '@/ui/components/StarStrikeGestures'
import { interactModeOf } from '@/game/settings'
import { FxCanvas, type FxHandle } from '@/scene/fx/FxCanvas'
import { playMoveFx, resolveFx } from '@/scene/fx/fxCatalog'
import type { StageHandle } from '@/scene/r3f/BattleStage'
import { TYPE_LABEL_ZH, typeColor } from '@/ui/typeMeta'
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
// M19.c 選招逾時（plan/17 §1.1「逾時自動 slot0、不停頓」）：到時自動以出生自帶招（slot0）出擊。
// 自用街機節奏取偏寬鬆值，給玩家讀完 4 招的時間；待玩測再調（plan/17 §9）。
const CHOICE_TIMEOUT_MS = 8000
const ATTACK_QTE_TIMEOUT_MS = 10000
// 連打蓄力視窗：原本 950ms 太短（玩測回饋「給的時間超級少」），放寬到 2.8s 讓連點真的衝得起來。
const MASH_DURATION_MS = 2800
// 鍵盤「四鍵 / 方向」映射 → 招式槽（plan/17 §1.1）。數字 1–4＝讀序（主），方向鍵＝2×2 順時針面鍵：
// ↑左上(0) → →右上(1) → ↓右下(3) → ←左下(2)。按下瞬間即選定並進入 QTE（不做游標導覽）。
const SLOT_KEY_MAP: Record<string, number> = {
  '1': 0, '2': 1, '3': 2, '4': 3,
  ArrowUp: 0, ArrowRight: 1, ArrowDown: 3, ArrowLeft: 2,
}
// M11 地形突變可抽的池（全地形除中性）；wild 戰鬥才注入。
const WILD_SHIFT_POOL = TERRAINS.filter((t) => t.id !== 'neutral').map((t) => t.id)

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

/** 底部常駐隊伍 tray：每隻一顆 HP pip，倒下灰階、在場高亮。點 pip 開該隻資訊卡（M16）。 */
function TeamTray({ members, activeIndex, align, onPick }: {
  members: BattleMobie[]; activeIndex: number; align: 'start' | 'end'; onPick?: (index: number) => void
}) {
  return (
    <div className="tray" style={{ justifyContent: align === 'end' ? 'flex-end' : 'flex-start' }}>
      {members.map((m, i) => {
        const frac = Math.max(0, m.currentHp) / m.maxHp
        const fainted = m.currentHp <= 0
        const tone = hpToneClass(frac, 'tray__fill')
        return (
          <button
            key={i}
            className={`tray__pip ${i === activeIndex ? 'tray__pip--active' : ''} ${fainted ? 'tray__pip--out' : ''}`}
            title={`${m.nameZh}（看資訊卡）`}
            onClick={() => onPick?.(i)}
          >
            <div className={`tray__fill ${tone}`} style={{ width: `${frac * 100}%` }} />
            {fainted && <span className="tray__x">✕</span>}
          </button>
        )
      })}
    </div>
  )
}

/** 緊貼立繪的精簡 HP 牌：名稱 + Lv + 血條（自家顯示數字）。放在角色同側，避免看錯誰的血。點開資訊卡（M16）。 */
function HpPlate({ mon, owner, label, onOpen }: { mon: BattleMobie; owner: boolean; label: string; onOpen?: () => void }) {
  const ratio = Math.max(0, mon.currentHp) / mon.maxHp
  const tone = hpToneClass(ratio, 'hpbar__fill')
  const item = getItem(mon.heldItemId)
  const ability = getAbility(mon.abilityId)
  return (
    <div
      className={`hp-plate ${owner ? 'hp-plate--owner' : 'hp-plate--foe'}`}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      style={{ cursor: 'pointer' }}
    >
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
    }, MASH_DURATION_MS)
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
      <div className="qte__timeout" aria-hidden>
        <div className="qte__timeout-fill" style={{ animationDuration: `${MASH_DURATION_MS}ms` }} />
      </div>
    </div>
  )
}

/**
 * M19.c 四槽「選槽即開打」：點槽（或按 1–4 / 方向鍵）即選定該招並立即進入 QTE，不做巢狀選單，
 * 維持 Mezastar 流暢打擊感。逾時（CHOICE_TIMEOUT_MS）自動以 slot0 出擊、不停頓。
 * 攻擊招走命中 QTE（M19.c）；變化招（power 0，M19.d）目前資料不存在，故一律走命中 QTE。
 * 倒數條走純 CSS animation（不過 React state / rAF，守效能紅線）。
 */
function MoveSlots({ moves, onPick }: { moves: Move[]; onPick: (slot: number) => void }) {
  // 用 ref 鎖「已選定」：避免逾時與玩家輸入競合、或重複觸發兩次出招。
  const pickedRef = useRef(false)
  const pick = useCallback((slot: number) => {
    if (pickedRef.current) return
    if (slot < 0 || slot >= moves.length) return
    pickedRef.current = true
    onPick(slot)
  }, [moves.length, onPick])

  // 逾時自動 slot0（plan/17 §1.1）。
  useEffect(() => {
    pickedRef.current = false
    const t = setTimeout(() => pick(0), CHOICE_TIMEOUT_MS)
    return () => clearTimeout(t)
  }, [pick])

  // 四鍵 / 方向鍵映射（plan/17 §1.1）。只在本面板掛載期間監聽。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const slot = SLOT_KEY_MAP[e.key]
      if (slot === undefined || slot >= moves.length) return
      e.preventDefault()
      pick(slot)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moves.length, pick])

  return (
    <div className="move-choice">
      <div className="move-grid" style={{ gridTemplateColumns: moves.length <= 1 ? '1fr' : 'repeat(2, 1fr)' }}>
        {moves.map((mv, i) => (
          <motion.button
            key={i}
            className={`move-slot ${mv.category === 'status' ? 'move-slot--status' : ''}`}
            style={{ ['--mv' as string]: typeColor(mv.type) }}
            whileTap={{ scale: 0.96 }}
            onClick={() => { audio.play('select'); pick(i) }}
          >
            <span className="move-slot__key">{i + 1}</span>
            <span className="move-slot__name">{mv.nameZh}</span>
            <span className="move-slot__meta">
              <span className="type-badge" style={{ background: typeColor(mv.type) }}>{TYPE_LABEL_ZH[mv.type]}</span>
              <span className="move-slot__cat">{mv.category === 'physical' ? '物理' : mv.category === 'special' ? '特殊' : '變化'}</span>
            </span>
            {mv.category === 'status'
              ? <span className="move-slot__stats">✦ {mv.effect?.label ?? '輔助效果'}</span>
              : <span className="move-slot__stats">威力 {mv.power}　命中 {mv.accuracy}</span>}
          </motion.button>
        ))}
      </div>
      {/* 倒數條（CSS 動畫驅動，純展示；逾時時 pick(0)）。key 重掛＝每進選招重置動畫。 */}
      <div className="move-countdown" aria-hidden>
        <div
          className="move-countdown__bar"
          style={{ animationDuration: `${CHOICE_TIMEOUT_MS}ms` }}
        />
      </div>
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
  const revealedFoes = useBattleStore((s) => s.revealedFoes)
  // M16：戰鬥中點 HpPlate/TeamTray 開資訊卡（自己全顯、對手深度遮罩待 M17 看穿）
  const [cardView, setCardView] = useState<{ mon: BattleMobie; owner: boolean; foeIndex: number } | null>(null)
  // 已啟用模組組成的注入能力包（plan/09 §0）：ext=戰中縫（S3/S4/S5）、prep=戰前縫（S1/S2）。
  // 全關＝EMPTY_EXT/EMPTY_PREP＝零行為改變。
  const ext = useSettings((s) => s.ext)
  const prep = useSettings((s) => s.prep)
  // M22 星擊增強互動 mode（off＝原本單擊即放）。selector 內回純字串＝只在 mode 變動時才 re-render。
  const starMode = useSettings((s) => interactModeOf(s.settings, 'starStrike'))
  // M17 夥伴（訓練師）技能：帳號級、純顯示層。模組關＝行動列不顯示；已習得（起始∪解鎖）才可用。
  const partnerOn = useSettings((s) => s.settings.modules.partnerSkills)
  const learnedSkillIds = usePlayerSkills((s) => s.learnedSkillIds)
  const partnerSkills = useMemo(() => learnedPartnerSkills(learnedSkillIds), [learnedSkillIds])
  // M11 野外意外（wild-only）：戰中地形突變/亂入注入 hook；arena/競技場/連勝塔不注入＝零意外。
  const wildEvents = useMemo(() => {
    if (context.tower) return undefined // 塔戰無野外意外
    const region = context.regionId ? lookupRegion(context.regionId) : null
    return region?.mode === 'wild' ? makeWildEvents({ terrainPool: WILD_SHIFT_POOL }) : undefined
  }, [context.regionId, context.tower])

  const fxRef = useRef<FxHandle>(null)
  const stageRef = useRef<StageHandle>(null)
  const rootShake = useAnimationControls()
  const initedRef = useRef(false)
  // 換人面板選中的隊友索引（等防禦 QTE）
  const [pendingSwitch, setPendingSwitch] = useState<number | null>(null)
  // timing QTE 命中品質暫存，待連打蓄力結束才解算回合
  const pendingQualityRef = useRef<QteQuality>('normal')
  // M19.c 選定的招式槽（選槽→qte→mash 相位間存活）；逾時/缺省＝slot0。
  const pendingSlotRef = useRef(0)
  // 防濫用：剛換下的那隻，下一個換人不能立刻換回（一回合後解鎖）
  const [lockedIndex, setLockedIndex] = useState<number | null>(null)
  // M9 連鎖：連續 QTE 序列（participants=參與隊友索引、step=目前第幾段、hits=已收集宣告）
  const [chainSeq, setChainSeq] = useState<{ participants: number[]; step: number; hits: ChainHit[] } | null>(null)
  // M22 星擊增強互動：開啟蓄力/節奏手勢的暫態（off 模式恆 false、不渲染手勢）
  const [starCharging, setStarCharging] = useState(false)
  // M17 夥伴技能「每場一次」預算：本場已用過的技能 id（display state，不持久化）
  const [partnerUsed, setPartnerUsed] = useState<string[]>([])

  // 初始化：建出雙方 3 隻隊伍，進場
  useEffect(() => {
    if (initedRef.current || context.playerTeam.length === 0 || context.foeTeam.length === 0) return
    initedRef.current = true
    setPartnerUsed([]) // M17：每場一次預算重置
    // 戰前縫：S1 道具/特性 statMod（兩方）+ S2 羈絆（只玩家隊）。全關＝原封不動。
    const { team: players, modifiers } = applyBattlePrep(context.playerTeam.map(buildBattleMobie), prep, true)
    const { team: foes } = applyBattlePrep(context.foeTeam.map(buildBattleMobie), prep, false)
    // 場域地形（M8）：依 region.mode/terrains/randomTerrain 解析；隨機地形以 foe 隊伍 cardId 當 seed
    // 決定論抽（同一場遭遇穩定、不隨 re-render 變動）。arena/無地形＝空＝中性。
    const region = context.regionId ? lookupRegion(context.regionId) : null
    const terrainSeed = context.foeTeam.map((c) => c.cardId).join('|')
    // 連勝塔（M11）視為中性場：無地形（也無野外意外，見 wildEvents memo）
    const terrains = context.tower || !region ? [] : resolveBattleTerrains(region, terrainSeed)
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
        // M19：實際出招由 reducer 寫進 resolvedMoveId（多招式下對手也會用非 slot0 招）；缺省回 slot0。
        const usedMove = e.resolvedMoveId != null ? getMove(e.resolvedMoveId) : atk.move
        const atkPrefix = e.attackerSide === 'foe' ? '對手的 ' : ''
        stageRef.current?.lunge(e.attackerSide) // 3D：出手方撲擊
        store().setBanner(`${atkPrefix}${atk.nameZh} 使出 ${usedMove.nameZh}！`)
        audio.play('attack')
        await wait(440)

        const pos = FX_POS[e.targetSide]
        const recipe = resolveFx(usedMove)
        const strong = e.crit || e.effectiveness >= 2
        let impactDelayMs = 0
        if (!e.missed && e.amount > 0) {
          impactDelayMs = playMoveFx(
            fxRef.current,
            strong ? { ...recipe, count: 24, power: recipe.power * 1.2 } : recipe,
            FX_POS[e.attackerSide],
            pos,
          )
        }
        if (impactDelayMs > 0) await wait(impactDelayMs)

        store().setMemberHp(e.targetSide, e.targetIndex, e.hpAfter)
        store().showHit({
          target: e.targetSide, amount: e.amount,
          crit: e.crit, effText: e.effectivenessText, missed: e.missed,
        })
        // 粒子 / 螢幕震動（不過 React state）
        if (!e.missed && e.amount > 0) {
          if (e.crit) {
            fxRef.current?.burst({ ...pos, color: '#ffd23f', count: 14, power: 1.6, kind: 'spark' })
            fxRef.current?.ring({ ...pos, color: '#ffd23f' })
            fxRef.current?.flash('#ffffff', 0.45)
          } else if (e.effectiveness >= 2) {
            fxRef.current?.ring({ ...pos, color: recipe.accent })
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
      } else if (e.type === 'statusApplied') {
        // M19.d 變化招：「使出 X」+ 依效果類型演出（buff 升箭頭 / heal 回血 / terrain 揭示）。
        const m = monAt(b0, e.side, e.index)
        const mv = getMove(e.moveId)
        const recipe = resolveFx(mv)
        const prefix = e.side === 'foe' ? '對手的 ' : ''
        stageRef.current?.lunge(e.side)
        store().setBanner(`${prefix}${m.nameZh} 使出 ${mv.nameZh}！`)
        audio.play('select')
        await wait(540)
        playMoveFx(fxRef.current, recipe, FX_POS[e.side], FX_POS[e.side])
        if (e.effectKind === 'heal' && e.hpAfter != null) {
          store().setMemberHp(e.side, e.index, e.hpAfter)
          audio.play('super')
          store().setBanner(`✨ ${e.label}　+${e.healAmount} HP`)
        } else if (e.effectKind === 'buff') {
          audio.play('super')
          store().setBanner(`▲ ${e.label}（${e.remaining} 回合）`)
        } else {
          audio.play('super')
          store().setBanner(`🌿 ${e.label}`)
        }
        store().pushLog(`${prefix}${m.nameZh}：${e.label}`)
        await wait(820)
        store().setBanner(null)
        await wait(140)
      } else if (e.type === 'wildAccident') {
        // M11 野外意外演出：地形突變（改場域）/ 亂入野生（非致命削血）。
        if (e.kind === 'terrainShift' && e.terrainId) {
          const def = lookupTerrain(e.terrainId)
          store().setBanner(`🌀 野外意外：地形突變 → ${def ? `${def.icon}${def.name}` : e.terrainId}！`)
          store().pushLog(`地形突變！場域變為 ${def?.name ?? e.terrainId}`)
          fxRef.current?.flash('#a07aff', 0.35)
          fxRef.current?.ring({ nx: 0.5, ny: 0.42, color: '#a07aff' })
          audio.play('super')
          await wait(950)
          store().setBanner(null)
          await wait(140)
        } else if (e.kind === 'intrusion' && e.side != null && e.index != null && e.hpAfter != null) {
          const m = monAt(b0, e.side, e.index)
          const prefix = e.side === 'foe' ? '對手的 ' : ''
          store().setMemberHp(e.side, e.index, e.hpAfter)
          store().showHit({ target: e.side, amount: e.amount ?? 0, crit: false, effText: null, missed: false })
          fxRef.current?.burst({ ...FX_POS[e.side], color: '#ff9a3c', count: 14, kind: 'puff' })
          rootShake.start({ x: [0, -8, 6, 0], transition: { duration: 0.3 } })
          audio.play('hit')
          store().setBanner(`💥 野外意外：亂入野生襲擊 ${prefix}${m.nameZh}！`)
          store().pushLog(`亂入野生襲擊 ${prefix}${m.nameZh}（-${e.amount}）`)
          await wait(820)
          store().clearFx()
          store().setBanner(null)
          await wait(140)
        }
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

    // M19.c：玩家選定的招式槽（缺省/逾時＝slot0）。reducer 用 equippedMoves[slotIndex] 重驗並 resolve。
    const slotIndex = pendingSlotRef.current
    const { nextState, events } = resolveTurn(b0, { type: 'ATTACK', quality, mashCount, slotIndex }, { ext, terrainMultiplier: resolveTerrainMult, wildEvents })
    await playEvents(b0, events)
    store().setBattle(nextState) // snap turn/winner（HP/active 已動畫到位）

    // 星擊能量：依 QTE 表現 + 是否命中（連鎖）累積
    const dealt = events.some((e) => e.type === 'damageApplied' && e.attackerSide === 'player' && !e.missed && e.amount > 0)
    store().addEnergy(energyGain(quality, mashCount), dealt)

    setLockedIndex(null) // 攻擊一回合後解除換回鎖
    if (nextState.winner === 'player') store().setPhase('won')
    else if (nextState.winner === 'foe') store().setPhase('lost')
    else store().setPhase('playerChoice')
  }, [playEvents, ext, wildEvents])

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

    const { nextState, events } = resolveTurn(b0, { type: 'ATTACK', starStrike: true }, { ext, terrainMultiplier: resolveTerrainMult, wildEvents })
    await playEvents(b0, events)
    store().setBattle(nextState)
    store().setBanner(null)
    store().addEnergy(0, false) // 連鎖歸零（星擊消耗）

    if (nextState.winner === 'player') store().setPhase('won')
    else if (nextState.winner === 'foe') store().setPhase('lost')
    else store().setPhase('playerChoice')
  }, [playEvents, rootShake, ext, wildEvents])

  // 主動換人：收回換上 index → 對手打換上的 → 防禦 QTE 抵減
  const runSwitchTurn = useCallback(async (index: number, defenseQuality: QteQuality) => {
    const store = useBattleStore.getState
    const b0 = store().battle
    if (!b0) return
    const fromIndex = b0.player.activeIndex
    setPendingSwitch(null)
    store().setPhase('busy')

    const { nextState, events } = resolveTurn(b0, { type: 'SWITCH', index, defenseQuality }, { ext, terrainMultiplier: resolveTerrainMult, wildEvents })
    await playEvents(b0, events)
    store().setBattle(nextState)

    setLockedIndex(fromIndex) // 剛換下的不能立刻換回
    if (nextState.winner === 'player') store().setPhase('won')
    else if (nextState.winner === 'foe') store().setPhase('lost')
    else store().setPhase('playerChoice')
  }, [playEvents, ext, wildEvents])

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

    const { nextState, events } = resolveTurn(b0, { type: 'SUBMIT_CHAIN_RESULT', hits }, { ext, terrainMultiplier: resolveTerrainMult, wildEvents })
    await playEvents(b0, events)
    store().setBattle(nextState)
    await wait(180)
    store().setCombo(null) // 連段 overlay 收尾

    setLockedIndex(null)
    if (nextState.winner === 'player') store().setPhase('won')
    else if (nextState.winner === 'foe') store().setPhase('lost')
    else store().setPhase('playerChoice')
  }, [playEvents, ext, wildEvents])

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

  // M17 夥伴技能發動（每場一次、純顯示層）：看穿＝設 revealedFoes + 揭露演出；
  // 訓練師加油（support）＝灌注全隊增益到 field.teamStatuses（複用 M19.d，零 reducer 改動）。
  // **不進 reducer、不耗回合、對手不回擊**——維持 playerChoice 相位。
  const activatePartnerSkill = useCallback((skill: PartnerSkillDef) => {
    const store = useBattleStore.getState
    const b = store().battle
    if (!b || partnerUsed.includes(skill.id)) return
    audio.play('select')
    let banner: string | null = null
    if (skill.reveal) {
      const idx = b.foe.activeIndex
      store().revealFoe(idx)
      banner = '🔍 看穿了對手！'
      store().pushLog(`看穿了對手的 ${b.foe.members[idx].nameZh}！招式與數值現形`)
      fxRef.current?.flash('#7ae0ff', 0.3)
      fxRef.current?.ring({ ...FX_POS.foe, color: '#7ae0ff' })
      fxRef.current?.burst({ ...FX_POS.foe, color: '#7ae0ff', count: 14, kind: 'spark' })
    }
    const statuses = teamBuffStatuses(skill)
    if (statuses.length > 0) {
      store().applyTeamStatuses(statuses)
      banner = `${skill.icon} ${skill.name}！`
      store().pushLog(`${skill.name}！全隊氣勢提升（攻擊・特攻 ↑）`)
      fxRef.current?.flash('#ffd23f', 0.3)
      fxRef.current?.ring({ ...FX_POS.player, color: '#ffd23f' })
      fxRef.current?.burst({ ...FX_POS.player, color: '#ffd23f', count: 16, kind: 'spark' })
    }
    setPartnerUsed((prev) => (prev.includes(skill.id) ? prev : [...prev, skill.id]))
    // 仍停在 playerChoice（不耗回合）→ 主動清掉提示 banner，避免一直掛著（若玩家先出手由 playEvents 覆寫，故守 banner 未變才清）。
    if (banner) {
      store().setBanner(banner)
      const shown = banner
      setTimeout(() => { if (store().banner === shown) store().setBanner(null) }, 1500)
    }
  }, [partnerUsed])

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

      {/* ★ 星擊球：能量滿 + 輪到玩家選招時，於戰鬥區中央大特效顯示；點了即放（不放就點技能槽照常）。
          M22 增強互動：off→點擊即放（原樣）；lite/arcade→點擊改開蓄力/節奏手勢，完成才放招。 */}
      <AnimatePresence>
        {energy >= 100 && phase === 'playerChoice' && !starCharging && (
          <motion.button
            className="star-orb"
            initial={{ opacity: 0, scale: 0.4 }}
            animate={{ opacity: 1, scale: [1, 1.08, 1] }}
            exit={{ opacity: 0, scale: 0.4 }}
            transition={{ scale: { duration: 1.2, repeat: Infinity, ease: 'easeInOut' }, opacity: { duration: 0.3 } }}
            whileTap={{ scale: 0.9 }}
            onClick={() => {
              if (starMode === 'off') { audio.play('crit'); void runStarStrike() }
              else { audio.play('select'); setStarCharging(true) }
            }}
          >
            <span className="star-orb__ring" />
            <span className="star-orb__star">★</span>
            <span className="star-orb__label">星擊發動</span>
          </motion.button>
        )}
      </AnimatePresence>

      {/* M22 星擊手勢 overlay（lite 長按蓄力 / arcade 節奏點擊）；off 不渲染＝DOM 零新增 wrapper。
          完成（或逾時）→ 收起手勢 + runStarStrike()（簽名不動、傷害不吃手勢結果）。 */}
      {starCharging && phase === 'playerChoice' && (
        starMode === 'arcade' ? (
          <RhythmTap mode={starMode} onDone={() => { setStarCharging(false); audio.play('crit'); void runStarStrike() }} />
        ) : (
          <HoldChargeRing mode={starMode} onCharged={() => { setStarCharging(false); audio.play('crit'); void runStarStrike() }} />
        )
      )}
      {/* 敵方：HP 牌與隊伍狀態（畫面上方右側） */}
      <div className="row" style={{ justifyContent: 'flex-end' }}>
        <div className="combat-hud combat-hud--foe">
          <HpPlate mon={foe} owner={false} label={`對手的 ${foe.nameZh}`}
            onOpen={() => setCardView({ mon: foe, owner: false, foeIndex: battle.foe.activeIndex })} />
          <TeamTray members={battle.foe.members} activeIndex={battle.foe.activeIndex} align="end"
            onPick={(i) => setCardView({ mon: battle.foe.members[i], owner: false, foeIndex: i })} />
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
          <HpPlate mon={player} owner label={player.nameZh}
            onOpen={() => setCardView({ mon: player, owner: true, foeIndex: -1 })} />
          <TeamTray members={battle.player.members} activeIndex={battle.player.activeIndex} align="start"
            onPick={(i) => setCardView({ mon: battle.player.members[i], owner: true, foeIndex: -1 })} />
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
          <motion.div className="col center" style={{ gap: 12, width: '100%' }}
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            {/* M19.c 四槽選招：選槽即進 QTE（slotIndex 存進 ref 待解算回合用）。星擊/換人/連鎖另列分離。 */}
            {/* M19.d：變化招走輕量強度 QTE（statusQte，無 mash）；攻擊招走命中 QTE→mash。 */}
            <MoveSlots
              moves={player.moves}
              onPick={(slot) => {
                pendingSlotRef.current = slot
                const isStatus = player.moves[slot]?.category === 'status'
                useBattleStore.getState().setPhase(isStatus ? 'statusQte' : 'qte')
              }}
            />
            <div className="row" style={{ gap: 12, justifyContent: 'center' }}>
              <motion.button
                className="btn btn--ghost" style={{ fontSize: 16, padding: '12px 22px' }}
                whileTap={switchable ? { scale: 0.96 } : undefined}
                disabled={!switchable}
                onClick={() => { audio.play('select'); useBattleStore.getState().setPhase('switchSelect') }}
              >
                🔄 換人
              </motion.button>
              {/* 星擊不在此列：能量滿時改在戰鬥區大特效顯示（見下方 StarStrikeOrb），點了即放。 */}
              {chainReady && (
                <motion.button
                  className="btn btn--chain" style={{ fontSize: 16, padding: '12px 22px' }}
                  initial={{ scale: 0.8 }} animate={{ scale: [1, 1.06, 1] }}
                  transition={{ duration: 1.1, repeat: Infinity }}
                  whileTap={{ scale: 0.95 }}
                  onClick={startChain}
                >
                  🔗 連鎖
                </motion.button>
              )}
            </div>
            {/* M17 夥伴（訓練師）技能列：模組開 + 已習得才顯示。每場一次，純顯示層、不耗回合。 */}
            {partnerOn && partnerSkills.length > 0 && (
              <div className="row" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-dim)', fontWeight: 700 }}>✨ 夥伴技能</span>
                {partnerSkills.map((skill) => {
                  const used = partnerUsed.includes(skill.id)
                  return (
                    <motion.button
                      key={skill.id}
                      className="btn btn--ghost btn--sm"
                      whileTap={used ? undefined : { scale: 0.95 }}
                      disabled={used}
                      title={skill.desc}
                      onClick={() => activatePartnerSkill(skill)}
                    >
                      {skill.icon} {skill.name}{used ? ' ✓' : ''}
                    </motion.button>
                  )
                })}
              </div>
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

        {(phase === 'busy' || phase === 'intro') && (
          <div className="hpbar__num" style={{ height: 46, display: 'grid', placeItems: 'center' }}>…</div>
        )}
      </div>

      {/* 計時類輸入（QTE / 連打 / 防禦 / 連鎖）抬到戰鬥區中央：原本擠在最底「看不太到、不好點」，
          改成置中放大的醒目面板，正對玩家視線與拇指。MoveSlots（選招選單）維持在底部不動。 */}
      <div className="battle-action-layer">
      <AnimatePresence>
        {(phase === 'qte' || phase === 'mash' || phase === 'statusQte' || phase === 'defenseQte' || phase === 'chainQte') && (
          <motion.div
            className="battle-action"
            initial={{ opacity: 0, y: 14, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.18 }}
          >
            {phase === 'qte' && (
              <TimingBar
                hint="10秒內點擊任意處，停在正中可造成最大傷害；逾時隨機！"
                timeoutMs={ATTACK_QTE_TIMEOUT_MS}
                randomOnTimeout
                onResult={(q) => { pendingQualityRef.current = q; useBattleStore.getState().setPhase('mash') }}
              />
            )}
            {phase === 'mash' && <MashMeter onDone={onMashDone} />}
            {phase === 'statusQte' && (
              <TimingBar
                hint="變化招！抓準時機強化效果（只影響強度、不影響成敗）"
                onResult={(q) => { void runPlayerTurn(q, 0) }}
              />
            )}
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
          </motion.div>
        )}
      </AnimatePresence>
      </div>
      </div>

      {/* M16 資訊卡：點 HpPlate/TeamTray 開（自己全顯、對手深度遮罩待 M17 看穿） */}
      <AnimatePresence>
        {cardView && (
          <MobCard
            mon={cardView.mon}
            owner={cardView.owner}
            revealed={cardView.owner ? true : revealedFoes.includes(cardView.foeIndex)}
            onClose={() => setCardView(null)}
          />
        )}
      </AnimatePresence>
    </motion.div>
  )
}
