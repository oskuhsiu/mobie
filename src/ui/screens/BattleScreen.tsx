import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
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
import type { BattleMobie, Move, TerrainId, TypeName } from '@/game/types'
import { initiativePresentation, moveDecisionPresentation } from '@/game/battle/decisionPresentation'
import { getMove } from '@/game/data/moves'
import { lookupRegion } from '@/game/data/regionLookup'
import { resolveBattleTerrains, resolveTerrainMult, terrainDefsOf, TERRAINS, lookupTerrain } from '@/game/data/terrains'
import { makeWildEvents } from '@/game/accidents'
import { makeRng } from '@/game/rng'
import { rollEncounterProfile, applyProfileToMon } from '@/game/encounterProfile'
import type { ReplayInput, DisplayUnitSnapshot } from '@/game/replay/types'
import { usePlayerSkills } from '@/store/playerSkillsStore'
import { learnedPartnerSkills, teamBuffStatuses, type PartnerSkillDef } from '@/game/ext/partnerSkills'
import { TimingBar } from '@/ui/components/TimingBar'
import { MobCard } from '@/ui/components/MobCard'
import { DamageNumbers, type DamageNumbersHandle } from '@/ui/components/DamageNumbers'
import { HoldChargeRing, RhythmTap } from '@/ui/components/StarStrikeGestures'
import { ShieldSwipe } from '@/ui/components/BattleGestures'
import { interactModeOf, attackInputVariantOf, juiceLevelOf } from '@/game/settings'
import { haptic, vibrate } from '@/input/haptics'
import { createCinematicCoordinator, type CinematicCoordinator, type CutInSpec } from '@/ui/screens/battleCinematic'
import { rhythmToMashCount } from '@/input/gestures'
import { FxCanvas, type FxHandle } from '@/scene/fx/FxCanvas'
import { WeatherCanvas } from '@/scene/fx/WeatherCanvas'
import { playMoveFx, resolveFx, typePalette } from '@/scene/fx/fxCatalog'
import type { StageHandle } from '@/scene/r3f/BattleStage'
import { resolveTerrainPalette } from '@/scene/r3f/terrainVisual'
import { TYPE_LABEL_ZH, typeColor } from '@/ui/typeMeta'
import { getItem } from '@/game/ext/items'
import { getAbility } from '@/game/ext/abilities'
import { audio } from '@/audio/audioEngine'
import type { M23Checkpoint, M23PresentationTraceStage } from '@/dev/m23/contracts'
import { BattleDirector } from '@/presentation/battle/BattleDirector'
import { BattleTurnCoordinator } from '@/presentation/battle/BattleTurnCoordinator'
import { LegacyBattleCueHandler, type BattleCuePorts } from '@/presentation/battle/cueHandlers'
import { battleActionFromReplayInput } from '@/presentation/battle/turnInput'
import type {
  CueContext,
  PresentationToken,
  TurnCommitMeta,
  TurnResolution,
} from '@/presentation/battle/contracts'

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
const ATTACK_QTE_TIMEOUT_MS = 10000
// 連打蓄力視窗：原本 950ms 太短（玩測回饋「給的時間超級少」），放寬到 2.8s 讓連點真的衝得起來。
const MASH_DURATION_MS = 2800
// EXT.1.c hit-stop（presentation clock pause，不改 reducer 時間線）：命中瞬間凍結演出推進的毫秒數。
// 只在 juice='full' 生效；會心/效果絕佳給更長的「頓」讓重擊更有份量。
const HITSTOP_HIT_MS = 40
const HITSTOP_STRONG_MS = 120
// 鍵盤「四鍵 / 方向」映射 → 招式槽（plan/17 §1.1）。數字 1–4＝讀序（主），方向鍵＝2×2 順時針面鍵：
// ↑左上(0) → →右上(1) → ↓右下(3) → ←左下(2)。按下瞬間即選定並進入 QTE（不做游標導覽）。
const SLOT_KEY_MAP: Record<string, number> = {
  '1': 0, '2': 1, '3': 2, '4': 3,
  ArrowUp: 0, ArrowRight: 1, ArrowDown: 3, ArrowLeft: 2,
}
// M11 地形突變可抽的池（全地形除中性）；wild 戰鬥才注入。
const WILD_SHIFT_POOL = TERRAINS.filter((t) => t.id !== 'neutral').map((t) => t.id)

function baselineDriver() {
  return import.meta.env.DEV ? window.__MOBIE_M23_BASELINE__ : undefined
}

function controlledQuality(actual: QteQuality): QteQuality {
  return baselineDriver()?.takeQteQuality(actual) ?? actual
}

function tracePresentation(
  token: PresentationToken,
  stage: M23PresentationTraceStage,
  detail: { cueId?: string; detail?: string; turn?: number } = {},
): void {
  baselineDriver()?.recordPresentationEvent({
    transactionId: `${token.battleSessionId}:${token.resultFingerprint}:${token.presentationId}`,
    presentationId: token.presentationId,
    stage,
    ...detail,
  })
}

function inputKind(input: ReplayInput, before: BattleState): 'attack' | 'status' | 'switch' | 'chain' | 'star' {
  if (input.type === 'SWITCH') return 'switch'
  if (input.type === 'CHAIN') return 'chain'
  if (input.starStrike) return 'star'
  const actor = before.player.members[before.player.activeIndex]
  return (actor.moves[input.slotIndex ?? 0] ?? actor.move).category === 'status' ? 'status' : 'attack'
}

function turnCommitMeta(before: BattleState, input: ReplayInput, events: readonly BattleEvent[]): TurnCommitMeta {
  const ended = events.find((event): event is Extract<BattleEvent, { type: 'battleEnded' }> => event.type === 'battleEnded')
  const outcome = ended ? {
    winner: ended.winner,
    outcome: ended.winner === 'player' ? 'win' as const : 'lose' as const,
    ...(ended.reason ? { reason: ended.reason } : {}),
  } : null
  switch (input.type) {
    case 'ATTACK': {
      if (input.starStrike) {
        return { energy: { kind: 'reset' }, lockedIndex: 'unchanged', combo: 'unchanged', outcome }
      }
      const dealtDamage = events.some((event) => event.type === 'damageApplied'
        && event.attackerSide === 'player' && !event.missed && event.amount > 0)
      return {
        energy: {
          kind: 'gain',
          delta: energyGain(input.quality ?? 'normal', input.mashCount ?? 0),
          dealtDamage,
        },
        lockedIndex: null,
        combo: 'unchanged',
        outcome,
      }
    }
    case 'SWITCH':
      return {
        energy: { kind: 'unchanged' },
        lockedIndex: before.player.activeIndex,
        combo: 'unchanged',
        outcome,
      }
    case 'CHAIN':
      return {
        energy: { kind: 'unchanged' },
        lockedIndex: null,
        combo: null,
        outcome,
      }
  }
}

function checkpointForEvent(event: BattleEvent): M23Checkpoint | undefined {
  switch (event.type) {
    case 'damageApplied': return 'normal-attack'
    case 'wildAccident': return event.kind === 'terrainShift' ? 'terrain' : undefined
    case 'statusApplied': return event.effectKind === 'terrain' ? 'terrain' : undefined
    case 'activeChanged': return 'switch'
    case 'memberFainted': return 'faint'
    case 'battleEnded': return 'outcome'
    default: return undefined
  }
}

