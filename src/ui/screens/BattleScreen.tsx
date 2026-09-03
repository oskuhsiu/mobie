import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { AnimatePresence, motion, useAnimationControls, useReducedMotion } from 'framer-motion'
import { useGame } from '@/app/GameProvider'
import { useBattleStore, type BattleFeedInput, type Side, type HitFx } from '@/store/battleStore'
import { useSettings } from '@/store/settingsStore'
import { PRODUCT_RUNTIME } from '@/game/ext/productRuntime'
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
import type { BattleMobie, Move, TypeName } from '@/game/types'
import { initiativePresentation, moveDecisionPresentation } from '@/game/battle/decisionPresentation'
import { getMove } from '@/game/data/moves'
import { lookupRegion } from '@/game/data/regionLookup'
import { resolveBattleTerrains, resolveTerrainMult, terrainDefsOf, TERRAINS, lookupTerrain } from '@/game/data/terrains'
import { makeWildEvents } from '@/game/accidents'
import { makeRng } from '@/game/rng'
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
import { BattleSceneHost } from '@/scene/battle/host/BattleSceneHost'
import type { BattleSceneHandle } from '@/scene/battle/contracts'
import { resolveTerrainPalette } from '@/scene/r3f/terrainVisual'
import { TYPE_LABEL_ZH, typeColor } from '@/ui/typeMeta'
import { getItem } from '@/game/ext/items'
import { getAbility } from '@/game/ext/abilities'
import { audio } from '@/audio/audioEngine'
import { battleAudioSession } from '@/audio/battleAudioSession'
import { battleBgmSession } from '@/audio/battleBgmSession'
import type { M23Checkpoint, M23PresentationTraceStage } from '@/dev/m23/contracts'
import { BattleDirector } from '@/presentation/battle/BattleDirector'
import { BattleIntentCoordinator } from '@/presentation/battle/BattleIntentCoordinator'
import { BattleIntentPresenter } from '@/presentation/battle/BattleIntentPresenter'
import { BattleSessionLifecycle } from '@/presentation/battle/BattleSessionLifecycle'
import { BattleTurnCoordinator } from '@/presentation/battle/BattleTurnCoordinator'
import { LegacyBattleCueHandler, type BattleCuePorts } from '@/presentation/battle/cueHandlers'
import { battleActionFromReplayInput } from '@/presentation/battle/turnInput'
import { sameBattleSession } from '@/presentation/battle/battleIdentity'
import { registerBattleLifecycleEnd } from '@/presentation/battle/battleLifecycleBridge'
import { normalizedBattleAnchor } from '@/presentation/battle/battleAnchors'
import {
  rendererIsReady,
  rendererAttemptId,
  type BattleRendererState,
  type GraphicsPreference,
  type RendererFallbackReason,
} from '@/presentation/battle/rendering'
import type {
  BattleDisplaySnapshot,
  BattleIntent,
  BattleSessionToken,
  CancelReason,
  CueContext,
  IntentSkipSource,
  IntroIntent,
  PartnerSkillResultIntent,
  PresentationToken,
  TurnCommitMeta,
  TurnResolution,
} from '@/presentation/battle/contracts'
import { usePausableScheduler } from '@/ui/battle/usePausableScheduler'
import { BattleErrorPanel } from '@/ui/battle/BattleErrorPanel'
import { BattleFeed } from '@/ui/battle/BattleFeed'
import { classifyBattleWindow } from '@/ui/battle/BattleLayout'
import { damageEffectSourceLabels } from '@/ui/battle/BattleHudAdapter'
import { BattleRenderGate } from '@/ui/battle/BattleRenderGate'
import { FieldStatusBar, SideStatusRail } from '@/ui/battle/BattleStatus'
import { ResourceAction } from '@/ui/battle/ResourceAction'
import { SwitchAction, SwitchSheet } from '@/ui/battle/SwitchSheet'
import { mobCardDisabledReason, switchAvailability } from '@/ui/battle/BattleActionModel'
import '@/ui/styles/battle.css'

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
  foe: normalizedBattleAnchor('foe', 'impact'),
  player: normalizedBattleAnchor('player', 'impact'),
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
const pendingSessionCleanup = new Map<string, ReturnType<typeof setTimeout>>()
const sessionCleanupKey = (token: BattleSessionToken) =>
  `${token.battleSessionId}:${token.resultFingerprint}`

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
    transactionId: `${token.battleSessionId}:${token.resultFingerprint}:${token.purpose}:${token.presentationId}`,
    presentationId: token.presentationId,
    purpose: token.purpose,
    stage,
    ...detail,
  })
}

const resultFeedInput = (cueId: string, text: string): BattleFeedInput => ({
  id: `${cueId}:result`,
  text,
  kind: 'result',
})

