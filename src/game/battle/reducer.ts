// 3v3 單打戰鬥純 reducer（M1.5a）——
// 不含任何 UI / 動畫字眼，只吐 domain events，方便單測與「一次算完、畫面慢慢演」。
// 設計真相：plan/01-architecture、plan/06-battle-reference、第二場 conclusion。

import type { BattleMobie, Move, TypeName, TerrainId } from '@/game/types'
import {
  resolveAttack,
  attackQteMultiplier,
  defenseMultiplier,
  playerActsFirst,
  type QteQuality,
} from '@/game/battle/engine'
import type { ExtBundle, DamageHook } from '@/game/ext/seams'
import { typeEffectiveness } from '@/game/data/typeChart'

export type Side = 'player' | 'foe'

/** 一方的隊伍：最多 3 隻 + 目前在場的索引（HP 跨換人持續、不自動回復） */
export interface BattleSide {
  members: BattleMobie[]
  activeIndex: number
}

/**
 * 場域狀態（M8，plan/11 §1 / plan/12 統一稱 fieldState）——戰鬥內暫態，不持久化、不回寫 Region/OwnedUnit。
 * M8 先有地形（terrainEffects）；M12 再補 teamStatuses/enemyStatuses/comboCastEffects。
 */
export interface FieldState {
  /**
   * 地形效果：分初始（開場決定/隨機抽，不變，供 UI 對照）vs 目前（攻擊結算讀此；
   * M11「地形突變」野外意外會改 current）。只存 id，倍率由注入的 resolver 解析（reducer 不認識地形語意）。
   */
  terrainEffects: {
    initial: TerrainId[]
    current: TerrainId[]
  }
  /**
   * 隊伍暫態狀態（M19.d 變化招首次填用，plan/12「fieldState」子欄）：玩家隊 / 對手隊各自的
   * 能力值增益清單。戰鬥內暫態（隨 BattleState，不持久化、不回寫 OwnedUnit）。每回合末遞減 remaining、歸零移除。
   * 攻擊傷害結算時 reducer 依此算 statusDamageMult 注入（engine 不認識狀態語意）。
   */
  teamStatuses: StatusEffect[]
  enemyStatuses: StatusEffect[]
}

/** 一個生效中的能力值增益（M19.d 變化招施加）；mult 即硬上限（不疊乘爆表，同 stat 刷新取 max）。 */
export interface StatusEffect {
  stat: 'atk' | 'def' | 'spa' | 'spd'
  mult: number
  remaining: number
  /** 來源招式 id（display 演出） */
  source: number
  label: string
}

/** 完整戰鬥狀態（canonical 戰鬥態；派生顯示態由 BattleScreen 自己維護） */
export interface BattleState {
  player: BattleSide
  foe: BattleSide
  /** 已解算的回合數，從 1 起算（支援輪盤「每 N 回合」M1.5g 會用到） */
  turn: number
  /** 勝方；null = 進行中 */
  winner: Side | null
  /** 場域狀態（M8）；無地形時 terrainEffects 為空陣列＝行為等同 M1.x */
  field: FieldState
  /**
   * 連鎖槽（M9，plan/09 §3）：玩家普攻命中累積、達 ext.chain.gaugeFull → emit chainOpportunity。
   * 戰鬥內暫態（隨 BattleState，不持久化）。連鎖模組關閉（ext.chain undefined）＝恆 0、不累積＝零殘留。
   */
  chainGauge: number
}

/** 一次連鎖出擊的「玩家宣告」：哪隻、QTE 品質（非權威傷害；reducer 重驗存活/目標後才結算）。 */
export interface ChainHit {
  attackerIndex: number
  quality: QteQuality
}

/** 玩家本回合的行動 */
export type BattleAction =
  | { type: 'ATTACK'; quality?: QteQuality; mashCount?: number; starStrike?: boolean; slotIndex?: number }
  | { type: 'SWITCH'; index: number; defenseQuality?: QteQuality }
  // M9 連鎖攻擊：單一 action 回提最多 maxHits 隻的 QTE 宣告；reducer 同步重驗+結算（plan/09 §3.2）。
  | { type: 'SUBMIT_CHAIN_RESULT'; hits: ChainHit[] }

/** 星擊 Finisher 的傷害倍率（能量滿槽放，必定會心） */
export const STAR_STRIKE_MULT = 3

/**
 * 一場戰鬥最多解算的回合數。超過仍未分勝負 → 依雙方剩餘血量比例判勝，
 * 避免屬性免疫/極低傷等情況造成「打不完」。
 */