// M14.c：把一方 BattleMobie[] 轉成回放用的 DisplayUnitSnapshot[]（只取畫面/FX 分派要的穩定欄位）。
function teamSnapshot(side: Side, members: BattleMobie[]): DisplayUnitSnapshot[] {
  return members.map((m, slot) => ({
    instanceId: `${side}:${slot}`,
    side,
    slot,
    speciesId: m.speciesId,
    displayName: m.nameZh,
    level: m.level,
    maxHp: m.maxHp,
    initialHp: m.currentHp,
    shiny: m.shiny,
    ...(m.heldItemId ? { heldItemId: m.heldItemId } : {}),
    ...(m.abilityId ? { abilityId: m.abilityId } : {}),
  }))
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

/** 連打蓄力：限時內瘋狂點擊累積色階加成（計數走 ref，不過 React state）。
 *  點擊範圍放大成戰鬥中心一整圈（橘色 blur 光暈），每次點擊噴漣漪 + 整圈 thump 強回饋。 */
function MashMeter({ onDone }: { onDone: (count: number) => void }) {
  const countRef = useRef(0)
  const barRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef(false)
  const fieldRef = useRef<HTMLDivElement>(null)
  const ripRef = useRef<HTMLDivElement>(null)
  const ripIdxRef = useRef(0)

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

  const tap = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (doneRef.current) return
    const c = (countRef.current += 1)
    const tier = chargeTier(c)
    if (barRef.current) {
      barRef.current.style.width = `${Math.min(100, (c / 24) * 100)}%`
      barRef.current.style.background = tier.color
    }
    if (labelRef.current) labelRef.current.textContent = tier.label || '蓄力中…'
    // 強回饋（全走 DOM class 重觸發，不過 React state）：點處噴漣漪 + 整圈瞬縮 thump。
    const field = fieldRef.current
    const pool = ripRef.current
    if (field && pool) {
      const rect = field.getBoundingClientRect()
      const r = pool.children[ripIdxRef.current++ % pool.children.length] as HTMLDivElement | undefined
      if (r) {
        r.style.left = `${e.clientX - rect.left}px`
        r.style.top = `${e.clientY - rect.top}px`
        r.classList.remove('is-on'); void r.offsetWidth; r.classList.add('is-on')
      }
      field.classList.remove('is-hit'); void field.offsetWidth; field.classList.add('is-hit')
    }
  }

  return (
    <div ref={fieldRef} className="tap-field tap-field--charge" onPointerDown={tap} role="button" tabIndex={0}>
      <div className="tap-field__glow" aria-hidden />
      <div className="tap-field__ripples" ref={ripRef} aria-hidden>
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="tap-field__ripple" />)}
      </div>
      <div className="tap-field__inner mash">
        <div className="mash__hint">連打蓄力！瘋狂點擊衝高傷害</div>
        <div className="mash__track"><div ref={barRef} className="mash__fill" style={{ width: '0%' }} /></div>
        <div ref={labelRef} className="mash__tier">蓄力中…</div>
        <div className="qte__timeout" aria-hidden>
          <div className="qte__timeout-fill" style={{ animationDuration: `${MASH_DURATION_MS}ms` }} />
        </div>
      </div>
    </div>
  )
}

/**
 * M19.c 四槽「選槽即開打」：點槽（或按 1–4 / 方向鍵）即選定該招並立即進入 QTE，不做巢狀選單，
 * 維持 Mezastar 流暢打擊感。選招階段會持續等待玩家明確選擇。
 * 攻擊招走命中 QTE（M19.c）；變化招（power 0，M19.d）目前資料不存在，故一律走命中 QTE。
 */
export interface MoveSlotsProps {
  moves: Move[]
  defenderTypes: TypeName[]
  playerSpeed: number
  foeSpeed: number
  onPick: (slot: number) => void
}

export function MoveSlots({ moves, defenderTypes, playerSpeed, foeSpeed, onPick }: MoveSlotsProps) {
  // 用 ref 鎖「已選定」：避免點擊與鍵盤輸入競合、或重複觸發兩次出招。
  const pickedRef = useRef(false)
  const pick = useCallback((slot: number) => {
    if (pickedRef.current) return
    if (slot < 0 || slot >= moves.length) return
    pickedRef.current = true
    onPick(slot)
  }, [moves.length, onPick])

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
      <div className="move-initiative">{initiativePresentation(playerSpeed, foeSpeed)}</div>
      <div className="move-grid" style={{ gridTemplateColumns: moves.length <= 1 ? '1fr' : 'repeat(2, 1fr)' }}>
        {moves.map((mv, i) => {
          const decision = moveDecisionPresentation(mv, defenderTypes)
          return (
            <motion.button
              key={i}
              className={`move-slot ${mv.category === 'status' ? 'move-slot--status' : ''}`}
              style={{ ['--mv' as string]: typeColor(mv.type) }}
              whileTap={{ scale: 0.96 }}
              aria-label={`${mv.nameZh}，${decision.label}`}
              onClick={() => { audio.play('select'); pick(i) }}
            >
              <span className="move-slot__key">{i + 1}</span>
              <span className="move-slot__name">{mv.nameZh}</span>
              <span className="move-slot__meta">
                <span className="type-badge" style={{ background: typeColor(mv.type) }}>{TYPE_LABEL_ZH[mv.type]}</span>
                <span className="move-slot__cat">{mv.category === 'physical' ? '物理' : mv.category === 'special' ? '特殊' : '變化'}</span>
              </span>
              <span className="move-slot__effectiveness">{decision.label}</span>
              {mv.category === 'status'
                ? null
                : <span className="move-slot__stats">威力 {mv.power}　命中 {mv.accuracy}</span>}
            </motion.button>
          )
        })}
      </div>
    </div>
  )
}

export function SwitchAction({ switchable, onPick }: { switchable: boolean; onPick: () => void }) {
  return (
    <div className="switch-action">
      <motion.button
        className="btn btn--ghost"
        style={{ fontSize: 16, padding: '12px 22px' }}
        whileTap={switchable ? { scale: 0.96 } : undefined}
        disabled={!switchable}
        aria-label="換人"
        aria-describedby="switch-action-cost"
        onClick={() => { audio.play('select'); onPick() }}
      >
        🔄 換人
      </motion.button>
      <div id="switch-action-cost" className="switch-action__cost">
        放棄本回合攻擊並承受對手攻擊
      </div>
    </div>
  )
}