function playCurrentBattleSfx(callback: () => void): boolean {
  return battleAudioSession.playCurrent(callback)
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

function stableUnitProjection(side: Side, member: BattleMobie, slot: number) {
  return {
    instanceId: `${side}:${slot}`,
    side,
    slot,
    speciesId: member.speciesId,
    displayName: member.nameZh,
    level: member.level,
    maxHp: member.maxHp,
    shiny: member.shiny,
    ...(member.heldItemId ? { heldItemId: member.heldItemId } : {}),
    ...(member.abilityId ? { abilityId: member.abilityId } : {}),
  }
}

// M14.c：把一方 BattleMobie[] 轉成回放用的 DisplayUnitSnapshot[]（只取畫面/FX 分派要的穩定欄位）。
function teamSnapshot(side: Side, members: BattleMobie[]): DisplayUnitSnapshot[] {
  return members.map((member, slot) => ({
    ...stableUnitProjection(side, member, slot),
    initialHp: member.currentHp,
  }))
}

function battleDisplaySnapshot(battle: BattleState): BattleDisplaySnapshot {
  const side = (sideName: Side) => ({
    activeIndex: battle[sideName].activeIndex,
    members: battle[sideName].members.map((member, slot) => ({
      ...stableUnitProjection(sideName, member, slot),
      artworkUrl: member.artworkUrl,
      hp: member.currentHp,
    })),
  })
  const statuses = (values: BattleState['field']['teamStatuses']) => values.map((status) => ({
    stat: status.stat,
    multiplier: status.mult,
    remaining: status.remaining,
    source: status.source,
    label: status.label,
  }))
  return {
    player: side('player'),
    foe: side('foe'),
    terrainIds: [...battle.field.terrainEffects.current],
    sideStatuses: {
      player: statuses(battle.field.teamStatuses),
      foe: statuses(battle.field.enemyStatuses),
    },
    fieldMarks: battle.field.comboCastEffects.map((mark) => ({ ...mark })),
  }
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

/** 底部常駐隊伍 tray：每隻一顆 HP pip，倒下灰階、在場高亮。點 pip 開該隻資訊卡（M16）。 */
function TeamTray({ members, activeIndex, align, interactive, disabledReason, onPick }: {
  members: BattleMobie[]
  activeIndex: number
  align: 'start' | 'end'
  interactive: boolean
  disabledReason: string | null
  onPick?: (index: number, invoker: HTMLButtonElement) => void
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
            type="button"
            className={`tray__pip ${i === activeIndex ? 'tray__pip--active' : ''} ${fainted ? 'tray__pip--out' : ''}`}
            title={interactive ? `${m.nameZh}（看資訊卡）` : disabledReason ?? undefined}
            aria-label={`${m.nameZh}，${i === activeIndex ? '出戰中，' : ''}HP ${Math.ceil(Math.max(0, m.currentHp))} / ${m.maxHp}${fainted ? '，已倒下' : ''}${interactive ? '，開啟資訊卡' : `，無法開啟資訊卡：${disabledReason}`}`}
            aria-current={i === activeIndex ? 'true' : undefined}
            aria-disabled={!interactive}
            tabIndex={interactive ? 0 : -1}
            onClick={(event) => { if (interactive) onPick?.(i, event.currentTarget) }}
          >
            <span className="tray__visual" aria-hidden="true">
              <span className={`tray__fill ${tone}`} style={{ width: `${frac * 100}%` }} />
              {fainted && <span className="tray__x">✕</span>}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** 緊貼立繪的精簡 HP 牌：名稱 + Lv + 血條（自家顯示數字）。放在角色同側，避免看錯誰的血。點開資訊卡（M16）。 */
function HpPlate({ mon, owner, label, interactive, disabledReason, onOpen }: {
  mon: BattleMobie
  owner: boolean
  label: string
  interactive: boolean
  disabledReason: string | null
  onOpen?: (invoker: HTMLButtonElement) => void
}) {
  const ratio = Math.max(0, mon.currentHp) / mon.maxHp
  const tone = hpToneClass(ratio, 'hpbar__fill')
  const item = getItem(mon.heldItemId)
  const ability = getAbility(mon.abilityId)
  return (
    <button
      type="button"
      className={`hp-plate ${owner ? 'hp-plate--owner' : 'hp-plate--foe'}`}
      onClick={(event) => { if (interactive) onOpen?.(event.currentTarget) }}
      aria-disabled={!interactive}
      tabIndex={interactive ? 0 : -1}
      title={interactive ? `${label}（開啟資訊卡）` : disabledReason ?? undefined}
      aria-label={`${label}，等級 ${mon.level}，HP ${Math.ceil(Math.max(0, mon.currentHp))} / ${mon.maxHp}${ability ? `，特性 ${ability.name}` : ''}${item ? `，道具 ${item.name}` : ''}${interactive ? '，開啟資訊卡' : `，無法開啟資訊卡：${disabledReason}`}`}
    >
      <div className="hp-plate__top">
        <span className="hp-plate__name">{label}</span>
        <span className="hpbar__lv">Lv.{mon.level}</span>
        {ability && <span className="battle-badge" title={ability.desc}>{ability.icon} {ability.name}</span>}
        {item && <span className="battle-badge" title={item.desc}>{item.icon} {item.name}</span>}
      </div>
      <div
        className="hp-plate__track"
        role="meter"
        aria-label={`${label} HP`}
        aria-valuemin={0}
        aria-valuemax={mon.maxHp}
        aria-valuenow={Math.ceil(Math.max(0, mon.currentHp))}
        aria-valuetext={`${Math.ceil(Math.max(0, mon.currentHp))} / ${mon.maxHp}`}
      >
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
    </button>
  )
}

/** 連打蓄力：限時內瘋狂點擊累積色階加成（計數走 ref，不過 React state）。
 *  點擊範圍放大成戰鬥中心一整圈（橘色 blur 光暈），每次點擊噴漣漪 + 整圈 thump 強回饋。 */
export function MashMeter({ onDone, paused = false }: { onDone: (count: number) => void; paused?: boolean }) {
  const countRef = useRef(0)
  const barRef = useRef<HTMLDivElement>(null)
  const labelRef = useRef<HTMLDivElement>(null)
  const doneRef = useRef(false)
  const keyHeldRef = useRef(false)
  const fieldRef = useRef<HTMLDivElement>(null)
  const ripRef = useRef<HTMLDivElement>(null)
  const ripIdxRef = useRef(0)
  const scheduler = usePausableScheduler(paused)

  useEffect(() => {
    countRef.current = 0
    doneRef.current = false
    const timer = scheduler.schedule(() => {
      if (doneRef.current) return
      doneRef.current = true
      onDone(countRef.current)
    }, MASH_DURATION_MS)
    return () => scheduler.cancel(timer)
  }, [onDone, scheduler])

  useEffect(() => {
    fieldRef.current?.focus()
  }, [])

  useEffect(() => {
    if (paused) keyHeldRef.current = false
  }, [paused])

  const registerTap = (clientX?: number, clientY?: number) => {
    if (doneRef.current || paused) return
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
        r.style.left = `${clientX === undefined ? rect.width / 2 : clientX - rect.left}px`
        r.style.top = `${clientY === undefined ? rect.height / 2 : clientY - rect.top}px`
        r.classList.remove('is-on'); void r.offsetWidth; r.classList.add('is-on')
      }
      field.classList.remove('is-hit'); void field.offsetWidth; field.classList.add('is-hit')
    }
  }

  const tap = (e: ReactPointerEvent<HTMLDivElement>) => registerTap(e.clientX, e.clientY)

  return (
    <div
      ref={fieldRef}
      className="tap-field tap-field--charge"
      onPointerDown={tap}
      onKeyDown={(event) => {
        if (event.repeat || keyHeldRef.current || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        keyHeldRef.current = true
        registerTap()
      }}
      onKeyUp={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        keyHeldRef.current = false
      }}
      onBlur={() => { keyHeldRef.current = false }}
      role="button"
      tabIndex={0}
      aria-label="連打蓄力，重複點擊或按 Enter、空白鍵"
      data-battle-input
    >
      <div className="tap-field__glow" aria-hidden />
      <div className="tap-field__ripples" ref={ripRef} aria-hidden>
        {Array.from({ length: 8 }).map((_, i) => <div key={i} className="tap-field__ripple" />)}
      </div>
      <div className="tap-field__inner mash">
        <div className="mash__hint">連打蓄力！瘋狂點擊衝高傷害</div>
        <div className="mash__track"><div ref={barRef} className="mash__fill" style={{ width: '0%' }} /></div>
        <div ref={labelRef} className="mash__tier">蓄力中…</div>
        <div className="qte__timeout" aria-hidden>
          <div
            className="qte__timeout-fill"
            style={{
              animationDuration: `${MASH_DURATION_MS}ms`,
              animationPlayState: paused ? 'paused' : 'running',
            }}
          />
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
  showInitiative?: boolean
  active?: boolean
  onPick: (slot: number) => void
}

export function MoveSlots({ moves, defenderTypes, playerSpeed, foeSpeed, showInitiative = true, active = true, onPick }: MoveSlotsProps) {
  // 用 ref 鎖「已選定」：避免點擊與鍵盤輸入競合、或重複觸發兩次出招。
  const pickedRef = useRef(false)
  const [summarySlot, setSummarySlot] = useState(0)
  const pick = useCallback((slot: number) => {
    if (pickedRef.current) return false
    if (slot < 0 || slot >= moves.length) return false
    pickedRef.current = true
    onPick(slot)
    return true
  }, [moves.length, onPick])

  // 四鍵 / 方向鍵映射（plan/17 §1.1）。只在本面板掛載期間監聽。
  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const slot = SLOT_KEY_MAP[e.key]
      if (slot === undefined || slot >= moves.length) return
      e.preventDefault()
      pick(slot)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, moves.length, pick])

  const summaryMove = moves[summarySlot] ?? moves[0]
  const summaryDecision = summaryMove ? moveDecisionPresentation(summaryMove, defenderTypes) : null
  const summaryStats = summaryMove?.category === 'status'
    ? summaryMove.effect?.duration
      ? `持續 ${summaryMove.effect.duration} 回合，命中 ${summaryMove.accuracy}%`
      : `命中 ${summaryMove.accuracy}%`
    : summaryMove ? `威力 ${summaryMove.power}，命中 ${summaryMove.accuracy}%` : ''

  return (
    <div className="move-choice">
      {showInitiative && <div className="move-initiative">{initiativePresentation(playerSpeed, foeSpeed)}</div>}
      <div className="move-choice__summary" data-testid="move-consequence-summary">
        {summaryMove && summaryDecision
          ? `${summaryMove.nameZh}：${summaryDecision.label}；${summaryStats}`
          : '目前沒有可用招式'}
      </div>
      <div className="move-grid" data-move-count={moves.length}>
        {moves.map((mv, i) => {
          const decision = moveDecisionPresentation(mv, defenderTypes)
          const category = mv.category === 'physical' ? '物理' : mv.category === 'special' ? '特殊' : '變化'
          const stats = mv.category === 'status'
            ? mv.effect?.duration
              ? `${mv.effect.label}，持續 ${mv.effect.duration} 回合，命中 ${mv.accuracy}%`
              : `${mv.effect?.label ?? '輔助效果'}，命中 ${mv.accuracy}%`
            : `威力 ${mv.power}，命中 ${mv.accuracy}%`
          return (
            <motion.button
              key={i}
              className={`move-slot ${mv.category === 'status' ? 'move-slot--status' : ''}`}
              data-battle-action="move"
              data-move-slot={i}
              style={{ ['--mv' as string]: typeColor(mv.type) }}
              whileTap={{ scale: 0.96 }}
              aria-label={`${mv.nameZh}，${TYPE_LABEL_ZH[mv.type]}屬性，${category}，${decision.label}，${stats}`}
              onPointerEnter={() => setSummarySlot(i)}
              onFocus={() => setSummarySlot(i)}
              onClick={() => { if (pick(i)) audio.play('select') }}
            >
              <span className="move-slot__key">{i + 1}</span>
              <span className="move-slot__name">{mv.nameZh}</span>
              <span className="move-slot__meta">
                <span className="type-badge" style={{ background: typeColor(mv.type) }}>{TYPE_LABEL_ZH[mv.type]}</span>
                <span className="move-slot__cat">{category}</span>
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

export { SwitchAction } from '@/ui/battle/SwitchSheet'

export interface BattleScreenProps {
  /** Storage-independent renderer input. Production omits it and receives Auto. */
  graphicsPreference?: GraphicsPreference
}

export function BattleScreen({ graphicsPreference = 'auto' }: BattleScreenProps = {}) {
  const { context, send } = useGame()
  const battle = useBattleStore((s) => s.presentation?.battle ?? s.battle)
  const phase = useBattleStore((s) => s.phase)
  const intentPresentation = useBattleStore((s) => s.intentPresentation)
  const banner = useBattleStore((s) => s.intentPresentation
    ? s.intentPresentation.banner
    : s.presentation ? s.presentation.banner : s.banner)
  const hitFx = useBattleStore((s) => s.presentation ? s.presentation.hitFx : s.hitFx)
  const support = useBattleStore((s) => s.presentation ? s.presentation.support : s.support)
  const energy = useBattleStore((s) => s.presentation ? s.presentation.energy : s.energy)
  const combo = useBattleStore((s) => s.presentation ? s.presentation.combo : s.combo)
  const log = useBattleStore((s) => s.intentPresentation
    ? s.intentPresentation.log
    : s.presentation ? s.presentation.log : s.log)
  const lockedIndex = useBattleStore((s) => s.presentation ? s.presentation.lockedIndex : s.lockedIndex)
  const revealedFoes = useBattleStore((s) => s.revealedFoes)
  const runtimeSession = useBattleStore((s) => s.session)
  const battleError = useBattleStore((s) => s.battleError)
  const partnerSkillIdsUsed = useBattleStore((s) => s.session?.partnerSkillIdsUsed)
  const choiceFocusRequestId = useBattleStore((s) => s.choiceFocusRequestId)
  const activeResource = useBattleStore((s) => s.presentation?.activeResource ?? null)
  const commandNotice = useBattleStore((s) => s.presentation?.commandNotice ?? null)
  const devRendererOptions = import.meta.env.DEV ? baselineDriver()?.options : undefined
  const requestedGraphics = devRendererOptions?.graphics ?? graphicsPreference
  const rendererFailure = devRendererOptions?.rendererFailure ?? null
  const prefersReducedMotion = useReducedMotion()
  const reducedMotion = Boolean(
    prefersReducedMotion
    || (devRendererOptions?.motion !== undefined && devRendererOptions.motion !== 'full'),
  )
  const [windowClass, setWindowClass] = useState(() => (
    typeof window === 'undefined'
      ? 'wide-landscape' as const
      : classifyBattleWindow(window.innerWidth, window.innerHeight)
  ))
  const [battleDataReady, setBattleDataReady] = useState(false)
  const [rendererState, setRendererState] = useState<BattleRendererState | null>(null)
  const currentRendererAttemptId = runtimeSession
    ? rendererAttemptId(runtimeSession.token)
    : null
  const rendererReady = rendererState?.attemptId === currentRendererAttemptId && rendererIsReady(rendererState)
  // M16：戰鬥中點 HpPlate/TeamTray 開資訊卡（自己全顯、對手深度遮罩待 M17 看穿）
  const [cardView, setCardView] = useState<{ side: Side; index: number } | null>(null)
  // M22 星擊增強互動 mode（off＝原本單擊即放）。selector 內回純字串＝只在 mode 變動時才 re-render。
  const starMode = useSettings((s) => interactModeOf(s.settings, 'starStrike'))
  // M22.f 換人防禦下滑護盾（off＝原 TimingBar）；M22.g 攻擊節奏變體（mash＝原連打）。
  const defenseMode = useSettings((s) => interactModeOf(s.settings, 'defense'))
  const attackVariant = useSettings((s) => attackInputVariantOf(s.settings))
  const interactMode = useSettings((s) => s.settings.prefs.enhancedInteractivity.mode)
  // EXT.1 打擊感強度（純字串 selector，只在變動時 re-render）：off＝回退 M22 純 flash+shake / FloatDamage。
  const juice = useSettings((s) => juiceLevelOf(s.settings))
  // M17 夥伴（訓練師）技能固定存在；只由已習得集合與每場使用 ledger 限制。
  const learnedSkillIds = usePlayerSkills((s) => s.learnedSkillIds)
  const partnerSkills = useMemo(() => learnedPartnerSkills(learnedSkillIds), [learnedSkillIds])
  // M11 野外意外（wild-only）：戰中地形突變/亂入注入 hook；arena/競技場/連勝塔不注入＝零意外。
  const wildEvents = useMemo(() => {
    if (context.tower) return undefined // 塔戰無野外意外
    const region = context.regionId ? lookupRegion(context.regionId) : null
    return region?.mode === 'wild' ? makeWildEvents({ terrainPool: WILD_SHIFT_POOL }) : undefined
  }, [context.regionId, context.tower])
  const wildEventsRef = useRef(wildEvents)
  wildEventsRef.current = wildEvents

  // EXT.3：當前地形 → 視覺 palette（地板色調/環境光/霧/天氣 emitter）。純 display。
  // 隨 terrainShift 更新（current 陣列換新參照即重算）；全空/neutral → 基線 palette。
  const terrainPalette = useMemo(
    () => resolveTerrainPalette(battle?.field.terrainEffects.current ?? []),
    [battle?.field.terrainEffects.current],
  )
  // Graphics controls cost; juice remains an independent presentation-intensity ceiling.
  const graphicsWeatherDensity = !rendererReady
    ? 0
    : rendererState?.tier === 'high' ? 1 : rendererState?.tier === 'balanced' ? 0.3 : 0.2
  const juiceWeatherDensity = juice === 'full' ? 1 : juice === 'reduced' ? 0.3 : 0
  const weatherDensity = graphicsWeatherDensity * juiceWeatherDensity * (reducedMotion ? 0.1 : 1)

  const fxRef = useRef<FxHandle>(null)
  const damageRef = useRef<DamageNumbersHandle>(null)
  const stageRef = useRef<BattleSceneHandle>(null)
  const rootShake = useAnimationControls()
  // EXT.1：juice 走 ref 供 presentation ports 讀最新值，不重建整條 director。
  const juiceRef = useRef(juice)
  juiceRef.current = juice
  const reducedMotionRef = useRef(reducedMotion)
  reducedMotionRef.current = reducedMotion
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
      setTimeScale: (scale) => stageRef.current?.setTimeScale(reducedMotionRef.current ? 1 : scale),
      onCharge: (spec) => {
        const pal = typePalette[spec.type]
        fxRef.current?.converge({ nx: 0.5, ny: 0.5, color: pal.color, count: 40, shape: pal.shape })
        playCurrentBattleSfx(() => audio.starChargeSweep())
      },
      onStamp: () => { playCurrentBattleSfx(() => audio.starStampTick()) },
      onImpact: (spec) => {
        const pal = typePalette[spec.type]
        fxRef.current?.flash('#ffffff', 0.9)
        fxRef.current?.shockwave({ nx: 0.5, ny: 0.5, color: pal.color }) // 外層大環
        fxRef.current?.shockwave({ nx: 0.5, ny: 0.5, color: pal.accent, lw: 5 }) // 內層細環
        fxRef.current?.burst({ nx: 0.5, ny: 0.5, color: pal.color, count: 44, power: 2.2, kind: 'spark', shape: pal.shape })
        if (!reducedMotionRef.current) {
          void rootShake.start({ x: [0, -24, 20, -16, 10, 0], scale: [1, 1.05, 1], transition: { duration: 0.55 } })
        }
        playCurrentBattleSfx(() => audio.starImpactBoom())
        haptic('crit')
      },
    })
  }
  const initedRef = useRef(false)
  const turnCoordinatorRef = useRef<BattleTurnCoordinator | null>(null)
  const intentCoordinatorRef = useRef<BattleIntentCoordinator | null>(null)
  const presentationDirectorRef = useRef<BattleDirector | null>(null)
  const resetPresentationRef = useRef<(token: PresentationToken) => void>(() => undefined)
  const battleRootRef = useRef<HTMLDivElement | null>(null)
  const battleStageElementRef = useRef<HTMLElement | null>(null)
  const commandDeckRef = useRef<HTMLElement | null>(null)
  const commandHeaderRef = useRef<HTMLDivElement | null>(null)
  const battleFeedRef = useRef<HTMLDivElement | null>(null)
  const introSkipRef = useRef<HTMLButtonElement>(null)
  const switchInvokerRef = useRef<HTMLButtonElement | null>(null)
  const choiceInvokerRestoreRef = useRef<{
    invoker: HTMLButtonElement | null
    replacementSelector?: string
  } | null>(null)
  const cardInvokerRef = useRef<HTMLButtonElement | null>(null)
  // 換人面板選中的隊友索引（等防禦 QTE）
  const [pendingSwitch, setPendingSwitch] = useState<number | null>(null)
  // timing QTE 命中品質暫存，待連打蓄力結束才解算回合
  const pendingQualityRef = useRef<QteQuality>('normal')
  // M19.c 選定的招式槽（選槽→qte→mash 相位間存活）；玩家明確選擇前不會進入 QTE。
  const pendingSlotRef = useRef(0)
  // M9 連鎖：連續 QTE 序列（participants=參與隊友索引、step=目前第幾段、hits=已收集宣告）
  const [chainSeq, setChainSeq] = useState<{ participants: number[]; step: number; hits: ChainHit[] } | null>(null)
  const [documentHidden, setDocumentHidden] = useState(
    typeof document !== 'undefined' && document.hidden,
  )
  const [retrying, setRetrying] = useState(false)
  const retryingRef = useRef(false)
  // EXT.1.f C2 脈衝引導：選招處「👇 選一個招式」提示。首玩（localStorage 旗標未設）或閒置 N 秒才顯示，
  // 玩家一出手即記旗標並收起；純 display、可由 juice='off' 關閉、不碰 reducer。
  const [showChoiceGuide, setShowChoiceGuide] = useState(false)
  const guideSeenRef = useRef(typeof localStorage !== 'undefined' && localStorage.getItem('mz.guide.choiceSeen') === '1')
  const lifecycleRef = useRef<BattleSessionLifecycle | null>(null)

  useLayoutEffect(() => {
    if (battleStageElementRef.current) {
      battleStageElementRef.current.inert = cardView !== null || phase === 'switchSelect'
    }
    if (commandDeckRef.current) commandDeckRef.current.inert = cardView !== null
    if (commandHeaderRef.current) commandHeaderRef.current.inert = phase === 'switchSelect'
  }, [cardView, phase])

  if (!lifecycleRef.current) {
    const cancelPresentation = (token: PresentationToken, reason: CancelReason) => {
      const store = useBattleStore.getState()
      if (token.purpose === 'turn') {
        turnCoordinatorRef.current?.cancel(reason)
        if (useBattleStore.getState().isPresentationCurrent(token)) {
          resetPresentationRef.current(token)
          useBattleStore.getState().cancelPresentation(token, 'playerChoice')
          tracePresentation(token, 'cancel', { detail: reason, turn: store.battle?.turn })
        }
      } else {
        intentCoordinatorRef.current?.cancel(reason)
        if (useBattleStore.getState().isIntentPresentationCurrent(token)) {
          useBattleStore.getState().cancelIntentOnce(token, reason)
          tracePresentation(token, 'cancel', { detail: reason })
        }
      }
    }
    lifecycleRef.current = new BattleSessionLifecycle({
      cancelSession: (sessionToken, reason) => {
        const store = useBattleStore.getState()
        if (!sameBattleSession(store.session?.token, sessionToken)) return
        const token = store.presentation?.token ?? store.intentPresentation?.token
        if (token) cancelPresentation(token, reason)
        else {
          turnCoordinatorRef.current?.cancel(reason)
          intentCoordinatorRef.current?.cancel(reason)
        }
      },
      cancelPresentation,
      resetPresentation: (token) => { resetPresentationRef.current(token) },
      pausePresentation: (token) => { presentationDirectorRef.current?.pause(token) },
      resumePresentation: (token) => { presentationDirectorRef.current?.resume(token) },
      sfx: battleAudioSession,
      bgm: battleBgmSession,
    })
  }
  const sessionLifecycle = lifecycleRef.current

  useLayoutEffect(() => {
    const active = useBattleStore.getState().session?.token
    if (active) {
      const key = sessionCleanupKey(active)
      const pending = pendingSessionCleanup.get(key)
      if (pending) {
        clearTimeout(pending)
        pendingSessionCleanup.delete(key)
      }
    }
    return () => {
      const token = useBattleStore.getState().session?.token
      if (!token) return
      const key = sessionCleanupKey(token)
      const cleanup = setTimeout(() => {
        if (pendingSessionCleanup.get(key) === cleanup) {
          pendingSessionCleanup.delete(key)
          sessionLifecycle.end(token, 'unmount')
        }
      }, 0)
      pendingSessionCleanup.set(key, cleanup)
    }
  }, [sessionLifecycle])

  useLayoutEffect(() => registerBattleLifecycleEnd((reason) => {
    const token = useBattleStore.getState().session?.token
    if (token) sessionLifecycle.end(token, reason)
  }), [sessionLifecycle])

  const intentPresenter = useMemo(() => new BattleIntentPresenter({
    display: {
      setBanner: (message, cueContext) => {
        useBattleStore.getState().intentSetBanner(cueContext.token, message)
      },
      appendFeed: (entry, cueContext) => {
        useBattleStore.getState().intentPushFeed(cueContext.token, entry)
        tracePresentation(cueContext.token, 'feed', { cueId: entry.id, detail: cueContext.token.intentId })
      },
      playPartnerEffect: (effect, cueContext) => {
        if (!useBattleStore.getState().isIntentPresentationCurrent(cueContext.token)) return
        if (effect === 'reveal-foe') {
          fxRef.current?.flash('#7ae0ff', 0.3)
          fxRef.current?.ring({ ...FX_POS.foe, color: '#7ae0ff' })
          fxRef.current?.burst({ ...FX_POS.foe, color: '#7ae0ff', count: 14, kind: 'spark' })
        } else {
          fxRef.current?.flash('#ffd23f', 0.3)
          fxRef.current?.ring({ ...FX_POS.player, color: '#ffd23f' })
          fxRef.current?.burst({ ...FX_POS.player, color: '#ffd23f', count: 16, kind: 'spark' })
        }
      },
    },
  }), [])

  const intentCoordinator = useMemo(() => new BattleIntentCoordinator({
    presenter: {
      present: (job, signal) => {
        tracePresentation(job.token, 'present', { detail: job.intent.kind })
        const director = presentationDirectorRef.current
        if (!director) throw new Error('Battle Director is unavailable')
        return director.present(job, signal)
      },
    },
    transaction: {
      begin: (intent) => {
        const token = useBattleStore.getState().beginIntentPresentation(intent)
        if (token) {
          sessionLifecycle.beginPresentation(token)
          tracePresentation(token, 'begin', { detail: intent.kind })
        }
        return token
      },
      isCurrent: (token) => useBattleStore.getState().isIntentPresentationCurrent(token),
      completeOnce: (token) => {
        const completed = useBattleStore.getState().completeIntentOnce(token)
        if (completed) {
          tracePresentation(token, 'complete', { detail: token.intentId })
          void baselineDriver()?.checkpoint('phase:player-choice', 'player-choice')
        }
        sessionLifecycle.finishPresentation(token)
        return completed
      },
      cancelOnce: (token, reason) => {
        const cancelled = useBattleStore.getState().cancelIntentOnce(token, reason)
        sessionLifecycle.cancelPresentation(token)
        return cancelled
      },
    },
  }), [])
  intentCoordinatorRef.current = intentCoordinator

  const submitIntent = useCallback((
    intent: BattleIntent,
    snapshot: BattleDisplaySnapshot,
    visualSeed: string,
  ) => (
    intentCoordinator.submit(intent, snapshot, visualSeed)
  ), [intentCoordinator])

  const requestIntroSkip = useCallback((source: IntentSkipSource) => {
    const token = useBattleStore.getState().intentPresentation?.token
    if (!token || token.intentId !== 'intro' || !intentCoordinator.skip(source)) return false
    tracePresentation(token, 'skip', { detail: source })
    return true
  }, [intentCoordinator])

  const introPresentationId = intentPresentation?.intent.kind === 'intro'
    ? intentPresentation.token.presentationId
    : null

  useEffect(() => {
    if (introPresentationId !== null) introSkipRef.current?.focus()
  }, [introPresentationId])

  useEffect(() => {
    if (introPresentationId === null) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || (event.key !== 'Enter' && event.key !== 'Escape')) return
      event.preventDefault()
      requestIntroSkip(event.key === 'Enter' ? 'enter' : 'escape')
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [introPresentationId, requestIntroSkip])

  const focusFirstLegalAction = useCallback(() => {
    const root = battleRootRef.current
    const next = root?.querySelector<HTMLButtonElement>(`[data-move-slot="${pendingSlotRef.current}"]:not(:disabled)`)
      ?? root?.querySelector<HTMLButtonElement>('.move-slot:not(:disabled)')
      ?? root?.querySelector<HTMLButtonElement>('[data-battle-action]:not(:disabled)')
    next?.focus()
  }, [])

  useEffect(() => {
    if (!rendererReady || phase !== 'playerChoice') return
    const restore = choiceInvokerRestoreRef.current
    choiceInvokerRestoreRef.current = null
    const invoker = restore?.invoker
    if (invoker?.isConnected && !invoker.disabled && invoker.tabIndex >= 0) {
      invoker.focus()
      return
    }
    if (restore?.replacementSelector) {
      const replacement = battleRootRef.current
        ?.querySelector<HTMLButtonElement>(restore.replacementSelector)
      if (replacement) {
        replacement.focus()
        return
      }
    }
    if (restore) {
      focusFirstLegalAction()
      return
    }
    if (choiceFocusRequestId === 0) return
    focusFirstLegalAction()
  }, [choiceFocusRequestId, focusFirstLegalAction, phase, rendererReady])

  useEffect(() => {
    if (phase === 'busy') battleFeedRef.current?.focus()
  }, [phase])

  useEffect(() => {
    const updateWindowClass = () => {
      setWindowClass(classifyBattleWindow(window.innerWidth, window.innerHeight))
    }
    window.addEventListener('resize', updateWindowClass)
    window.visualViewport?.addEventListener('resize', updateWindowClass)
    return () => {
      window.removeEventListener('resize', updateWindowClass)
      window.visualViewport?.removeEventListener('resize', updateWindowClass)
    }
  }, [])

  const restoreInvokerOrAction = useCallback((invoker: HTMLButtonElement | null) => {
    queueMicrotask(() => {
      if (invoker?.isConnected && !invoker.disabled && invoker.tabIndex >= 0) invoker.focus()
      else if (useBattleStore.getState().phase === 'playerChoice') focusFirstLegalAction()
    })
  }, [focusFirstLegalAction])

  const cardDisabledReason = mobCardDisabledReason(phase)
  const openMobCard = useCallback((side: Side, index: number, invoker: HTMLButtonElement) => {
    if (mobCardDisabledReason(useBattleStore.getState().phase)) return
    cardInvokerRef.current = invoker
    setCardView({ side, index })
  }, [])
  const closeMobCard = useCallback(() => {
    setCardView(null)
    const invoker = cardInvokerRef.current
    cardInvokerRef.current = null
    if (useBattleStore.getState().phase === 'playerChoice') restoreInvokerOrAction(invoker)
  }, [restoreInvokerOrAction])

  useEffect(() => {
    if (!cardView || cardDisabledReason === null) return
    choiceInvokerRestoreRef.current = { invoker: cardInvokerRef.current }
    setCardView(null)
    cardInvokerRef.current = null
  }, [cardDisabledReason, cardView])

  const cancelSwitch = useCallback(() => {
    const invoker = switchInvokerRef.current
    choiceInvokerRestoreRef.current = {
      invoker,
      replacementSelector: '[data-battle-action="switch"]:not(:disabled)',
    }
    useBattleStore.getState().setPhase('playerChoice')
    switchInvokerRef.current = null
  }, [])

  const handleRendererStateChange = useCallback((
    token: BattleSessionToken,
    next: BattleRendererState,
  ) => {
    if (!useBattleStore.getState().isSessionCurrent(token)) return
    setRendererState((current) => (
      current?.attemptId === next.attemptId
      && current.phase === next.phase
      && current.tier === next.tier
      && current.fallbackReason === next.fallbackReason
        ? current
        : next
    ))
    if (import.meta.env.DEV) baselineDriver()?.recordRendererState(next)
  }, [])

  const handleRendererFallback = useCallback((
    token: BattleSessionToken,
    reason: RendererFallbackReason,
  ) => {
    useBattleStore.getState().latchRendererCompatibility(token, reason)
  }, [])

  useEffect(() => {
    const onVisibility = () => {
      const hidden = document.hidden
      sessionLifecycle.setHidden(hidden)
      setDocumentHidden(hidden)
    }
    document.addEventListener('visibilitychange', onVisibility)
    onVisibility()
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [sessionLifecycle])

  useEffect(() => {
    const token = runtimeSession?.token
    if (!token || runtimeSession?.retired) return
    sessionLifecycle.activate(token)
    sessionLifecycle.setHidden(document.hidden)
  }, [
    runtimeSession?.token.battleSessionId,
    runtimeSession?.token.resultFingerprint,
    runtimeSession?.retired,
    sessionLifecycle,
  ])

  const initializeBattle = useCallback((forceNew = false): boolean => {
    let initializedToken: BattleSessionToken | null = null
    try {
    const createdAt = Date.now()
    const terrainSeed = context.foeTeam.map((card) => card.cardId).join('|')
    const battleSeed = baselineDriver()?.options.seed
      ?? `${context.playerTeam.map((card) => card.cardId).join('|')}#${terrainSeed}#${createdAt}`
    if (forceNew) {
      initializedToken = useBattleStore.getState().beginSessionAttempt({
        logicalBattleKey: context,
        battleSeed,
      })
    }
    if (baselineDriver()?.consumeFailure('battle-data')) {
      throw new Error('Injected battle data failure')
    }
    if (context.playerTeam.length === 0 || context.foeTeam.length === 0) {
      throw new Error('Battle requires non-empty player and foe teams')
    }
    // One product authority applies fixed items/abilities to both teams and player-only synergy.
    const prepared = PRODUCT_RUNTIME.prepareBattleTeams(
      context.playerTeam.map(buildBattleMobie),
      context.foeTeam.map(buildBattleMobie),
    )
    const players = prepared.playerTeam
    const foes = prepared.foeTeam
    const modifiers = prepared.playerModifiers
    // 場域地形（M8）：依 region.mode/terrains/randomTerrain 解析；隨機地形以 foe 隊伍 cardId 當 seed
    // 決定論抽（同一場遭遇穩定、不隨 re-render 變動）。arena/無地形＝空＝中性。
    const region = context.regionId ? lookupRegion(context.regionId) : null
    // M14.0：本場 rng 種子＝雙方 cardId + 開戰時刻（每場唯一、可寫入回放 header 供重模擬）。
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
      forceNew,
      attemptToken: initializedToken ?? undefined,
    })
    initializedToken = ensured.token
    sessionLifecycle.activate(ensured.token)
    if (forceNew && baselineDriver()?.consumeFailure('retry-init')) {
      throw new Error('Injected retry initialization failure')
    }
    if (!ensured.created) {
      useBattleStore.getState().completeInterruptedIntentOnce(ensured.token)
      return true
    }
    setPendingSwitch(null)
    setChainSeq(null)
    setCardView(null)
    const introIntent: IntroIntent = {
      kind: 'intro',
      id: 'intro',
      foeEntrance: { id: 'intro:foe-entrance', message: `對手派出了 ${foes[0].nameZh}！` },
      playerEntrance: { id: 'intro:player-entrance', message: `上吧，${players[0].nameZh}！` },
      terrain: terrainDefs.length > 0
        ? {
            banner: `${terrainDefs.map((d) => d.icon).join('')} 場域地形：${terrainDefs.map((d) => d.name).join(' + ')}`,
            feed: [{
              id: 'intro:terrain',
              message: `場域地形：${terrainDefs.map((d) => `${d.icon}${d.name}`).join(' + ')}（影響對應屬性招式威力）`,
            }],
          }
        : null,
      synergy: modifiers.length > 0
        ? {
            banner: `✦ 羈絆發動！ ${modifiers.map((m) => m.icon).join(' ')}`,
            feed: modifiers.map((modifier, index) => ({
              id: `intro:synergy:${index}`,
              message: `羈絆：${modifier.label}`,
            })),
          }
        : null,
    }
    const initializedBattle = useBattleStore.getState().battle
    if (!initializedBattle) throw new Error('Battle initialization produced no canonical state')
    void submitIntent(introIntent, battleDisplaySnapshot(initializedBattle), `${ensured.battleSeed}:intro`)
    return true
    } catch (error) {
      const store = useBattleStore.getState()
      if (initializedToken) {
        store.fenceSession(initializedToken)
        sessionLifecycle.end(initializedToken, 'retry')
      }
      useBattleStore.getState().failBattleInit(error)
      return false
    }
  }, [context, sessionLifecycle, submitIntent])

  // 初始化：建出雙方 3 隻隊伍，進場。StrictMode 重跑只會 reuse 同一 logical session。
  useEffect(() => {
    if (initedRef.current) return
    initedRef.current = true
    setBattleDataReady(initializeBattle(false))
  }, [context.foeTeam.length, context.playerTeam.length, initializeBattle])

  useEffect(() => {
    baselineDriver()?.setActivity(
      phase === 'qte'
      || phase === 'mash'
      || phase === 'statusQte'
      || phase === 'defenseQte'
      || phase === 'chainQte'
      || phase === 'starQte'
      || phase === 'busy',
    )
  }, [phase])

  // 低血量緊張度 → BGM 濾波/警報（依我方在場 HP）
  useEffect(() => {
    if (!battle || !runtimeSession || runtimeSession.retired) return
    const a = battle.player.members[battle.player.activeIndex]
    if (a && a.maxHp > 0) {
      battleBgmSession.set(runtimeSession.token, 1 - Math.max(0, a.currentHp) / a.maxHp)
    }
  }, [battle, runtimeSession])

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
    cueId: string,
  ) => {
    if (!sessionLifecycle.ownsPresentation(cueContext.token)) return
    const store = useBattleStore.getState
    const delay = (ms: number) => cueContext.clock.wait(ms, cueContext.signal)
    const playAudio = (callback: () => void) => battleAudioSession.play(cueContext.token, callback)
    const setMemberHp = (side: Side, index: number, hp: number) =>
      store().presentationSetMemberHp(cueContext.token, side, index, hp)
    const setActiveIndex = (side: Side, index: number) =>
      store().presentationSetActiveIndex(cueContext.token, side, index)
    const setBanner = (value: string | null) => store().presentationSetBanner(cueContext.token, value)
    const pushFeed = (message: string) => store().presentationPushFeed(
      cueContext.token,
      resultFeedInput(cueId, message),
    )
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
      playAudio(() => audio.play('faint'))
      haptic('faint')
      pushFeed(`${prefix}${m.nameZh} 倒下了！`)
      await delay(620)
    } else if (e.type === 'heal') {
      const m = monAt(b0, e.side, e.index)
      const src = getItem(e.source) ?? getAbility(e.source)
      setMemberHp(e.side, e.index, e.hpAfter)
      fxRef.current?.burst({ ...FX_POS[e.side], color: '#4ade80', count: 12, power: 1, kind: 'spark' })
      playAudio(() => audio.play('select'))
      const prefix = e.side === 'foe' ? '對手的 ' : ''
      setBanner(`${src?.icon ?? '✨'} ${prefix}${m.nameZh} 回復了 ${e.amount} HP`)
      pushFeed(`${prefix}${m.nameZh} 回復 ${e.amount} HP（${src?.name ?? e.source}）`)
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
      playAudio(() => audio.play('select'))
      await delay(540)
      playMoveFx(fxRef.current, recipe, FX_POS[e.side], FX_POS[e.side])
      playAudio(() => audio.playMoveSound(recipe.sound))
      if (e.effectKind === 'heal' && e.hpAfter != null) {
        setMemberHp(e.side, e.index, e.hpAfter)
        playAudio(() => audio.play('super'))
        setBanner(`✨ ${e.label}　+${e.healAmount} HP`)
      } else if (e.effectKind === 'buff') {
        playAudio(() => audio.play('super'))
        setBanner(`▲ ${e.label}（${e.remaining} 回合）`)
      } else {
        playAudio(() => audio.play('super'))
        setBanner(`🌿 ${e.label}`)
      }
      pushFeed(`${prefix}${m.nameZh}：${e.label}`)
      await delay(820)
      setBanner(null)
      await delay(140)
    } else if (e.type === 'wildAccident') {
      if (e.kind === 'terrainShift' && e.terrainId) {
        const def = lookupTerrain(e.terrainId)
        setBanner(`🌀 野外意外：地形突變 → ${def ? `${def.icon}${def.name}` : e.terrainId}！`)
        pushFeed(`地形突變！場域變為 ${def?.name ?? e.terrainId}`)
        const shiftColor = juiceRef.current === 'off' ? '#a07aff' : resolveTerrainPalette([e.terrainId]).particleColor
        fxRef.current?.flash(shiftColor, 0.35)
        fxRef.current?.ring({ nx: 0.5, ny: 0.42, color: shiftColor })
        playAudio(() => audio.play('super'))
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
        if (!reducedMotionRef.current) {
          void rootShake.start({ x: [0, -8, 6, 0], transition: { duration: 0.3 } })
        }
        playAudio(() => audio.play('hit'))
        haptic('hit')
        setBanner(`💥 野外意外：亂入野生襲擊 ${prefix}${m.nameZh}！`)
        pushFeed(`亂入野生襲擊 ${prefix}${m.nameZh}（-${e.amount}）`)
        await delay(820)
        clearFx()
        setBanner(null)
        await delay(140)
      }
    } else if (e.type === 'activeChanged') {
      setActiveIndex(e.side, e.toIndex)
      stageRef.current?.enter(e.side)
      const m = monAt(b0, e.side, e.toIndex)
      const prefix = e.side === 'foe' ? '對手的 ' : ''
      if (e.forced) {
        store().presentationSetCommandNotice(cueContext.token, {
          kind: 'forced-switch',
          text: `${prefix}${m.nameZh} 因夥伴倒下自動上場`,
        })
      }
      fxRef.current?.ring({ ...FX_POS[e.side], color: '#ffffff' })
      if (e.side === 'player') fxRef.current?.flash('#ffffff', 0.3)
      playAudio(() => audio.play('switch'))
      setBanner(e.side === 'player' ? `上吧，${m.nameZh}！` : `對手派出了 ${m.nameZh}！`)
      pushFeed(e.forced ? `${prefix}${m.nameZh} 因夥伴倒下自動上場` : `${prefix}${m.nameZh} 換上場`)
      await delay(640)
      setBanner(null)
      await delay(120)
    } else if (e.type === 'switchDefenseResolved') {
      const pct = Math.round((1 - e.damageMult) * 100)
      const label = e.defenseQuality === 'perfect' ? '完美防禦！'
        : e.defenseQuality === 'good' ? '防禦成功！'
          : e.defenseQuality === 'normal' ? '勉強防禦' : '防禦失敗…'
      setBanner(pct > 0 ? `${label}　減傷 ${pct}%` : label)
      pushFeed(`${label}（減傷 ${pct}%）`)
      await delay(640)
      setBanner(null)
      await delay(110)
    } else if (e.type === 'random' && e.event.type === 'supportRoulette') {
      const outcome = e.event.outcome as SupportOutcome
      setSupport(outcome)
      playAudio(() => audio.play('select'))
      await delay(950)
      playAudio(() => audio.play(outcome === 'dud' ? 'select' : 'super'))
      pushFeed(`支援輪盤：${SUPPORT_LABEL[outcome]}`)
      await delay(800)
      setSupport(null)
      await delay(150)
    } else if (e.type === 'battleEnded' && e.reason === 'timeout') {
      setBanner('達回合上限！依剩餘血量判定勝負')
      pushFeed('回合數達上限，依雙方剩餘血量判定勝負')
      await delay(1150)
      setBanner(null)
      await delay(150)
    } else if (e.type === 'chainOpportunity') {
      setBanner('🔗 連鎖就緒！')
      pushFeed('連鎖槽集滿！可發動連鎖攻擊')
      playAudio(() => audio.play('super'))
      fxRef.current?.flash('#7ae0ff', 0.3)
      await delay(680)
      setBanner(null)
      await delay(120)
    } else if (e.type === 'chainHit') {
      setCombo(e.comboCount)
      fxRef.current?.burst({ ...FX_POS.foe, color: '#7ae0ff', count: 12, power: 1.2, kind: 'spark' })
      playAudio(() => audio.play('select'))
      await delay(180)
    } else if (e.type === 'comboCast') {
      setBanner(`${e.icon} 合體技「${e.name}」！`)
      const eff = e.castKind === 'infuseTerrain' ? '灌注場域' : e.castKind === 'teamBuff' ? '全隊增益' : '弱化敵方'
      pushFeed(`${e.icon} 合體技「${e.name}」發動：${eff}（${e.remaining} 回合）`)
      playAudio(() => audio.play('crit'))
      fxRef.current?.flash('#ffe14a', 0.6)
      fxRef.current?.ring({ ...FX_POS.player, color: '#ffe14a' })
      fxRef.current?.burst({ ...FX_POS.foe, color: '#ff7ae0', count: 30, power: 1.8, kind: 'spark' })
      if (!reducedMotionRef.current) {
        void rootShake.start({ x: [0, -16, 14, -10, 0], transition: { duration: 0.42 } })
      }
      await delay(760)
      setBanner(null)
      await delay(140)
    }
  }, [rootShake, sessionLifecycle])

  const createCuePorts = useCallback((): BattleCuePorts => ({
    scene: {
      begin: (cue, cueContext) => {
        if (!sessionLifecycle.ownsPresentation(cueContext.token)) return
        stageRef.current?.lunge(cue.attackerSide)
      },
      impact: async (cue, cueContext) => {
        if (!sessionLifecycle.ownsPresentation(cueContext.token)) return
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
      reaction: (cue, cueContext) => {
        if (!sessionLifecycle.ownsPresentation(cueContext.token)) return
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
        if (!reducedMotionRef.current) {
          void rootShake.start({ x: [0, -mag, mag * 0.8, -mag * 0.5, 0], transition: { duration: 0.34 } })
        }
        stageRef.current?.hitReact(e.targetSide, strong ? 1.6 : 1)
      },
      hitStop: (cue, cueContext) => {
        if (!sessionLifecycle.ownsPresentation(cueContext.token)) return
        const e = cue.event
        if (e.missed || e.amount <= 0 || juiceRef.current !== 'full' || reducedMotionRef.current) return
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
        if (!sessionLifecycle.ownsPresentation(cueContext.token)) return
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
        const pushFeed = (message: string) => store.presentationPushFeed(
          cueContext.token,
          resultFeedInput(cue.id, message),
        )
        if (e.missed) {
          setBanner('攻擊沒有命中…')
          pushFeed(`${cue.attacker.nameZh} 的攻擊落空了！`)
        } else if (e.effectiveness === 0) {
          setBanner('沒有效果…')
          pushFeed(`對 ${cue.defender.nameZh} 完全沒有效果…`)
        } else {
          const bits: string[] = []
          if (e.crit) bits.push('會心一擊！')
          if (e.effectivenessText) bits.push(e.effectivenessText)
          setBanner(bits.join('　') || null)
          const projected = store.presentation?.battle
          const sourceAttacker = projected?.[e.attackerSide].members[e.attackerIndex] ?? cue.attacker
          const sourceDefender = projected?.[e.targetSide].members[e.targetIndex] ?? cue.defender
          const sources = damageEffectSourceLabels(sourceAttacker, sourceDefender, e.effectiveness)
          pushFeed(`對 ${cue.defender.nameZh} 造成 ${e.amount} 點傷害${sources.length > 0 ? `（${sources.join('；')}）` : ''}`)
        }
        tracePresentation(cueContext.token, 'feed', { cueId: cue.id, detail: 'result' })
      },
      clear: (_cue, cueContext) => {
        useBattleStore.getState().presentationClearTransient(cueContext.token)
      },
    },
    audio: {
      playAttack: (cue, cueContext) => {
        battleAudioSession.play(cueContext.token, () => audio.play('attack'))
        tracePresentation(cueContext.token, 'audio', { cueId: cue.id, detail: 'attack' })
      },
      playImpact: (cue, cueContext) => {
        const e = cue.event
        if (e.missed || e.amount <= 0) return
        battleAudioSession.play(
          cueContext.token,
          () => audio.play(e.crit ? 'crit' : e.effectiveness >= 2 ? 'super' : 'hit'),
        )
        tracePresentation(cueContext.token, 'audio', { cueId: cue.id, detail: 'impact' })
      },
      playMoveSound: (cue, cueContext) => {
        const e = cue.event
        if (e.missed || e.amount <= 0) return
        const sound = resolveFx(cue.move).sound
        battleAudioSession.play(cueContext.token, () => audio.playMoveSound(sound))
        tracePresentation(cueContext.token, 'audio', { cueId: cue.id, detail: `move:${sound}` })
      },
    },
    haptic: {
      impact: (cue, cueContext) => {
        if (!sessionLifecycle.ownsPresentation(cueContext.token)) return
        const e = cue.event
        if (e.missed || e.amount <= 0) return
        haptic(e.crit ? 'crit' : e.effectiveness >= 2 ? 'superEffective' : 'hit')
      },
    },
    legacy: {
      play: (cue, cueContext) => playLegacyEvent(cue.before, cue.event, cueContext, cue.id),
    },
    action: {
      starPrelude: async (_cue, cueContext) => {
        if (!sessionLifecycle.ownsPresentation(cueContext.token)) return
        const store = useBattleStore.getState()
        const projectedBattle = store.presentation?.battle
        if (!projectedBattle) throw new Error('Star prelude requires a current presentation')
        store.presentationPushFeed(cueContext.token, {
          id: 'input:star-consumed',
          text: '星擊能量已消耗，重新開始蓄力',
          kind: 'system',
        })
        await cueContext.clock.race(
          baselineDriver()?.checkpoint('action:star', 'star') ?? Promise.resolve(),
          cueContext.signal,
        )
        if (!sessionLifecycle.ownsPresentation(cueContext.token)) return
        const caster = projectedBattle.player.members[projectedBattle.player.activeIndex]
        const finisher = caster.moves[0] ?? caster.move
        battleAudioSession.play(cueContext.token, () => audio.play('crit'))
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
        if (!reducedMotionRef.current) {
          void rootShake.start({ x: [0, -20, 18, -14, 10, 0], transition: { duration: 0.5 } })
        }
        await cueContext.clock.wait(620, cueContext.signal)
        fxRef.current?.burst({ ...FX_POS.foe, color: '#ff7ae0', count: 40, power: 2, kind: 'spark' })
      },
      chainPrelude: async (cue, cueContext) => {
        if (!sessionLifecycle.ownsPresentation(cueContext.token)) return
        const store = useBattleStore.getState()
        store.presentationSetBanner(cueContext.token, '🔗 連鎖攻擊！')
        store.presentationPushFeed(cueContext.token, {
          id: 'input:chain-consumed',
          text: '連鎖能量已消耗，重新開始蓄力',
          kind: 'system',
        })
        battleAudioSession.play(cueContext.token, () => audio.play('crit'))
        tracePresentation(cueContext.token, 'audio', { cueId: cue.id, detail: 'chain' })
        fxRef.current?.flash('#7ae0ff', 0.4)
        await cueContext.clock.wait(cue.timingMs, cueContext.signal)
      },
      chainCleanup: async (cue, cueContext) => {
        await cueContext.clock.wait(cue.timingMs, cueContext.signal)
        if (!sessionLifecycle.ownsPresentation(cueContext.token)) return
        useBattleStore.getState().presentationSetCombo(cueContext.token, null)
      },
      outcome: async (cue, cueContext) => {
        if (!sessionLifecycle.ownsPresentation(cueContext.token)) return
        const store = useBattleStore.getState()
        store.presentationSetCommandNotice(cueContext.token, {
          kind: cue.event.reason === 'timeout' ? 'timeout' : 'outcome',
          text: cue.event.reason === 'timeout'
            ? '達回合上限，依剩餘 HP 判定勝負'
            : cue.event.winner === 'player' ? '戰鬥勝利' : '戰鬥失利',
        })
        if (cue.event.reason === 'timeout') {
          store.presentationSetBanner(cueContext.token, '達回合上限！依剩餘血量判定勝負')
          store.presentationPushFeed(cueContext.token, {
            id: `${cue.id}:timeout`,
            text: '回合數達上限，依雙方剩餘血量判定勝負',
            kind: 'result',
          })
          tracePresentation(cueContext.token, 'feed', { cueId: cue.id, detail: 'timeout' })
          await cueContext.clock.wait(1150, cueContext.signal)
          store.presentationSetBanner(cueContext.token, null)
          await cueContext.clock.wait(150, cueContext.signal)
        }
        await cueContext.clock.wait(1100, cueContext.signal)
      },
    },
  }), [playLegacyEvent, rootShake, sessionLifecycle])

  const presentationCueHandler = useMemo(
    () => new LegacyBattleCueHandler(createCuePorts()),
    [createCuePorts],
  )

  const resetPresentationVisuals = useCallback((token: PresentationToken) => {
    if (!sessionLifecycle.ownsPresentation(token)) return
    if (token.purpose === 'turn') useBattleStore.getState().presentationClearTransient(token)
    else useBattleStore.getState().intentSetBanner(token, null)
    cinematicRef.current?.resume()
    stageRef.current?.resetPresentation()
    fxRef.current?.clear()
    damageRef.current?.clear()
    rootShake.stop()
    rootShake.set({ x: 0, scale: 1 })
    vibrate(0)
  }, [rootShake, sessionLifecycle])
  resetPresentationRef.current = resetPresentationVisuals

  const presentationDirector = useMemo(() => new BattleDirector({
    handler: presentationCueHandler,
    intentHandler: intentPresenter,
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
      degraded: (_error, job) => {
        if (job.kind === 'turn') resetPresentationVisuals(job.token)
      },
      reset: (job) => {
        if (!sessionLifecycle.ownsPresentation(job.token)) return
        if (job.kind === 'intent') {
          useBattleStore.getState().intentSetBanner(job.token, null)
        } else {
          cinematicRef.current?.resume()
          useBattleStore.getState().presentationClearTransient(job.token)
        }
      },
    },
  }), [intentPresenter, presentationCueHandler, resetPresentationVisuals, sessionLifecycle])
  presentationDirectorRef.current = presentationDirector

  const submitTurn = useCallback(async (input: ReplayInput) => {
    const before = useBattleStore.getState().battle
    if (!before) return

    if (!turnCoordinatorRef.current) {
      turnCoordinatorRef.current = new BattleTurnCoordinator({
        acquireToken: () => useBattleStore.getState().acquireTurnPresentationToken(),
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
          const injectResolverFailure = baselineDriver()?.consumeFailure('resolve') ?? false
          const turnRng = () => {
            rngCalls += 1
            return sessionRng()
          }
          const preparedCase = baselineDriver()?.activeTransactionCase()
          if (injectResolverFailure) {
            turnRng()
            throw new Error('Injected resolver failure after RNG consumption')
          }
          const { nextState, events } = resolveTurn(
            current,
            battleActionFromReplayInput(turnInput),
            {
              rng: turnRng,
              ext: PRODUCT_RUNTIME.turnExtensions,
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
          const recordEvents = baselineDriver()?.consumeFailure('recorder')
            ? new Proxy(events, {
                get(target, property, receiver) {
                  if (property === Symbol.iterator) throw new Error('Injected recorder failure')
                  return Reflect.get(target, property, receiver)
                },
              })
            : events
          const status = currentStore.tryRecordTurnOnce(token, turnInput, recordEvents)
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
            sessionLifecycle.beginPresentation(token)
            tracePresentation(token, 'begin', {
              detail: inputKind(turnInput, current),
              turn: current.turn,
            })
          },
          isCurrent: (token) => useBattleStore.getState().isPresentationCurrent(token),
          commit: (token, resolution) => {
            const store = useBattleStore.getState()
            const result = store.commitTurn(token, resolution)
            if (!result.committed) {
              sessionLifecycle.finishPresentation(token)
              return false
            }
            tracePresentation(token, 'commit', {
              detail: inputKind(resolution.input, resolution.before),
              turn: resolution.nextState.turn,
            })
            if (result.outcome) {
              const outcomeAudio = result.outcome.winner === 'player' ? 'victory' : 'defeat'
              battleAudioSession.play(token, () => audio.play(outcomeAudio))
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
            sessionLifecycle.finishPresentation(token)
            return true
          },
          cancel: (token, reason) => {
            resetPresentationVisuals(token)
            useBattleStore.getState().cancelPresentation(token, 'playerChoice')
            sessionLifecycle.cancelPresentation(token)
            tracePresentation(token, 'cancel', {
              detail: reason,
              turn: useBattleStore.getState().battle?.turn,
            })
          },
          resolveFailed: (token, error) => {
            useBattleStore.getState().failTurnOnce(token, error)
          },
          recordFailed: (token, error) => {
            useBattleStore.getState().recordFailedOnce(token, error)
          },
        },
      })
    }

    await turnCoordinatorRef.current.submit(before, input)
  }, [presentationDirector, resetPresentationVisuals, send, sessionLifecycle])

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
    const maxHits = PRODUCT_RUNTIME.turnExtensions.chain.maxHits
    const participants = chainEligible(b.player, maxHits)
    if (participants.length === 0) return
    audio.play('select')
    setChainSeq({ participants, step: 0, hits: [] })
    useBattleStore.getState().setPhase('chainQte')
  }, [])

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

  // Partner gameplay authority 先原子提交 reveal/team status 與每場一次預算；
  // intent coordinator 只拿 display receipt 演出，不持有回合、能量、recorder 或 outcome 權限。
  const activatePartnerSkill = useCallback((skill: PartnerSkillDef) => {
    const store = useBattleStore.getState()
    const battleState = store.battle
    if (!battleState) return
    const statuses = teamBuffStatuses(skill)
    const revealFoeIndex = skill.reveal ? battleState.foe.activeIndex : undefined
    const receipt = store.commitPartnerSkillOnce({
      skillId: skill.id,
      revealFoeIndex,
      teamStatuses: statuses,
    })
    if (!receipt) return

    audio.play('select')
    const revealedName = receipt.revealedFoeIndex === null
      ? null
      : battleState.foe.members[receipt.revealedFoeIndex]?.nameZh
    const intent: PartnerSkillResultIntent = {
      kind: 'partner-result',
      id: `partner:${skill.id}`,
      skillId: skill.id,
      banner: receipt.teamStatusCount > 0 ? `${skill.icon} ${skill.name}！` : '🔍 看穿了對手！',
      feed: {
        id: `partner:${skill.id}:result`,
        message: receipt.teamStatusCount > 0
          ? `${skill.name}！全隊氣勢提升（攻擊・特攻 ↑）`
          : `看穿了對手的 ${revealedName ?? 'Mobie'}！招式與數值現形`,
      },
      effects: [
        ...(receipt.revealedFoeIndex === null ? [] : ['reveal-foe' as const]),
        ...(receipt.teamStatusCount > 0 ? ['team-status' as const] : []),
      ],
    }
    const committedStore = useBattleStore.getState()
    if (!committedStore.battle) return
    void submitIntent(
      intent,
      battleDisplaySnapshot(committedStore.battle),
      `${committedStore.session?.battleSeed ?? skill.id}:partner:${skill.id}`,
    )
  }, [submitIntent])

  const retryBattle = useCallback(() => {
    if (retryingRef.current) return
    retryingRef.current = true
    setRetrying(true)
    setBattleDataReady(false)
    setRendererState(null)
    const store = useBattleStore.getState()
    const previous = store.session?.token
    if (previous) {
      store.fenceSession(previous)
      sessionLifecycle.end(previous, 'retry')
    }
    turnCoordinatorRef.current = null
    setBattleDataReady(initializeBattle(true))
    retryingRef.current = false
    setRetrying(false)
  }, [initializeBattle, sessionLifecycle])

  const leaveBattle = useCallback(() => {
    const store = useBattleStore.getState()
    const token = store.session?.token
    if (token) {
      store.fenceSession(token)
      sessionLifecycle.end(token, 'leave')
    }
    send({ type: 'ABORT_BATTLE' })
  }, [send, sessionLifecycle])

  if (!battleDataReady || !battle || !runtimeSession) {
    return battleError
      ? <BattleErrorPanel error={battleError} retrying={retrying} onRetry={retryBattle} onLeave={leaveBattle} />
      : (
          <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>
            <BattleRenderGate state="battle-data-loading" />
          </div>
        )
  }

  const player = battle.player.members[battle.player.activeIndex]
  const foe = battle.foe.members[battle.foe.activeIndex]
  const switchProjection = switchAvailability(
    battle.player.members,
    battle.player.activeIndex,
    lockedIndex,
  )
  const cardMember = cardView ? battle[cardView.side].members[cardView.index] : null
  // M9 連鎖固定存在；槽住 reducer 的 battle.chainGauge（暫態）。
  const chainMax = PRODUCT_RUNTIME.turnExtensions.chain.gaugeFull

  return (
    <motion.div
      ref={battleRootRef}
      className={`battle-shell${juice !== 'off' ? ' battle-enter' : ''}`}
      data-battle-shell
      data-window-class={windowClass}
      data-reduced-motion={reducedMotion ? 'true' : 'false'}
      animate={rootShake}
    >
      <section
        ref={battleStageElementRef}
        className="battle-stage"
        data-battle-stage
        aria-label="戰鬥場景"
      >
      {/* Three-free host owns lazy next boot and one-way compatibility fallback. */}
      <BattleSceneHost
        key={currentRendererAttemptId!}
        ref={stageRef}
        snapshot={{
          player,
          foe,
          palette: juice === 'off' ? undefined : terrainPalette,
          outcome: battle.winner,
        }}
        sessionToken={runtimeSession.token}
        preference={requestedGraphics}
        paused={documentHidden}
        reducedMotion={reducedMotion}
        latchedFallback={runtimeSession.rendererFallbackReason}
        onStateChange={handleRendererStateChange}
        onFallback={handleRendererFallback}
        devFailure={import.meta.env.DEV ? rendererFailure : null}
        onRenderedFrame={import.meta.env.DEV ? (at) => baselineDriver()?.recordRenderedFrame(at) : undefined}
        onRendererDiagnostics={import.meta.env.DEV ? (resources) => {
          const driver = baselineDriver()
          driver?.recordRendererResources(resources)
          const pools = fxRef.current?.diagnostics?.()
          if (pools) driver?.recordPools(pools)
        } : undefined}
      />
      {/* EXT.3 天氣持續層（z2，介於 R3F 與 FxCanvas）：off 不掛＝零 rAF、嚴格回 M22 基線。 */}
      {juice !== 'off' && (
        <WeatherCanvas
          emitter={terrainPalette.emitter}
          color={terrainPalette.particleColor}
          sparkAccent={terrainPalette.sparkAccent}
          overlay={terrainPalette.overlay}
          density={weatherDensity}
          paused={documentHidden}
          onPoolDiagnostics={import.meta.env.DEV ? (pool) => baselineDriver()?.recordPools({ weather: pool }) : undefined}
        />
      )}
      <FxCanvas ref={fxRef} reducedMotion={reducedMotion} paused={documentHidden} />
      {/* EXT.1.b：juice≠off 用富表現飄字層（圖示優先）；off 回退既有 FloatDamage＝M22 基線、DOM 零新增 wrapper。 */}
      {juice === 'off' ? <FloatDamage hitFx={hitFx} /> : <DamageNumbers ref={damageRef} />}

      {/* 前景 HUD（疊在 3D 之上） */}
      <div className="battle-stage__hud">
      <div className="battle-head-safe battle-head-safe--player" data-head-safe="player" aria-hidden="true" />
      <div className="battle-head-safe battle-head-safe--foe" data-head-safe="foe" aria-hidden="true" />
      <FieldStatusBar
        terrainIds={battle.field.terrainEffects.current}
        initiative={initiativePresentation(player.spe, foe.spe)}
        turn={battle.turn}
        fieldMarks={battle.field.comboCastEffects}
        windowClass={windowClass}
      />
      {intentPresentation?.intent.kind === 'intro' && (
        <button
          ref={introSkipRef}
          type="button"
          className="btn btn--ghost battle-intro-skip"
          onClick={() => { requestIntroSkip('touch') }}
        >
          跳過開場
        </button>
      )}
      {battleError && (
        <BattleErrorPanel
          error={battleError}
          retrying={retrying}
          onRetry={retryBattle}
          onLeave={leaveBattle}
        />
      )}

      {/* 敵方：HP 牌與隊伍狀態（畫面上方右側） */}
      <div className="battle-combatant-hud battle-combatant-hud--foe">
        <div className="combat-hud combat-hud--foe">
          <HpPlate
            mon={foe}
            owner={false}
            label={`對手的 ${foe.nameZh}`}
            interactive={cardDisabledReason === null}
            disabledReason={cardDisabledReason}
            onOpen={(invoker) => openMobCard('foe', battle.foe.activeIndex, invoker)}
          />
          <TeamTray members={battle.foe.members} activeIndex={battle.foe.activeIndex} align="end"
            interactive={cardDisabledReason === null}
            disabledReason={cardDisabledReason}
            onPick={(index, invoker) => openMobCard('foe', index, invoker)} />
          <SideStatusRail side="foe" statuses={battle.field.enemyStatuses} />
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
      <div className="battle-combatant-hud battle-combatant-hud--player">
        <div className="combat-hud combat-hud--player">
          <HpPlate
            mon={player}
            owner
            label={player.nameZh}
            interactive={cardDisabledReason === null}
            disabledReason={cardDisabledReason}
            onOpen={(invoker) => openMobCard('player', battle.player.activeIndex, invoker)}
          />
          <TeamTray members={battle.player.members} activeIndex={battle.player.activeIndex} align="start"
            interactive={cardDisabledReason === null}
            disabledReason={cardDisabledReason}
            onPick={(index, invoker) => openMobCard('player', index, invoker)} />
          <SideStatusRail side="player" statuses={battle.field.teamStatuses} />
        </div>
      </div>

      </div>
      </section>

      {/* 底部控制區 */}
      <section
        ref={commandDeckRef}
        className="battle-command-deck"
        aria-label="戰鬥指令"
      >
        <div
          ref={commandHeaderRef}
          className="battle-command-deck__header"
        >
        <div className="battle-resource-strip" aria-label="戰鬥資源">
        <ResourceAction
          kind="star"
          current={energy}
          max={100}
          activating={phase === 'starQte' || activeResource === 'star'}
          actionable={phase === 'playerChoice' && rendererReady}
          onActivate={() => {
            if (starMode === 'off') void runStarStrike()
            else {
              audio.play('select')
              useBattleStore.getState().setPhase('starQte')
            }
          }}
        />
        <ResourceAction
          kind="chain"
          current={battle.chainGauge}
          max={chainMax}
          activating={phase === 'chainQte' || activeResource === 'chain'}
          actionable={phase === 'playerChoice' && rendererReady}
          onActivate={startChain}
        />
        </div>

        <BattleFeed ref={battleFeedRef} entries={log} />

        </div>
        <div
          className="battle-command-body"
          data-command-phase={phase}
          data-command-state={commandNotice?.kind ?? phase}
          aria-busy={phase === 'busy'}
        >

        {phase === 'playerChoice' && !rendererReady && (
          <div className="battle-command-disabled" role="status" aria-live="polite">
            <button className="btn" type="button" disabled>戰鬥畫面準備中</button>
            <span>資料已就緒；renderer ready 後才會開放指令。</span>
          </div>
        )}

        {phase === 'playerChoice' && rendererReady && (
          <motion.div className="battle-command-choice"
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
              showInitiative={false}
              active={cardView === null}
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
                availability={switchProjection}
                onOpen={(invoker) => {
                  audio.play('select')
                  switchInvokerRef.current = invoker
                  useBattleStore.getState().setPhase('switchSelect')
                }}
              />
            </div>
            {/* M17 夥伴技能固定存在；只顯示已習得技能，每場一次且不耗回合。 */}
            {partnerSkills.length > 0 && (
              <div className="row battle-partner-actions" style={{ gap: 8, justifyContent: 'center', flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 13, color: 'var(--text-dim)', fontWeight: 700 }}>✨ 夥伴技能</span>
                {partnerSkills.map((skill) => {
                  const used = partnerSkillIdsUsed?.has(skill.id) ?? false
                  return (
                    <motion.button
                      key={skill.id}
                      className="btn btn--ghost btn--sm"
                      data-battle-action="partner"
                      whileTap={used ? undefined : { scale: 0.95 }}
                      disabled={used}
                      title={skill.desc}
                      aria-label={`${skill.name}${used ? '，本場已使用' : `，${skill.desc}`}`}
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

        {rendererReady && (
          phase === 'qte'
          || phase === 'mash'
          || phase === 'statusQte'
          || phase === 'defenseQte'
          || phase === 'chainQte'
          || phase === 'starQte'
        ) && (
          <motion.div
            className="battle-input-surface"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            {phase === 'qte' && (
              <TimingBar
                paused={documentHidden}
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
              ? <RhythmTap paused={documentHidden} mode={interactMode} onDone={(acc) => onMashDone(rhythmToMashCount(acc))} />
              : <MashMeter paused={documentHidden} onDone={onMashDone} />)}
            {phase === 'statusQte' && (
              <TimingBar
                paused={documentHidden}
                hint="變化招！抓準時機強化效果（只影響強度、不影響成敗）"
                onResult={(actual) => {
                  const q = controlledQuality(actual)
                  if (q === 'perfect' || q === 'good') haptic('qteGood')
                  void runPlayerTurn(q, 0)
                }}
              />
            )}
            {phase === 'defenseQte' && (defenseMode !== 'off'
              ? <ShieldSwipe paused={documentHidden} mode={defenseMode} onResult={(q) => { if (pendingSwitch !== null) runSwitchTurn(pendingSwitch, controlledQuality(q)) }} />
              : (
                <TimingBar
                  paused={documentHidden}
                  hint="換人中！點擊停在正中可大幅減傷！"
                  onResult={(q) => { if (pendingSwitch !== null) runSwitchTurn(pendingSwitch, controlledQuality(q)) }}
                />
              ))}
            {phase === 'chainQte' && chainSeq && (
              <TimingBar
                paused={documentHidden}
                key={`chain-${chainSeq.step}`}
                hint={`🔗 連鎖 ${chainSeq.step + 1}/${chainSeq.participants.length}　${battle.player.members[chainSeq.participants[chainSeq.step]].nameZh}！抓準時機連續出擊`}
                onResult={(q) => onChainQteResult(controlledQuality(q))}
              />
            )}
            {phase === 'starQte' && (starMode === 'arcade'
              ? <RhythmTap paused={documentHidden} mode={starMode} onDone={() => { void runStarStrike() }} />
              : <HoldChargeRing paused={documentHidden} mode={starMode} onCharged={() => { void runStarStrike() }} />)}
          </motion.div>
        )}

        {phase === 'switchSelect' && rendererReady && (
          <SwitchSheet
            members={battle.player.members}
            legalIndices={switchProjection.legalIndices}
            onPick={(index) => {
              switchInvokerRef.current = null
              setPendingSwitch(index)
              useBattleStore.getState().setPhase('defenseQte')
            }}
            onCancel={cancelSwitch}
          />
        )}

        {(phase === 'busy' || phase === 'intro' || phase === 'won' || phase === 'lost' || phase === 'error') && (
          <div className="battle-command-busy" role="status">
            <span aria-hidden="true">•••</span>
            {commandNotice?.text
              ?? (phase === 'intro' ? '準備戰鬥'
                : phase === 'won' ? '戰鬥勝利'
                  : phase === 'lost' ? '戰鬥失利'
                    : phase === 'error' ? '戰鬥暫停'
                      : '正在結算本回合')}
          </div>
        )}
        </div>
      </section>

      {/* M16 資訊卡：點 HpPlate/TeamTray 開（自己全顯、對手深度遮罩待 M17 看穿） */}
      {cardDisabledReason === null && (
        <AnimatePresence>
          {cardView && cardMember && (
            <MobCard
              mon={cardMember}
              owner={cardView.side === 'player'}
              revealed={cardView.side === 'player' || revealedFoes.includes(cardView.index)}
              onClose={closeMobCard}
            />
          )}
        </AnimatePresence>
      )}

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