export const MAX_TURNS = 30

/**
 * Domain events——純結果語意，不含 UI/動畫字眼。
 * BattleScreen 把它們映射成動畫＋音效 queue 依序消費。
 */
export type BattleEvent =
  | {
      type: 'damageApplied'
      attackerSide: Side
      attackerIndex: number
      targetSide: Side
      targetIndex: number
      amount: number
      missed: boolean
      crit: boolean
      effectiveness: number
      effectivenessText: string | null
      hpBefore: number
      hpAfter: number
      maxHp: number
      /** M19：本次實際使用的招式 id（display 演該招特效/名稱）；省略＝slot0/舊路徑 */
      resolvedMoveId?: number
    }
  | { type: 'memberFainted'; side: Side; index: number }
  // 回合末回血（M7 S4 道具/特性 turnEndTrigger 用，如剩飯）；source = 來源 id（道具/特性）
  | {
      type: 'heal'
      side: Side
      index: number
      amount: number
      hpBefore: number
      hpAfter: number
      maxHp: number
      source: string
    }
  | { type: 'activeChanged'; side: Side; fromIndex: number; toIndex: number; forced: boolean }
  | { type: 'switchDefenseResolved'; side: Side; index: number; defenseQuality: QteQuality; damageMult: number }
  | { type: 'battleEnded'; winner: Side; reason?: 'timeout' }
  | { type: 'random'; event: RandomEvent }
  // M9 連鎖：連鎖槽集滿、可發動連鎖（display 接此 → 對 eligible 隊友依序跑連續 QTE）。
  | { type: 'chainOpportunity'; maxHits: number; eligibleIndices: number[] }
  // M9 連鎖：連鎖中第 comboCount 段命中前 emit（display 演連段 FX / 連擊數字）；其傷害仍走 damageApplied。
  | { type: 'chainHit'; comboCount: number; attackerIndex: number }
  // M11 野外意外（wild-only，由注入的 wildEvents hook 觸發；reducer 不認識「野外」語意）。
  // terrainShift＝戰中地形突變（改 field.current）；intrusion＝亂入野生一次性非致命削血。
  | {
      type: 'wildAccident'
      kind: 'terrainShift' | 'intrusion'
      /** terrainShift：新地形 id */
      terrainId?: TerrainId
      /** intrusion：受擊方 / index / 削血量 / 之後 HP */
      side?: Side
      index?: number
      amount?: number
      hpAfter?: number
    }
  // M19.d 變化招：無傷害的主動戰術招施放（display 演「使出 X」+ 對應效果）。
  | {
      type: 'statusApplied'
      side: Side
      index: number
      /** 施放的變化招 id（display 取名/型別） */
      moveId: number
      effectKind: 'buff' | 'heal' | 'terrain'
      label: string
      /** buff 持續回合（heal/terrain 為 0） */
      remaining: number
      /** heal：回復量 + 回復後 HP（display setMemberHp + 演出） */
      healAmount?: number
      hpAfter?: number
      /** terrain：新設定的地形 id（display 更新 TerrainChip） */
      terrainId?: TerrainId
    }

/** 統一隨機事件（命中/會心/支援輪盤/球輪盤…）；reducer 隨機點全走它（plan/07） */
export interface RandomEvent {
  type: 'accuracy' | 'crit' | 'supportRoulette' | 'ballRoulette'
  actorId: string
  roll: number
  outcome: string
  source: string
}

export type SupportOutcome = 'attackUp' | 'crit' | 'ally' | 'dud'

/** 每幾回合觸發一次支援輪盤 */
export const SUPPORT_EVERY = 3

/** 支援輪盤亂數 → 獎項（攻擊UP / 必定會心 / 支援補刀 / 摃龜） */
export function supportOutcome(roll: number): SupportOutcome {
  if (roll < 0.3) return 'attackUp'
  if (roll < 0.55) return 'crit'
  if (roll < 0.8) return 'ally'
  return 'dud'
}