export function BattleScreen() {
  const { context, send } = useGame()
  const battle = useBattleStore((s) => s.presentation?.battle ?? s.battle)
  const phase = useBattleStore((s) => s.phase)
  const banner = useBattleStore((s) => s.presentation ? s.presentation.banner : s.banner)
  const hitFx = useBattleStore((s) => s.presentation ? s.presentation.hitFx : s.hitFx)
  const support = useBattleStore((s) => s.presentation ? s.presentation.support : s.support)
  const energy = useBattleStore((s) => s.presentation ? s.presentation.energy : s.energy)
  const combo = useBattleStore((s) => s.presentation ? s.presentation.combo : s.combo)
  const log = useBattleStore((s) => s.presentation ? s.presentation.log : s.log)
  const lockedIndex = useBattleStore((s) => s.presentation ? s.presentation.lockedIndex : s.lockedIndex)
  const revealedFoes = useBattleStore((s) => s.revealedFoes)
  // M16：戰鬥中點 HpPlate/TeamTray 開資訊卡（自己全顯、對手深度遮罩待 M17 看穿）
  const [cardView, setCardView] = useState<{ mon: BattleMobie; owner: boolean; foeIndex: number } | null>(null)
  // 已啟用模組組成的注入能力包（plan/09 §0）：ext=戰中縫（S3/S4/S5）、prep=戰前縫（S1/S2）。
  // 全關＝EMPTY_EXT/EMPTY_PREP＝零行為改變。
  const ext = useSettings((s) => s.ext)
  const prep = useSettings((s) => s.prep)
  // M22 星擊增強互動 mode（off＝原本單擊即放）。selector 內回純字串＝只在 mode 變動時才 re-render。
  const starMode = useSettings((s) => interactModeOf(s.settings, 'starStrike'))
  // M22.f 換人防禦下滑護盾（off＝原 TimingBar）；M22.g 攻擊節奏變體（mash＝原連打）。
  const defenseMode = useSettings((s) => interactModeOf(s.settings, 'defense'))
  const attackVariant = useSettings((s) => attackInputVariantOf(s.settings))
  const interactMode = useSettings((s) => s.settings.prefs.enhancedInteractivity.mode)
  // EXT.1 打擊感強度（純字串 selector，只在變動時 re-render）：off＝回退 M22 純 flash+shake / FloatDamage。
  const juice = useSettings((s) => juiceLevelOf(s.settings))
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
  const extRef = useRef(ext)
  const wildEventsRef = useRef(wildEvents)
  extRef.current = ext
  wildEventsRef.current = wildEvents

  // EXT.3：當前地形 → 視覺 palette（地板色調/環境光/霧/天氣 emitter）。純 display。
  // 隨 terrainShift 更新（current 陣列換新參照即重算）；全空/neutral → 基線 palette。
  const terrainPalette = useMemo(
    () => resolveTerrainPalette(battle?.field.terrainEffects.current ?? []),
    [battle?.field.terrainEffects.current],
  )
  // 天氣粒子密度（juice 分級）：full=100% / reduced≈30% / off=0（整層不掛＝嚴格回 M22 基線）。
  const weatherDensity = juice === 'full' ? 1 : juice === 'reduced' ? 0.3 : 0

  const fxRef = useRef<FxHandle>(null)
  const damageRef = useRef<DamageNumbersHandle>(null)
  const stageRef = useRef<StageHandle>(null)
  const rootShake = useAnimationControls()
  // EXT.1：juice 走 ref 供 presentation ports 讀最新值，不重建整條 director。
  const juiceRef = useRef(juice)
  juiceRef.current = juice
  // EXT.2 星擊電影化 display state（低頻：每場星擊一次，走一般 state 不違反效能紅線）。
  const [cutIn, setCutIn] = useState<CutInSpec | null>(null)
  const [letterbox, setLetterbox] = useState(false)
  // EXT.1 §6 / EXT.2 演出協調器（hit-stop + 星擊三拍 cut-in 共用）。hooks 全參照穩定身分（setState/ref/
  // module 單例），建一次即可。慢鏡接到 R3F 舞台 timeScale；蓄力/衝擊的 FX 走 fxRef/audio/rootShake（real-time）。
  const cinematicRef = useRef<CinematicCoordinator | null>(null)
  if (!cinematicRef.current) {
    cinematicRef.current = createCinematicCoordinator({
      setCutIn,
      setLetterbox,
      setTimeScale: (scale) => stageRef.current?.setTimeScale(scale),
      onCharge: (spec) => {
        const pal = typePalette[spec.type]
        fxRef.current?.converge({ nx: 0.5, ny: 0.5, color: pal.color, count: 40, shape: pal.shape })
        audio.starChargeSweep()
      },
      onStamp: () => audio.starStampTick(),
      onImpact: (spec) => {
        const pal = typePalette[spec.type]
        fxRef.current?.flash('#ffffff', 0.9)
        fxRef.current?.shockwave({ nx: 0.5, ny: 0.5, color: pal.color }) // 外層大環
        fxRef.current?.shockwave({ nx: 0.5, ny: 0.5, color: pal.accent, lw: 5 }) // 內層細環
        fxRef.current?.burst({ nx: 0.5, ny: 0.5, color: pal.color, count: 44, power: 2.2, kind: 'spark', shape: pal.shape })
        rootShake.start({ x: [0, -24, 20, -16, 10, 0], scale: [1, 1.05, 1], transition: { duration: 0.55 } }) // 震動×1.5 + 相機急推
        audio.starImpactBoom()
        haptic('crit')
      },
    })
  }
  const initedRef = useRef(false)
  const turnCoordinatorRef = useRef<BattleTurnCoordinator | null>(null)
  // 換人面板選中的隊友索引（等防禦 QTE）
  const [pendingSwitch, setPendingSwitch] = useState<number | null>(null)
  // timing QTE 命中品質暫存，待連打蓄力結束才解算回合
  const pendingQualityRef = useRef<QteQuality>('normal')
  // M19.c 選定的招式槽（選槽→qte→mash 相位間存活）；玩家明確選擇前不會進入 QTE。
  const pendingSlotRef = useRef(0)
  // M9 連鎖：連續 QTE 序列（participants=參與隊友索引、step=目前第幾段、hits=已收集宣告）
  const [chainSeq, setChainSeq] = useState<{ participants: number[]; step: number; hits: ChainHit[] } | null>(null)
  // M22 星擊增強互動：開啟蓄力/節奏手勢的暫態（off 模式恆 false、不渲染手勢）
  const [starCharging, setStarCharging] = useState(false)
  // M17 夥伴技能「每場一次」預算：本場已用過的技能 id（display state，不持久化）
  const [partnerUsed, setPartnerUsed] = useState<string[]>([])
  // EXT.1.f C2 脈衝引導：選招處「👇 選一個招式」提示。首玩（localStorage 旗標未設）或閒置 N 秒才顯示，
  // 玩家一出手即記旗標並收起；純 display、可由 juice='off' 關閉、不碰 reducer。
  const [showChoiceGuide, setShowChoiceGuide] = useState(false)
  const guideSeenRef = useRef(typeof localStorage !== 'undefined' && localStorage.getItem('mz.guide.choiceSeen') === '1')

  // 初始化：建出雙方 3 隻隊伍，進場
  useEffect(() => {
    if (initedRef.current || context.playerTeam.length === 0 || context.foeTeam.length === 0) return
    initedRef.current = true
    // 戰前縫：S1 道具/特性 statMod（兩方）+ S2 羈絆（只玩家隊）。全關＝原封不動。
    const { team: players, modifiers } = applyBattlePrep(context.playerTeam.map(buildBattleMobie), prep, true)
    const prepped = applyBattlePrep(context.foeTeam.map(buildBattleMobie), prep, false)
    // M12.e 對手技能標籤（display 層 prep，只動對手隊）：依物種決定論指派 0–2 標籤 + 反射被動微調。
    // 模組關＝不指派＝零殘留。末位視為 boss（較可能宣告合擊）。
    const foes = useSettings.getState().settings.modules.encounterSkills
      ? prepped.team.map((m, i) => applyProfileToMon(m, rollEncounterProfile(m.speciesId, i === prepped.team.length - 1)))
      : prepped.team
    // 場域地形（M8）：依 region.mode/terrains/randomTerrain 解析；隨機地形以 foe 隊伍 cardId 當 seed
    // 決定論抽（同一場遭遇穩定、不隨 re-render 變動）。arena/無地形＝空＝中性。
    const region = context.regionId ? lookupRegion(context.regionId) : null
    const terrainSeed = context.foeTeam.map((c) => c.cardId).join('|')
    // M14.0：本場 rng 種子＝雙方 cardId + 開戰時刻（每場唯一、可寫入回放 header 供重模擬）。
    const createdAt = Date.now()
    const battleSeed = baselineDriver()?.options.seed
      ?? `${context.playerTeam.map((c) => c.cardId).join('|')}#${terrainSeed}#${createdAt}`
    // 連勝塔（M11）視為中性場：無地形（也無野外意外，見 wildEvents memo）
    const terrains = context.tower || !region ? [] : resolveBattleTerrains(region, terrainSeed)
    const terrainDefs = terrainDefsOf(terrains)
    const s = useBattleStore.getState()
    const ensured = s.ensureBattleSession({
      logicalBattleKey: context,
      playerMembers: players,
      foeMembers: foes,
      terrains,
      battleSeed,
      regionId: context.regionId ?? (context.tower ? 'tower' : ''),
      mode: region?.mode === 'wild' ? 'wild' : 'arena',
      recordReplay: useSettings.getState().settings.prefs.recordReplays,
      snapshot: [...teamSnapshot('player', players), ...teamSnapshot('foe', foes)],
      createdAt,
    })
    if (!ensured.created) return
    setPartnerUsed([]) // M17：每場一次預算只在 logical init 重置
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
      await baselineDriver()?.checkpoint('phase:player-choice', 'player-choice')
      s.setPhase('playerChoice')
    })()
  }, [context, prep])

  useEffect(() => () => {
    turnCoordinatorRef.current?.cancel('unmount')
  }, [])

  useEffect(() => {
    baselineDriver()?.setActivity(
      phase === 'qte'
      || phase === 'mash'
      || phase === 'statusQte'
      || phase === 'defenseQte'
      || phase === 'chainQte'
      || phase === 'busy',
    )
  }, [phase])

  // 低血量緊張度 → BGM 濾波/警報（依我方在場 HP）
  useEffect(() => {
    if (!battle) return
    const a = battle.player.members[battle.player.activeIndex]
    if (a && a.maxHp > 0) audio.setIntensity(1 - Math.max(0, a.currentHp) / a.maxHp)
  }, [battle])

  // EXT.1.f C2：選招相位的脈衝引導。首玩立即顯示、否則閒置 6 秒才顯示；離開相位即收。juice='off' 不引導。
  useEffect(() => {
    if (juice === 'off' || phase !== 'playerChoice') { setShowChoiceGuide(false); return }
    if (!guideSeenRef.current) { setShowChoiceGuide(true); return } // 首玩：立即提示
    const t = setTimeout(() => setShowChoiceGuide(true), 6000) // 老玩家：閒置才提示，不打擾
    return () => clearTimeout(t)
  }, [phase, juice])

  const playLegacyEvent = useCallback(async (
    b0: BattleState,
    e: BattleEvent,
    cueContext: CueContext,
  ) => {
    const store = useBattleStore.getState
    const delay = (ms: number) => cueContext.clock.wait(ms, cueContext.signal)
    const setMemberHp = (side: Side, index: number, hp: number) =>
      store().presentationSetMemberHp(cueContext.token, side, index, hp)
    const setActiveIndex = (side: Side, index: number) =>
      store().presentationSetActiveIndex(cueContext.token, side, index)
    const setBanner = (value: string | null) => store().presentationSetBanner(cueContext.token, value)
    const pushLog = (message: string) => store().presentationPushLog(cueContext.token, message)
    const showHit = (fx: Omit<HitFx, 'id'>) => store().presentationShowHit(cueContext.token, fx)
    const clearFx = () => store().presentationClearTransient(cueContext.token)
    const setSupport = (value: SupportOutcome | null) => store().presentationSetSupport(cueContext.token, value)
    const setCombo = (value: number | null) => store().presentationSetCombo(cueContext.token, value)

    if (e.type === 'damageApplied') throw new Error('damageApplied must use the semantic attack cue handler')
    if (e.type === 'memberFainted') {
      const m = monAt(b0, e.side, e.index)
      const prefix = e.side === 'foe' ? '對手的 ' : ''
      stageRef.current?.faint(e.side)
      fxRef.current?.burst({ ...FX_POS[e.side], color: '#8893a8', count: 18, kind: 'puff' })
      audio.play('faint')
      haptic('faint')
      pushLog(`${prefix}${m.nameZh} 倒下了！`)
      await delay(620)
    } else if (e.type === 'heal') {
      const m = monAt(b0, e.side, e.index)
      const src = getItem(e.source) ?? getAbility(e.source)
      setMemberHp(e.side, e.index, e.hpAfter)
      fxRef.current?.burst({ ...FX_POS[e.side], color: '#4ade80', count: 12, power: 1, kind: 'spark' })
      audio.play('select')
      const prefix = e.side === 'foe' ? '對手的 ' : ''
      setBanner(`${src?.icon ?? '✨'} ${prefix}${m.nameZh} 回復了 ${e.amount} HP`)
      pushLog(`${prefix}${m.nameZh} 回復 ${e.amount} HP（${src?.name ?? e.source}）`)
      await delay(720)
      setBanner(null)
      await delay(120)
    } else if (e.type === 'statusApplied') {
      const m = monAt(b0, e.side, e.index)
      const mv = m.moves.find((move) => move.id === e.moveId)
        ?? (m.move.id === e.moveId ? m.move : getMove(e.moveId))
      const recipe = resolveFx(mv)
      const prefix = e.side === 'foe' ? '對手的 ' : ''
      stageRef.current?.lunge(e.side)
      setBanner(`${prefix}${m.nameZh} 使出 ${mv.nameZh}！`)
      audio.play('select')
      await delay(540)
      playMoveFx(fxRef.current, recipe, FX_POS[e.side], FX_POS[e.side])
      audio.playMoveSound(recipe.sound)
      if (e.effectKind === 'heal' && e.hpAfter != null) {
        setMemberHp(e.side, e.index, e.hpAfter)
        audio.play('super')
        setBanner(`✨ ${e.label}　+${e.healAmount} HP`)
      } else if (e.effectKind === 'buff') {
        audio.play('super')
        setBanner(`▲ ${e.label}（${e.remaining} 回合）`)
      } else {
        audio.play('super')
        setBanner(`🌿 ${e.label}`)
      }
      pushLog(`${prefix}${m.nameZh}：${e.label}`)
      await delay(820)
      setBanner(null)
      await delay(140)
    } else if (e.type === 'wildAccident') {
      if (e.kind === 'terrainShift' && e.terrainId) {
        const def = lookupTerrain(e.terrainId)
        setBanner(`🌀 野外意外：地形突變 → ${def ? `${def.icon}${def.name}` : e.terrainId}！`)
        pushLog(`地形突變！場域變為 ${def?.name ?? e.terrainId}`)
        const shiftColor = juiceRef.current === 'off' ? '#a07aff' : resolveTerrainPalette([e.terrainId]).particleColor
        fxRef.current?.flash(shiftColor, 0.35)
        fxRef.current?.ring({ nx: 0.5, ny: 0.42, color: shiftColor })
        audio.play('super')
        await delay(950)
        setBanner(null)
        await delay(140)
      } else if (e.kind === 'intrusion' && e.side != null && e.index != null && e.hpAfter != null) {
        const m = monAt(b0, e.side, e.index)
        const prefix = e.side === 'foe' ? '對手的 ' : ''
        setMemberHp(e.side, e.index, e.hpAfter)
        showHit({ target: e.side, amount: e.amount ?? 0, crit: false, effText: null, missed: false })
        if (juiceRef.current !== 'off') {
          damageRef.current?.spawn({ ...FX_POS[e.side], amount: e.amount ?? 0, crit: false, effectiveness: 1, missed: false })
        }
        fxRef.current?.burst({ ...FX_POS[e.side], color: '#ff9a3c', count: 14, kind: 'puff' })
        void rootShake.start({ x: [0, -8, 6, 0], transition: { duration: 0.3 } })
        audio.play('hit')
        haptic('hit')
        setBanner(`💥 野外意外：亂入野生襲擊 ${prefix}${m.nameZh}！`)
        pushLog(`亂入野生襲擊 ${prefix}${m.nameZh}（-${e.amount}）`)
        await delay(820)
        clearFx()
        setBanner(null)
        await delay(140)
      }
    } else if (e.type === 'activeChanged') {
      setActiveIndex(e.side, e.toIndex)
      stageRef.current?.enter(e.side)
      const m = monAt(b0, e.side, e.toIndex)
      fxRef.current?.ring({ ...FX_POS[e.side], color: '#ffffff' })
      if (e.side === 'player') fxRef.current?.flash('#ffffff', 0.3)
      audio.play('switch')
      setBanner(e.side === 'player' ? `上吧，${m.nameZh}！` : `對手派出了 ${m.nameZh}！`)
      await delay(640)
      setBanner(null)
      await delay(120)
    } else if (e.type === 'switchDefenseResolved') {
      const pct = Math.round((1 - e.damageMult) * 100)
      const label = e.defenseQuality === 'perfect' ? '完美防禦！'
        : e.defenseQuality === 'good' ? '防禦成功！'
          : e.defenseQuality === 'normal' ? '勉強防禦' : '防禦失敗…'
      setBanner(pct > 0 ? `${label}　減傷 ${pct}%` : label)
      pushLog(`${label}（減傷 ${pct}%）`)
      await delay(640)
      setBanner(null)
      await delay(110)
    } else if (e.type === 'random' && e.event.type === 'supportRoulette') {
      const outcome = e.event.outcome as SupportOutcome
      setSupport(outcome)
      audio.play('select')
      await delay(950)
      audio.play(outcome === 'dud' ? 'select' : 'super')
      pushLog(`支援輪盤：${SUPPORT_LABEL[outcome]}`)
      await delay(800)
      setSupport(null)
      await delay(150)
    } else if (e.type === 'battleEnded' && e.reason === 'timeout') {
      setBanner('達回合上限！依剩餘血量判定勝負')
      pushLog('回合數達上限，依雙方剩餘血量判定勝負')
      await delay(1150)
      setBanner(null)
      await delay(150)
    } else if (e.type === 'chainOpportunity') {
      setBanner('🔗 連鎖就緒！')
      pushLog('連鎖槽集滿！可發動連鎖攻擊')
      audio.play('super')
      fxRef.current?.flash('#7ae0ff', 0.3)
      await delay(680)
      setBanner(null)
      await delay(120)
    } else if (e.type === 'chainHit') {
      setCombo(e.comboCount)
      fxRef.current?.burst({ ...FX_POS.foe, color: '#7ae0ff', count: 12, power: 1.2, kind: 'spark' })
      audio.play('select')
      await delay(180)
    } else if (e.type === 'comboCast') {
      setBanner(`${e.icon} 合體技「${e.name}」！`)
      const eff = e.castKind === 'infuseTerrain' ? '灌注場域' : e.castKind === 'teamBuff' ? '全隊增益' : '弱化敵方'
      pushLog(`${e.icon} 合體技「${e.name}」發動：${eff}（${e.remaining} 回合）`)
      audio.play('crit')
      fxRef.current?.flash('#ffe14a', 0.6)
      fxRef.current?.ring({ ...FX_POS.player, color: '#ffe14a' })
      fxRef.current?.burst({ ...FX_POS.foe, color: '#ff7ae0', count: 30, power: 1.8, kind: 'spark' })
      void rootShake.start({ x: [0, -16, 14, -10, 0], transition: { duration: 0.42 } })
      await delay(760)
      setBanner(null)
      await delay(140)
    }
  }, [rootShake])

  const createCuePorts = useCallback((): BattleCuePorts => ({
    scene: {
      begin: (cue) => { stageRef.current?.lunge(cue.attackerSide) },
      impact: async (cue, cueContext) => {
        const e = cue.event
        if (e.missed || e.amount <= 0) return
        baselineDriver()?.recordCastImpact(performance.now())
        const recipe = resolveFx(cue.move)
        const strong = e.crit || e.effectiveness >= 2
        const impactDelayMs = playMoveFx(
          fxRef.current,
          strong ? { ...recipe, count: 24, power: recipe.power * 1.2 } : recipe,
          FX_POS[e.attackerSide],
          FX_POS[e.targetSide],
        )
        if (impactDelayMs > 0) await cueContext.clock.wait(impactDelayMs, cueContext.signal)
      },
      reaction: (cue) => {
        const e = cue.event
        if (e.missed || e.amount <= 0) return
        const pos = FX_POS[e.targetSide]
        const recipe = resolveFx(cue.move)
        const strong = e.crit || e.effectiveness >= 2
        if (e.crit) {
          fxRef.current?.burst({ ...pos, color: '#ffd23f', count: 14, power: 1.6, kind: 'spark' })
          fxRef.current?.ring({ ...pos, color: '#ffd23f' })
          fxRef.current?.flash('#ffffff', 0.45)
        } else if (e.effectiveness >= 2) {
          fxRef.current?.ring({ ...pos, color: recipe.accent })
        }
        const mag = e.crit ? 16 : e.effectiveness >= 2 ? 11 : 6
        void rootShake.start({ x: [0, -mag, mag * 0.8, -mag * 0.5, 0], transition: { duration: 0.34 } })
        stageRef.current?.hitReact(e.targetSide, strong ? 1.6 : 1)
      },
      hitStop: (cue) => {
        const e = cue.event
        if (e.missed || e.amount <= 0 || juiceRef.current !== 'full') return
        return cinematicRef.current!.pause(e.crit || e.effectiveness >= 2 ? HITSTOP_STRONG_MS : HITSTOP_HIT_MS)
      },
      clear: () => undefined,
    },
    hud: {
      showMove: (cue, cueContext) => {
        const prefix = cue.attackerSide === 'foe' ? '對手的 ' : ''
        useBattleStore.getState().presentationSetBanner(
          cueContext.token,
          `${prefix}${cue.attacker.nameZh} 使出 ${cue.move.nameZh}！`,
        )
      },
      applyDamage: (cue, cueContext) => {
        const e = cue.event
        const store = useBattleStore.getState()
        store.presentationSetMemberHp(cueContext.token, e.targetSide, e.targetIndex, e.hpAfter)
        store.presentationShowHit(cueContext.token, {
          target: e.targetSide, amount: e.amount, crit: e.crit,
          effText: e.effectivenessText, missed: e.missed,
        })
        if (juiceRef.current !== 'off') {
          damageRef.current?.spawn({
            ...FX_POS[e.targetSide], amount: e.amount, crit: e.crit,
            effectiveness: e.effectiveness, missed: e.missed,
          })
        }
      },
      showResult: (cue, cueContext) => {
        const e = cue.event
        const store = useBattleStore.getState()
        const setBanner = (value: string | null) => store.presentationSetBanner(cueContext.token, value)
        const pushLog = (message: string) => store.presentationPushLog(cueContext.token, message)
        if (e.missed) {
          setBanner('攻擊沒有命中…')
          pushLog(`${cue.attacker.nameZh} 的攻擊落空了！`)
        } else if (e.effectiveness === 0) {
          setBanner('沒有效果…')
          pushLog(`對 ${cue.defender.nameZh} 完全沒有效果…`)
        } else {
          const bits: string[] = []
          if (e.crit) bits.push('會心一擊！')
          if (e.effectivenessText) bits.push(e.effectivenessText)
          setBanner(bits.join('　') || null)
          pushLog(`對 ${cue.defender.nameZh} 造成 ${e.amount} 點傷害`)
        }
        tracePresentation(cueContext.token, 'feed', { cueId: cue.id, detail: 'result' })
      },
      clear: (_cue, cueContext) => {
        useBattleStore.getState().presentationClearTransient(cueContext.token)
      },
    },
    audio: {
      playAttack: (cue, cueContext) => {
        audio.play('attack')
        tracePresentation(cueContext.token, 'audio', { cueId: cue.id, detail: 'attack' })
      },
      playImpact: (cue, cueContext) => {
        const e = cue.event
        if (e.missed || e.amount <= 0) return
        audio.play(e.crit ? 'crit' : e.effectiveness >= 2 ? 'super' : 'hit')
        tracePresentation(cueContext.token, 'audio', { cueId: cue.id, detail: 'impact' })
      },
      playMoveSound: (cue, cueContext) => {
        const e = cue.event
        if (e.missed || e.amount <= 0) return
        const sound = resolveFx(cue.move).sound
        audio.playMoveSound(sound)
        tracePresentation(cueContext.token, 'audio', { cueId: cue.id, detail: `move:${sound}` })
      },
    },
    haptic: {
      impact: (cue) => {
        const e = cue.event
        if (e.missed || e.amount <= 0) return
        haptic(e.crit ? 'crit' : e.effectiveness >= 2 ? 'superEffective' : 'hit')
      },
    },
    legacy: {
      play: (cue, cueContext) => playLegacyEvent(cue.before, cue.event, cueContext),
    },
    action: {
      starPrelude: async (_cue, cueContext) => {
        const store = useBattleStore.getState()
        const projectedBattle = store.presentation?.battle
        if (!projectedBattle) throw new Error('Star prelude requires a current presentation')
        await cueContext.clock.race(
          baselineDriver()?.checkpoint('action:star', 'star') ?? Promise.resolve(),
          cueContext.signal,
        )
        const caster = projectedBattle.player.members[projectedBattle.player.activeIndex]
        const finisher = caster.moves[0] ?? caster.move
        audio.play('crit')
        tracePresentation(cueContext.token, 'audio', { cueId: 'input:star-prelude', detail: 'star' })
        if (juiceRef.current !== 'off') {
          await cinematicRef.current!.cutIn({
            artworkUrl: caster.artworkUrl,
            casterName: caster.nameZh,
            moveName: finisher.nameZh,
            type: finisher.type,
            side: 'player',
          }, {
            wait: (ms) => cueContext.clock.wait(ms, cueContext.signal),
          })
          store.presentationSetBanner(cueContext.token, '★ 星擊發動！')
          return
        }
        store.presentationSetBanner(cueContext.token, '★ 星擊發動！')
        haptic('crit')
        fxRef.current?.flash('#ffffff', 0.7)
        fxRef.current?.ring({ ...FX_POS.foe, color: '#ff7ae0' })
        void rootShake.start({ x: [0, -20, 18, -14, 10, 0], transition: { duration: 0.5 } })
        await cueContext.clock.wait(620, cueContext.signal)
        fxRef.current?.burst({ ...FX_POS.foe, color: '#ff7ae0', count: 40, power: 2, kind: 'spark' })
      },
      chainPrelude: async (cue, cueContext) => {
        const store = useBattleStore.getState()
        store.presentationSetBanner(cueContext.token, '🔗 連鎖攻擊！')
        audio.play('crit')
        tracePresentation(cueContext.token, 'audio', { cueId: cue.id, detail: 'chain' })
        fxRef.current?.flash('#7ae0ff', 0.4)
        await cueContext.clock.wait(cue.timingMs, cueContext.signal)
      },
      chainCleanup: async (cue, cueContext) => {
        await cueContext.clock.wait(cue.timingMs, cueContext.signal)
        useBattleStore.getState().presentationSetCombo(cueContext.token, null)
      },
      outcome: async (cue, cueContext) => {
        const store = useBattleStore.getState()
        if (cue.event.reason === 'timeout') {
          store.presentationSetBanner(cueContext.token, '達回合上限！依剩餘血量判定勝負')
          store.presentationPushLog(cueContext.token, '回合數達上限，依雙方剩餘血量判定勝負')
          tracePresentation(cueContext.token, 'feed', { cueId: cue.id, detail: 'timeout' })
          await cueContext.clock.wait(1150, cueContext.signal)
          store.presentationSetBanner(cueContext.token, null)
          await cueContext.clock.wait(150, cueContext.signal)
        }
        await cueContext.clock.wait(1100, cueContext.signal)
      },
    },
  }), [playLegacyEvent, rootShake])

  const presentationCueHandler = useMemo(
    () => new LegacyBattleCueHandler(createCuePorts()),
    [createCuePorts],
  )

  const resetPresentationVisuals = useCallback((token: PresentationToken) => {
    useBattleStore.getState().presentationClearTransient(token)
    cinematicRef.current?.resume()
    stageRef.current?.resetPresentation()
    fxRef.current?.clear()
    damageRef.current?.clear()
    rootShake.stop()
    rootShake.set({ x: 0, scale: 1 })
    vibrate(0)
  }, [rootShake])

  const presentationDirector = useMemo(() => new BattleDirector({
    handler: presentationCueHandler,
    lifecycle: {
      beforeCue: (cue, cueContext) => {
        const cueEvent = 'event' in cue ? cue.event : undefined
        tracePresentation(cueContext.token, 'cue', {
          cueId: cue.id,
          detail: cue.kind === 'damage'
            ? `damage:${cue.event.missed || cue.event.amount <= 0 ? 'no-impact' : 'impact'}`
            : cue.kind,
        })
        return cueEvent
          ? baselineDriver()?.checkpoint(`event:${cueEvent.type}`, checkpointForEvent(cueEvent))
          : undefined
      },
      degraded: (_error, cueContext) => { resetPresentationVisuals(cueContext.token) },
      reset: (cueContext) => {
        cinematicRef.current?.resume()
        useBattleStore.getState().presentationClearTransient(cueContext.token)
      },
    },
  }), [presentationCueHandler, resetPresentationVisuals])

  const submitTurn = useCallback(async (input: ReplayInput) => {
    const before = useBattleStore.getState().battle
    if (!before) return

    if (!turnCoordinatorRef.current) {
      turnCoordinatorRef.current = new BattleTurnCoordinator({
        acquireToken: () => useBattleStore.getState().acquirePresentationToken(),
        resolve: (token, current, turnInput): TurnResolution => {
          const session = useBattleStore.getState().session
          if (!session || !useBattleStore.getState().isSessionCurrent(token)) {
            throw new Error('Battle session is stale')
          }
          if (turnInput.type === 'ATTACK' && !turnInput.starStrike) {
            baselineDriver()?.beginCast(performance.now())
          }
          const sessionRng = makeRng(session.battleSeed)
          for (let index = 0; index < session.rngCursor; index += 1) sessionRng()
          let rngCalls = 0
          const turnRng = () => {
            rngCalls += 1
            return sessionRng()
          }
          const preparedCase = baselineDriver()?.activeTransactionCase()
          const { nextState, events } = resolveTurn(
            current,
            battleActionFromReplayInput(turnInput),
            {
              rng: turnRng,
              ext: extRef.current,
              terrainMultiplier: preparedCase ? undefined : resolveTerrainMult,
              wildEvents: preparedCase ? undefined : wildEventsRef.current,
            },
          )
          tracePresentation(token, 'resolve', {
            detail: inputKind(turnInput, current),
            turn: current.turn,
          })
          return {
            before: current,
            input: turnInput,
            events,
            nextState,
            battleSeed: session.battleSeed,
            turn: current.turn,
            rngCalls,
            commitMeta: turnCommitMeta(current, turnInput, events),
          }
        },
        tryRecordOnce: (token, turnInput, events) => {
          const currentStore = useBattleStore.getState()
          const status = currentStore.tryRecordTurnOnce(token, turnInput, events)
          const canonical = currentStore.battle
          tracePresentation(token, 'record', {
            detail: `${canonical ? inputKind(turnInput, canonical) : turnInput.type.toLowerCase()}:${status}`,
            turn: canonical?.turn,
          })
          return status
        },
        director: {
          present: (job, signal) => {
            tracePresentation(job.token, 'present', {
              detail: inputKind(job.input, job.before),
              turn: job.turn,
            })
            return presentationDirector.present(job, signal)
          },
        },
        transaction: {
          begin: (token, current, turnInput) => {
            useBattleStore.getState().beginPresentation(token, current, turnInput)
            tracePresentation(token, 'begin', {
              detail: inputKind(turnInput, current),
              turn: current.turn,
            })
          },
          isCurrent: (token) => useBattleStore.getState().isPresentationCurrent(token),
          commit: (token, resolution) => {
            const store = useBattleStore.getState()
            const result = store.commitTurn(token, resolution)
            if (!result.committed) return false
            tracePresentation(token, 'commit', {
              detail: inputKind(resolution.input, resolution.before),
              turn: resolution.nextState.turn,
            })
            if (result.outcome) {
              const outcomeAudio = result.outcome.winner === 'player' ? 'victory' : 'defeat'
              audio.play(outcomeAudio)
              tracePresentation(token, 'audio', {
                cueId: 'commit:battle-outcome',
                detail: outcomeAudio,
              })
              if (store.finishReplayOnce(token, result.outcome.outcome)) {
                tracePresentation(token, 'finish', { detail: result.outcome.outcome })
              }
              if (useBattleStore.getState().markEndSentOnce(token)) {
                tracePresentation(token, 'end', { detail: result.outcome.outcome })
                send({
                  type: 'END_BATTLE',
                  resultId: token.battleSessionId,
                  resultFingerprint: token.resultFingerprint,
                  outcome: result.outcome.outcome,
                })
              }
            }
            return true
          },
          cancel: (token, reason) => {
            resetPresentationVisuals(token)
            useBattleStore.getState().cancelPresentation(token, 'playerChoice')
            tracePresentation(token, 'cancel', {
              detail: reason,
              turn: useBattleStore.getState().battle?.turn,
            })
          },
        },
      })
    }

    await turnCoordinatorRef.current.submit(before, input)
  }, [presentationDirector, resetPresentationVisuals, send])

  const runPlayerTurn = useCallback((quality: QteQuality, mashCount = 0) => {
    return submitTurn({ type: 'ATTACK', quality, mashCount, slotIndex: pendingSlotRef.current })
  }, [submitTurn])

  const runStarStrike = useCallback(() => submitTurn({ type: 'ATTACK', starStrike: true }), [submitTurn])

  const runSwitchTurn = useCallback((index: number, defenseQuality: QteQuality) => {
    setPendingSwitch(null)
    return submitTurn({ type: 'SWITCH', index, defenseQuality })
  }, [submitTurn])

  const runChain = useCallback((hits: ChainHit[]) => submitTurn({
    type: 'CHAIN',
    hits: hits.map(({ attackerIndex, quality }) => ({ attackerIndex, quality })),
  }), [submitTurn])

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
    if (!chainSeq) return
    const hits = [...chainSeq.hits, { attackerIndex: chainSeq.participants[chainSeq.step], quality: q }]
    const nextStep = chainSeq.step + 1
    if (nextStep >= chainSeq.participants.length) {
      setChainSeq(null)
      void runChain(hits)
      return
    }
    setChainSeq({ ...chainSeq, step: nextStep, hits })
  }, [chainSeq, runChain])

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
    // 仍停在 playerChoice（不耗回合）→ 主動清掉提示 banner，避免一直掛著。
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
    <motion.div
      className={`col${juice !== 'off' ? ' battle-enter' : ''}`}
      style={{ flex: 1, position: 'relative' }}
      animate={rootShake}
    >
      {/* 3D 戰鬥舞台（背景層）：兩隻在場Mobie + 地台/光照/相機。EXT.3：off 不給 palette＝基線色/無霧。 */}
      <Suspense fallback={null}>
        <BattleStage
          ref={stageRef}
          player={player}
          foe={foe}
          palette={juice === 'off' ? undefined : terrainPalette}
          onRenderedFrame={import.meta.env.DEV ? (at) => baselineDriver()?.recordRenderedFrame(at) : undefined}
          onRendererDiagnostics={import.meta.env.DEV ? (resources) => {
            const driver = baselineDriver()
            driver?.recordRendererResources(resources)
            const pools = fxRef.current?.diagnostics?.()
            if (pools) driver?.recordPools(pools)
          } : undefined}
        />
      </Suspense>
      {/* EXT.3 天氣持續層（z2，介於 R3F 與 FxCanvas）：off 不掛＝零 rAF、嚴格回 M22 基線。 */}
      {juice !== 'off' && (
        <WeatherCanvas
          emitter={terrainPalette.emitter}
          color={terrainPalette.particleColor}
          sparkAccent={terrainPalette.sparkAccent}
          overlay={terrainPalette.overlay}
          density={weatherDensity}
          onPoolDiagnostics={import.meta.env.DEV ? (pool) => baselineDriver()?.recordPools({ weather: pool }) : undefined}
        />
      )}
      <FxCanvas ref={fxRef} />
      {/* EXT.1.b：juice≠off 用富表現飄字層（圖示優先）；off 回退既有 FloatDamage＝M22 基線、DOM 零新增 wrapper。 */}
      {juice === 'off' ? <FloatDamage hitFx={hitFx} /> : <DamageNumbers ref={damageRef} />}

      {/* 前景 HUD（疊在 3D 之上） */}
      <div className="col battle-fg" style={{ flex: 1, position: 'relative', zIndex: 10 }}>
      {/* 場域地形徽章（頂部置中常駐；中性/無地形不顯示） */}
      <TerrainChip terrainIds={battle.field.terrainEffects.current} />

      {/* ★ 星擊球：能量滿 + 輪到玩家選招時，於戰鬥區中央大特效顯示；點了即放（不放就點技能槽照常）。
          M22 增強互動：off→點擊即放（原樣）；lite/arcade→點擊改開蓄力/節奏手勢，完成才放招。 */}
      <div className="overlay-center overlay-center--orb">
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
                if (starMode === 'off') { void runStarStrike() }
                else { audio.play('select'); setStarCharging(true) }
              }}
            >
              <span className="star-orb__ring" />
              <span className="star-orb__star">★</span>
              <span className="star-orb__label">星擊發動</span>
            </motion.button>
          )}
        </AnimatePresence>
      </div>

      {/* M22 星擊手勢 overlay（lite 長按蓄力 / arcade 節奏點擊）；off 不渲染＝DOM 零新增 wrapper。
          完成（或逾時）→ 收起手勢 + runStarStrike()（簽名不動、傷害不吃手勢結果）。 */}
      {starCharging && phase === 'playerChoice' && (
        starMode === 'arcade' ? (
          <RhythmTap mode={starMode} onDone={() => { setStarCharging(false); void runStarStrike() }} />
        ) : (
          <HoldChargeRing mode={starMode} onCharged={() => { setStarCharging(false); void runStarStrike() }} />
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

      {/* 中央播報（EXT.1.e：full-bleed flex 層置中，framer scale/y 不再蓋掉置中） */}
      <div className="overlay-center overlay-center--banner">
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
      </div>

      {/* 支援輪盤 overlay（EXT.1.e：flex 層置中） */}
      <div className="overlay-center overlay-center--support">
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
      </div>

      {/* M9 連鎖連段數 overlay（連鎖中各段命中時彈出；EXT.1.e：flex 層置中） */}
      <div className="overlay-center overlay-center--combo">
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
      </div>

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
            {/* EXT.1.f C2 脈衝引導：指向選招（首玩/閒置才顯示，出手即收） */}
            {showChoiceGuide && <div className="choice-guide">👇 選一個招式出擊！</div>}
            <MoveSlots
              moves={player.moves}
              defenderTypes={foe.types}
              playerSpeed={player.spe}
              foeSpeed={foe.spe}
              onPick={(slot) => {
                pendingSlotRef.current = slot
                if (!guideSeenRef.current) {
                  guideSeenRef.current = true
                  try { localStorage.setItem('mz.guide.choiceSeen', '1') } catch { /* 隱私模式：忽略 */ }
                }
                setShowChoiceGuide(false)
                const isStatus = player.moves[slot]?.category === 'status'
                void baselineDriver()?.checkpoint('phase:qte', 'qte')
                useBattleStore.getState().setPhase(isStatus ? 'statusQte' : 'qte')
              }}
            />
            <div className="row battle-secondary-actions" style={{ gap: 12, justifyContent: 'center' }}>
              <SwitchAction
                switchable={switchable}
                onPick={() => useBattleStore.getState().setPhase('switchSelect')}
              />
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
                onResult={(actual) => {
                  const q = controlledQuality(actual)
                  if (q === 'perfect' || q === 'good') haptic('qteGood')
                  pendingQualityRef.current = q
                  useBattleStore.getState().setPhase('mash')
                }}
              />
            )}
            {phase === 'mash' && (attackVariant === 'rhythm'
              ? <RhythmTap mode={interactMode} onDone={(acc) => onMashDone(rhythmToMashCount(acc))} />
              : <MashMeter onDone={onMashDone} />)}
            {phase === 'statusQte' && (
              <TimingBar
                hint="變化招！抓準時機強化效果（只影響強度、不影響成敗）"
                onResult={(actual) => {
                  const q = controlledQuality(actual)
                  if (q === 'perfect' || q === 'good') haptic('qteGood')
                  void runPlayerTurn(q, 0)
                }}
              />
            )}
            {phase === 'defenseQte' && (defenseMode !== 'off'
              ? <ShieldSwipe mode={defenseMode} onResult={(q) => { if (pendingSwitch !== null) runSwitchTurn(pendingSwitch, controlledQuality(q)) }} />
              : (
                <TimingBar
                  hint="換人中！點擊停在正中可大幅減傷！"
                  onResult={(q) => { if (pendingSwitch !== null) runSwitchTurn(pendingSwitch, controlledQuality(q)) }}
                />
              ))}
            {phase === 'chainQte' && chainSeq && (
              <TimingBar
                key={`chain-${chainSeq.step}`} /* 每段重掛 → 指針動畫重置 */
                hint={`🔗 連鎖 ${chainSeq.step + 1}/${chainSeq.participants.length}　${battle.player.members[chainSeq.participants[chainSeq.step]].nameZh}！抓準時機連續出擊`}
                onResult={(q) => onChainQteResult(controlledQuality(q))}
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

      {/* ===== EXT.2 星擊電影化：letterbox + 全螢幕 cut-in（純 display，由 cinematicCoordinator 驅動） ===== */}
      <AnimatePresence>
        {letterbox && (
          <motion.div key="lb" className="cinematic-letterbox" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <motion.div className="cinematic-bar cinematic-bar--top" initial={{ y: '-100%' }} animate={{ y: 0 }} exit={{ y: '-100%' }} transition={{ duration: 0.22, ease: 'easeOut' }} />
            <motion.div className="cinematic-bar cinematic-bar--bottom" initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ duration: 0.22, ease: 'easeOut' }} />
          </motion.div>
        )}
      </AnimatePresence>
      <div className="overlay-center overlay-center--cutin">
        <AnimatePresence>
          {cutIn && (
            <motion.div
              key="cutin"
              className="cutin-card"
              style={{ ['--type' as string]: typePalette[cutIn.type].color }}
              initial={{ opacity: 0, scale: 1.7 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.32, filter: 'brightness(4)' }}
              transition={{ duration: 0.13, ease: [0.2, 0.9, 0.3, 1] }}
            >
              <img className="cutin-card__art" src={cutIn.artworkUrl} alt="" draggable={false} />
              <div className="cutin-card__text">
                <div className="cutin-card__eyebrow">★ 星擊 FINISHER</div>
                <div className="cutin-card__move">{cutIn.moveName}</div>
                <div className="cutin-card__caster">{cutIn.casterName}</div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