export interface TurnOptions {
  /** 隨機來源（命中/變異/暴擊/速度同值決勝），預設 Math.random */
  rng?: () => number
  /**
   * 注入的純能力包（plan/09 §0）：已啟用模組由 store 層 assembleExt 組好再傳入。
   * 預設不傳＝行為與 M1.x 完全一致。reducer 不認識「道具/羈絆」，只認識 hook（damageHooks/turnEndTriggers/chain）。
   */
  ext?: ExtBundle
  /**
   * 地形倍率解析器（M8，plan/11 §5）：依招式屬性 + 一組地形 id 回 power 倍率，如 rng 般注入。
   * reducer 自己帶入「目前地形」（field.terrainEffects.current），故 resolver 只認 (moveType, terrainIds)。
   * 預設不傳＝無地形＝×1（既有測試不動）。
   */
  terrainMultiplier?: (moveType: TypeName, terrainIds: TerrainId[]) => number
  /**
   * M11 野外意外（wild-only，注入；reducer 不認識「野外」語意）：每回合呼叫一次，
   * 依機率觸發意外、就地改 working state（地形突變/亂入削血）並回報 events。
   * 預設不傳＝無意外（既有測試/競技場不動）。意外的機率/地形池/效果全住注入的 hook（game/accidents.ts）。
   */
  wildEvents?: (ctx: { state: BattleState; rng: () => number }) => BattleEvent[]
}

export interface TurnResult {
  nextState: BattleState
  events: BattleEvent[]
}

// ── 建構 / 選取 ────────────────────────────────────────────────

/**
 * 由雙方隊伍建出初始戰鬥狀態（active=0、turn=1、未分勝負）。
 * `terrains`＝開場地形 id（M8，由 setup 依 region 解析；省略＝中性無地形＝行為等同 M1.x）。
 */
export function createBattleState(
  playerMembers: BattleMobie[],
  foeMembers: BattleMobie[],
  terrains: TerrainId[] = [],
): BattleState {
  return {
    player: { members: playerMembers, activeIndex: 0 },
    foe: { members: foeMembers, activeIndex: 0 },
    turn: 1,
    winner: null,
    field: { terrainEffects: { initial: [...terrains], current: [...terrains] }, teamStatuses: [], enemyStatuses: [] },
    chainGauge: 0,
  }
}

const other = (side: Side): Side => (side === 'player' ? 'foe' : 'player')

const activeOf = (state: BattleState, side: Side): BattleMobie =>
  state[side].members[state[side].activeIndex]

const unitId = (side: Side, index: number): string => `${side}:${index}`

/** 一方剩餘血量比例（隊員 currentHp 加總 / maxHp 加總），0..1；回合上限判勝用 */
function teamHpFraction(s: BattleSide): number {
  let cur = 0
  let max = 0
  for (const m of s.members) {
    cur += Math.max(0, m.currentHp)
    max += m.maxHp
  }
  return max > 0 ? cur / max : 0
}

/** 該方下一隻可上場（HP>0 且非目前在場）的索引，依序找；沒有回 -1 */
function nextLivingIndex(s: BattleSide): number {
  for (let i = 0; i < s.members.length; i++) {
    if (i !== s.activeIndex && s.members[i].currentHp > 0) return i
  }
  return -1
}

function cloneState(state: BattleState): BattleState {
  return {
    player: { members: state.player.members.map((m) => ({ ...m })), activeIndex: state.player.activeIndex },
    foe: { members: state.foe.members.map((m) => ({ ...m })), activeIndex: state.foe.activeIndex },
    turn: state.turn,
    winner: state.winner,
    field: {
      terrainEffects: {
        initial: [...state.field.terrainEffects.initial],
        current: [...state.field.terrainEffects.current],
      },
      teamStatuses: state.field.teamStatuses.map((s) => ({ ...s })),
      enemyStatuses: state.field.enemyStatuses.map((s) => ({ ...s })),
    },
    chainGauge: state.chainGauge,
  }
}

// ── 內部突變子（只作用在 cloneState 出來的 working 複本上）────────

interface AttackParams {
  rng: () => number
  qteMult?: number
  damageMult?: number
  forceCrit?: boolean
  /** 攻擊者索引（預設 active；支援補刀時指定待命隊友） */
  attackerIndex?: number
  /** M19：使用第幾槽招式（0–3，預設 0/slot0）。玩家由 action.slotIndex 帶入、對手由 chooseOpponentMove。 */
  moveIndex?: number
  /** RandomEvent 來源標記 */
  source?: string
  /** S3 傷害鉤（注入；hook 自行用 attacker 判定是否生效） */
  damageHooks?: DamageHook[]
  /** 地形倍率解析器（M8，注入）：依攻擊招式屬性回 power 倍率（讀 currentTerrains）；無＝×1 */
  terrainResolve?: (moveType: TypeName) => number
  /** M19.d：攻擊方隊伍生效中的能力值增益（依招式 category 取攻/特攻 buff）；無＝無增益 */
  offenseStatuses?: StatusEffect[]
  /** M19.d：防守方隊伍生效中的能力值增益（依招式 category 取防/特防 buff，減傷）；無＝無增益 */
  defenseStatuses?: StatusEffect[]
}

/**
 * 變化招能力值增益 → 傷害倍率（M19.d）：攻擊方攻/特攻 buff 乘上、防守方防/特防 buff 除下。
 * 折進既有 damageMult（與 qte/地形同位階），engine 不認識狀態語意（純倍率注入）。
 */
function statusDamageMult(
  category: 'physical' | 'special' | 'status',
  offense: StatusEffect[],
  defense: StatusEffect[],
): number {
  const offStat = category === 'physical' ? 'atk' : 'spa'
  const defStat = category === 'physical' ? 'def' : 'spd'
  let mult = 1
  for (const s of offense) if (s.stat === offStat) mult *= s.mult
  for (const s of defense) if (s.stat === defStat) mult /= s.mult
  return mult
}

/** 某方當前 active 倒下後的強制換人：依序送下一隻；無人可換則該方落敗、戰鬥結束。 */
function applyForcedSwitch(w: BattleState, side: Side, events: BattleEvent[]): void {
  const next = nextLivingIndex(w[side])
  if (next === -1) {
    w.winner = other(side)
    events.push({ type: 'battleEnded', winner: other(side) })
    return
  }
  const fromIndex = w[side].activeIndex
  w[side].activeIndex = next
  events.push({ type: 'activeChanged', side, fromIndex, toIndex: next, forced: true })
}

/** attackerSide 打 targetSide 的 active，套用傷害、推 events（含統一 RandomEvent）、必要時強制換 / 結束。 */
function performAttack(w: BattleState, attackerSide: Side, params: AttackParams, events: BattleEvent[]): void {
  const targetSide = other(attackerSide)
  const attackerIndex = params.attackerIndex ?? w[attackerSide].activeIndex
  const attacker = w[attackerSide].members[attackerIndex]
  const target = activeOf(w, targetSide)
  const targetIndex = w[targetSide].activeIndex
  const hpBefore = target.currentHp
  const source = params.source ?? 'attack'
  // M19：選定槽招式（terrain 倍率依此招屬性算）；缺省/超界 fallback slot0/過渡 .move。
  const move = attacker.moves[params.moveIndex ?? 0] ?? attacker.move
  // M19.d：變化招增益折進 damageMult（攻方攻擊向 buff 乘、守方防禦向 buff 除）。
  const statusMult = statusDamageMult(move.category, params.offenseStatuses ?? [], params.defenseStatuses ?? [])

  const result = resolveAttack(attacker, target, {
    rng: params.rng,
    qteMult: params.qteMult ?? 1,
    damageMult: (params.damageMult ?? 1) * statusMult,
    terrainMult: params.terrainResolve?.(move.type) ?? 1,
    forceCrit: params.forceCrit ?? false,
    damageHooks: params.damageHooks,
    moveIndex: params.moveIndex,
  })

  // 統一 RandomEvent：命中、會心
  const actorId = unitId(attackerSide, attackerIndex)
  events.push({
    type: 'random',
    event: { type: 'accuracy', actorId, roll: result.accuracyRoll, outcome: result.missed ? 'miss' : 'hit', source },
  })
  if (result.critRoll >= 0) {
    events.push({
      type: 'random',
      event: { type: 'crit', actorId, roll: result.critRoll, outcome: result.crit ? 'crit' : 'normal', source },
    })
  }

  target.currentHp = result.defenderHpAfter
  events.push({
    type: 'damageApplied',
    attackerSide,
    attackerIndex,
    targetSide,
    targetIndex,
    amount: result.damage,
    missed: result.missed,
    crit: result.crit,
    effectiveness: result.effectiveness,
    effectivenessText: result.effectivenessText,
    hpBefore,
    hpAfter: result.defenderHpAfter,
    maxHp: target.maxHp,
    resolvedMoveId: result.resolvedMoveId,
  })

  if (result.defenderFainted) {
    events.push({ type: 'memberFainted', side: targetSide, index: targetIndex })
    applyForcedSwitch(w, targetSide, events)
  }
}

// ── 變化招（M19.d，plan/17 §1.3）────────────────────────────────

/** 變化招強度 QTE 品質 → 持續回合加成（**只影響回合數不影響成敗**；夾 [MIN,MAX]＝硬上限）。 */
const STATUS_DURATION_BONUS: Record<QteQuality, number> = { perfect: 1, good: 0, normal: 0, weak: -1 }
const STATUS_MIN_DURATION = 2
const STATUS_MAX_DURATION = 6
/** 變化招回復量 QTE 縮放（夾上限；最差仍回血，不變廢回合）。 */
const HEAL_QUALITY_SCALE: Record<QteQuality, number> = { perfect: 1.2, good: 1.05, normal: 1, weak: 0.85 }

const statusesForSide = (w: BattleState, side: Side): StatusEffect[] =>
  side === 'player' ? w.field.teamStatuses : w.field.enemyStatuses

/** 回合末遞減所有狀態 remaining、移除歸零者（純）。 */
function tickStatuses(list: StatusEffect[]): StatusEffect[] {
  return list.map((s) => ({ ...s, remaining: s.remaining - 1 })).filter((s) => s.remaining > 0)
}

/**
 * 施放變化招（無傷害）：依 effect.kind 寫入 fieldState 暫態 / 回血 / 設地形。
 * QTE 品質只影響強度（buff 回合數 / heal 量），不影響成敗；buff 同 stat 刷新（取 max mult、不疊乘爆表）。
 * 純函數（只改 working 複本），emit statusApplied 供 display 演出。
 */
function applyStatusMove(w: BattleState, side: Side, move: Move, quality: QteQuality, events: BattleEvent[]): void {
  const eff = move.effect
  if (!eff) return
  const index = w[side].activeIndex
  const actor = w[side].members[index]

  if (eff.kind === 'buff' && eff.stat && eff.mult) {
    const list = statusesForSide(w, side)
    const dur = Math.max(STATUS_MIN_DURATION, Math.min(STATUS_MAX_DURATION, (eff.duration ?? 3) + STATUS_DURATION_BONUS[quality]))
    const existing = list.find((s) => s.stat === eff.stat)
    if (existing) {
      existing.mult = Math.max(existing.mult, eff.mult) // 硬上限：取 max 不疊乘
      existing.remaining = dur
    } else {
      list.push({ stat: eff.stat, mult: eff.mult, remaining: dur, source: move.id, label: eff.label })
    }
    events.push({ type: 'statusApplied', side, index, moveId: move.id, effectKind: 'buff', label: eff.label, remaining: dur })
  } else if (eff.kind === 'heal' && eff.healFrac) {
    const hpBefore = actor.currentHp
    const amount = Math.max(1, Math.round(actor.maxHp * eff.healFrac * HEAL_QUALITY_SCALE[quality]))
    const hpAfter = Math.min(actor.maxHp, hpBefore + amount)
    actor.currentHp = hpAfter
    events.push({ type: 'statusApplied', side, index, moveId: move.id, effectKind: 'heal', label: eff.label, remaining: 0, healAmount: hpAfter - hpBefore, hpAfter })
  } else if (eff.kind === 'terrain' && eff.terrainId) {
    w.field.terrainEffects.current = [eff.terrainId]
    events.push({ type: 'statusApplied', side, index, moveId: move.id, effectKind: 'terrain', label: eff.label, remaining: 0, terrainId: eff.terrainId })
  }
}

// ── 對手選招 AI（M19，plan/17 §1.4）──────────────────────────────

/**
 * 對手選哪一槽出招（純函式，加權隨機；不新增相位、不引決策樹）。
 * 權重：剋制（×3 / 雙倍以上）、有效（×2 / 1<eff<2）、普通（×1）、不利（×0.6）、無效（×0.1）；本系再 ×2。
 * 變化招（power 0，M19.d）給低權重避免對手亂放。**單招直接回 0、不耗 rng**（保既有測試 rng 序）。
 */
export function chooseOpponentMove(attacker: BattleMobie, defender: BattleMobie, rng: () => number): number {
  if (attacker.moves.length <= 1) return 0
  const weights = attacker.moves.map((mv) => {
    if (mv.power <= 0) return 0.1 // 變化招：低權
    const eff = typeEffectiveness(mv.type, defender.types)
    const effW = eff === 0 ? 0.1 : eff >= 2 ? 3 : eff > 1 ? 2 : eff < 1 ? 0.6 : 1
    const stab = attacker.types.includes(mv.type) ? 2 : 1
    return Math.max(0.05, effW * stab)
  })
  const total = weights.reduce((a, b) => a + b, 0)
  let r = rng() * total
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i]
    if (r <= 0) return i
  }
  return weights.length - 1
}

// ── 連鎖攻擊（M9，plan/09 §3）────────────────────────────────────

/** 一次玩家普攻命中 → 累積的連鎖槽量，依 QTE 品質加權（不綁隨機）。 */
const CHAIN_GAIN_BY_QUALITY: Record<QteQuality, number> = { perfect: 1.5, good: 1.2, normal: 1, weak: 0.6 }

/**
 * 連鎖可參與者：當前 active 在前（連鎖領銜），其後依序接未倒下隊友，最多 maxHits 隻。
 * 倒下隊友不可連鎖（守 plan/09 §3.3）。display 層亦複用此函數鋪設連續 QTE 序列。
 */
export function chainEligible(s: BattleSide, maxHits: number): number[] {
  const out: number[] = []
  if (s.members[s.activeIndex]?.currentHp > 0) out.push(s.activeIndex)
  for (let i = 0; i < s.members.length; i++) {
    if (i !== s.activeIndex && s.members[i].currentHp > 0) out.push(i)
  }
  return out.slice(0, maxHits)
}

/**
 * 結算玩家連鎖：依序對「連鎖開始時的 active 敵」出擊。嚴守 §0.4：
 *  - 每段命中前重驗：①該攻擊者仍存活（否則跳過、不計入連段）②目標仍為同一 active 敵（敵已倒/換 → 截斷剩餘）。
 *  - 不轉移目標、不追擊新上場的敵；連鎖中敵 active 倒下即停（applyForcedSwitch 已在 performAttack 內處理）。
 * 每隻用自己的單一專屬招（不引新招）。回報 chainHit（連段數）+ 各段 damageApplied。
 */
function resolvePlayerChain(
  w: BattleState,
  hits: ChainHit[],
  base: AttackParams,
  maxHits: number,
  events: BattleEvent[],
): void {
  const foeStartActive = w.foe.activeIndex
  let combo = 0
  for (const hit of hits.slice(0, maxHits)) {
    if (w.winner !== null) break
    if (w.foe.activeIndex !== foeStartActive) break // 目標已倒/換 → 截斷剩餘 hits
    const attacker = w.player.members[hit.attackerIndex]
    if (!attacker || attacker.currentHp <= 0) continue // 重驗：死亡/非法攻擊者跳過、不計連段
    combo += 1
    events.push({ type: 'chainHit', comboCount: combo, attackerIndex: hit.attackerIndex })
    performAttack(
      w,
      'player',
      { ...base, attackerIndex: hit.attackerIndex, qteMult: attackQteMultiplier(hit.quality), source: `chain-${combo}` },
      events,
    )
  }
}

// ── 公開 API ───────────────────────────────────────────────────

/**
 * 解算一整回合（玩家行動 + 對手回應），純函數：不改動 state，回傳新 state 與 domain events。
 * - ATTACK：依速度先後手，雙方各 active 互打一次；被打倒者依序強制換，全滅判勝負。
 *   先手若打倒後手的 active，後手「原本要攻擊的那隻」已倒 → 該次攻擊略過。
 * - SWITCH：玩家收回換上 index（耗本回合攻擊權），對手立刻打換上的一隻，
 *   玩家以防禦 QTE（defenseQuality）抵減傷害；換上即倒 → 立即強制換。
 */
export function resolveTurn(state: BattleState, action: BattleAction, options: TurnOptions = {}): TurnResult {
  if (state.winner !== null) return { nextState: state, events: [] }

  const rng = options.rng ?? Math.random
  const damageHooks = options.ext?.damageHooks // S3：注入兩方攻擊，hook 自行依 attacker 判定
  const w = cloneState(state)
  const events: BattleEvent[] = []

  // 地形倍率解析器：綁定「目前地形」（讀 w.field 故 M11 地形突變改 current 後也即時反映），
  // 攻擊時依招式屬性算倍率。未注入 terrainMultiplier＝無地形＝undefined＝performAttack 內 ×1。
  const terrainResolve = options.terrainMultiplier
    ? (moveType: TypeName) => options.terrainMultiplier!(moveType, w.field.terrainEffects.current)
    : undefined

  if (action.type === 'ATTACK') {
    // 星擊 Finisher：大倍率 + 必定會心；跳過支援輪盤
    const starStrike = action.starStrike === true
    // 支援輪盤（每 SUPPORT_EVERY 回合）：攻擊UP / 必定會心 / 支援補刀 / 摃龜
    let playerDamageMult = starStrike ? STAR_STRIKE_MULT : 1
    let playerForceCrit = starStrike
    if (!starStrike && state.turn % SUPPORT_EVERY === 0) {
      const roll = rng()
      const outcome = supportOutcome(roll)
      events.push({
        type: 'random',
        event: {
          type: 'supportRoulette',
          actorId: unitId('player', w.player.activeIndex),
          roll, outcome, source: `turn-${state.turn}`,
        },
      })
      if (outcome === 'attackUp') playerDamageMult = 1.5
      else if (outcome === 'crit') playerForceCrit = true
      else if (outcome === 'ally') {
        const allyIdx = nextLivingIndex(w.player) // 待命的存活隊友補一刀
        if (allyIdx >= 0) performAttack(w, 'player', { rng, attackerIndex: allyIdx, source: 'support-ally', damageHooks, terrainResolve }, events)
      }
    }

    const playerQte = action.quality ? attackQteMultiplier(action.quality, action.mashCount ?? 0) : 1
    // M19：玩家由 action.slotIndex 選槽（缺省＝slot0）；對手加權選槽（單招回 0、不耗 rng＝既有測試序不變）。
    // M19.d：注入雙方隊伍狀態增益（performAttack 依招式 category 折進傷害；變化招走 applyStatusMove 不吃此）。
    const playerOpts: AttackParams = { rng, qteMult: playerQte, damageMult: playerDamageMult, forceCrit: playerForceCrit, damageHooks, terrainResolve, moveIndex: action.slotIndex, offenseStatuses: w.field.teamStatuses, defenseStatuses: w.field.enemyStatuses }
    const foeMoveIndex = chooseOpponentMove(activeOf(w, 'foe'), activeOf(w, 'player'), rng)
    const foeOpts: AttackParams = { rng, damageHooks, terrainResolve, moveIndex: foeMoveIndex, offenseStatuses: w.field.enemyStatuses, defenseStatuses: w.field.teamStatuses }

    const playerFirst = playerActsFirst(activeOf(w, 'player'), activeOf(w, 'foe'), rng)
    const order: Side[] = playerFirst ? ['player', 'foe'] : ['foe', 'player']
    // 記下（補刀之後）雙方在場索引：第二攻擊者若已被打倒換人，activeIndex 會變 → 略過其攻擊。
    const startActive: Record<Side, number> = {
      player: w.player.activeIndex,
      foe: w.foe.activeIndex,
    }
    // 星擊永遠是 slot0 攻擊 finisher，不會是變化招（slotIndex undefined）。
    const slotBySide: Record<Side, number> = { player: starStrike ? 0 : (action.slotIndex ?? 0), foe: foeMoveIndex }

    for (const atkSide of order) {
      if (w.winner !== null) break
      if (w[atkSide].activeIndex !== startActive[atkSide]) continue // 原攻擊者已倒並換人
      const actor = activeOf(w, atkSide)
      const move = actor.moves[slotBySide[atkSide]] ?? actor.move
      // M19.d：變化招（無傷害）走 applyStatusMove；星擊強制走攻擊路徑。
      if (!starStrike && move.category === 'status' && move.effect) {
        const q = atkSide === 'player' ? (action.quality ?? 'normal') : 'normal'
        applyStatusMove(w, atkSide, move, q, events)
      } else {
        performAttack(w, atkSide, atkSide === 'player' ? playerOpts : foeOpts, events)
      }
    }

    // 連鎖槽（M9）：連鎖模組開啟時，玩家普攻命中依 QTE 品質累積（不綁隨機）。星擊不續槽（已是 finisher）。
    // M19.d：變化招不斷鏈、貢獻減半「支援值」（plan/17 §5：不參與傷害，但推進連鎖）。
    if (options.ext?.chain && !starStrike) {
      const playerLanded = events.some(
        (e) => e.type === 'damageApplied' && e.attackerSide === 'player' && !e.missed && e.amount > 0,
      )
      const playerStatus = events.some((e) => e.type === 'statusApplied' && e.side === 'player')
      const q = action.quality ?? 'normal'
      let gain = 0
      if (playerLanded) gain = options.ext.chain.gainBase * CHAIN_GAIN_BY_QUALITY[q]
      else if (playerStatus) gain = options.ext.chain.gainBase * CHAIN_GAIN_BY_QUALITY[q] * 0.5
      if (gain > 0) w.chainGauge = Math.min(options.ext.chain.gaugeFull, w.chainGauge + gain)
    }
  } else if (action.type === 'SWITCH') {
    // SWITCH —— 只有玩家可主動換人（對手 AI 主動換留待後續）
    const side: Side = 'player'
    const fromIndex = w.player.activeIndex
    const toIndex = action.index
    const target = w.player.members[toIndex]
    if (toIndex === fromIndex || !target || target.currentHp <= 0) {
      throw new Error(`invalid switch to index ${toIndex}`)
    }

    w.player.activeIndex = toIndex
    events.push({ type: 'activeChanged', side, fromIndex, toIndex, forced: false })

    const defenseQuality: QteQuality = action.defenseQuality ?? 'weak'
    const damageMult = defenseMultiplier(defenseQuality)
    events.push({ type: 'switchDefenseResolved', side, index: toIndex, defenseQuality, damageMult })

    // 對手對「換上的」攻擊一次（玩家本回合不攻擊）
    performAttack(w, 'foe', { rng, damageMult, damageHooks, terrainResolve }, events)
  } else {
    // SUBMIT_CHAIN_RESULT（M9 連鎖）—— 連鎖佔玩家「攻擊型」相位的一格，吃速度、不為連鎖特例化（§0.4 B）。
    // reducer 重驗（防幽靈傷害）：payload 只是玩家宣告，存活/目標一律由 reducer 重查（plan/09 §3.3）。
    const maxHits = options.ext?.chain?.maxHits ?? action.hits.length
    const opts: AttackParams = { rng, damageHooks, terrainResolve } // 連鎖各段 + 敵反擊共用（attackerIndex/qte 逐段補）

    const playerFirst = playerActsFirst(activeOf(w, 'player'), activeOf(w, 'foe'), rng)
    const order: Side[] = playerFirst ? ['player', 'foe'] : ['foe', 'player']
    const startActive: Record<Side, number> = { player: w.player.activeIndex, foe: w.foe.activeIndex }

    for (const side of order) {
      if (w.winner !== null) break
      if (side === 'foe') {
        if (w.foe.activeIndex !== startActive.foe) continue // 原 active 已被連鎖打倒換人 → 略過反擊（同普攻規則）
        performAttack(w, 'foe', opts, events)
      } else {
        // 玩家較慢且 active 領銜者已被敵先手 KO → 連鎖發不出（§0.4 B，不開特例）
        if (w.player.activeIndex !== startActive.player) continue
        resolvePlayerChain(w, action.hits, opts, maxHits, events)
      }
    }

    w.chainGauge = 0 // 連鎖消耗連鎖槽（無論是否完整發出，皆耗本次機會）
  }

  w.turn = state.turn + 1

  // S4 回合末同步觸發器（剩飯回血、氣勢披帶持續型…）。contract D（plan/09 §0.4）：
  // 必須在下面的 timeout 判定「之前」跑，HP 變動才會納入 timeout 的剩餘血量比例。只有未分勝負時才跑。
  if (w.winner === null && options.ext?.turnEndTriggers) {
    for (const trigger of options.ext.turnEndTriggers) {
      events.push(...trigger({ state: w, rng }))
      if (w.winner !== null) break
    }
  }

  // M11 野外意外（wild-only，注入 hook）：每回合一次依機率觸發地形突變/亂入削血（就地改 working state）。
  // 未注入＝無意外（競技場/既有測試不動）。intrusion 為非致命削血（hook 保證留 ≥1 HP，不引強制換）。
  if (w.winner === null && options.wildEvents) {
    events.push(...options.wildEvents({ state: w, rng }))
  }

  // M19.d：變化招增益回合末遞減、歸零移除（暫態，不持久化）。本回合施加者已 +duration，故至少存活到下回合。
  w.field.teamStatuses = tickStatuses(w.field.teamStatuses)
  w.field.enemyStatuses = tickStatuses(w.field.enemyStatuses)

  // 回合上限：到頂仍未分勝負 → 依剩餘血量比例判定（平手判玩家勝，對自用遊戲友善）。
  // 自然勝負已在上面 performAttack/applyForcedSwitch 設定 winner，這裡只接管「打不完」。
  if (w.winner === null && w.turn > MAX_TURNS) {
    const winner: Side = teamHpFraction(w.player) >= teamHpFraction(w.foe) ? 'player' : 'foe'
    w.winner = winner
    events.push({ type: 'battleEnded', winner, reason: 'timeout' })
  }

  // 連鎖資格（M9，plan/09 §3.2）：連鎖模組開啟、連鎖槽集滿、戰鬥續行且有可參與隊友 → emit chainOpportunity。
  // display 接此 → 下個 playerChoice 亮起連鎖鈕。停用（ext.chain undefined）＝連鎖槽恆 0＝永不 emit＝零殘留。
  if (w.winner === null && options.ext?.chain && w.chainGauge >= options.ext.chain.gaugeFull) {
    const eligibleIndices = chainEligible(w.player, options.ext.chain.maxHits)
    if (eligibleIndices.length > 0) {
      events.push({ type: 'chainOpportunity', maxHits: options.ext.chain.maxHits, eligibleIndices })
    }
  }

  return { nextState: w, events }
}
