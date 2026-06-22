// 3v3 單打戰鬥純 reducer（M1.5a）——
// 不含任何 UI / 動畫字眼，只吐 domain events，方便單測與「一次算完、畫面慢慢演」。
// 設計真相：plan/01-architecture、plan/06-battle-reference、第二場 conclusion。

import type { BattlePokemon } from '@/game/types'
import {
  resolveAttack,
  attackQteMultiplier,
  defenseMultiplier,
  playerActsFirst,
  type QteQuality,
} from '@/game/battle/engine'

export type Side = 'player' | 'foe'

/** 一方的隊伍：最多 3 隻 + 目前在場的索引（HP 跨換人持續、不自動回復） */
export interface BattleSide {
  members: BattlePokemon[]
  activeIndex: number
}

/** 完整戰鬥狀態（canonical 戰鬥態；派生顯示態由 BattleScreen 自己維護） */
export interface BattleState {
  player: BattleSide
  foe: BattleSide
  /** 已解算的回合數，從 1 起算（支援輪盤「每 N 回合」M1.5g 會用到） */
  turn: number
  /** 勝方；null = 進行中 */
  winner: Side | null
}

/** 玩家本回合的行動 */
export type BattleAction =
  | { type: 'ATTACK'; quality?: QteQuality; mashCount?: number; starStrike?: boolean }
  | { type: 'SWITCH'; index: number; defenseQuality?: QteQuality }

/** 星擊 Finisher 的傷害倍率（能量滿槽放，必定會心） */
export const STAR_STRIKE_MULT = 3

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
    }
  | { type: 'memberFainted'; side: Side; index: number }
  | { type: 'activeChanged'; side: Side; fromIndex: number; toIndex: number; forced: boolean }
  | { type: 'switchDefenseResolved'; side: Side; index: number; defenseQuality: QteQuality; damageMult: number }
  | { type: 'battleEnded'; winner: Side }
  | { type: 'random'; event: RandomEvent }

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
}

export interface TurnResult {
  nextState: BattleState
  events: BattleEvent[]
}

// ── 建構 / 選取 ────────────────────────────────────────────────

/** 由雙方隊伍建出初始戰鬥狀態（active=0、turn=1、未分勝負） */
export function createBattleState(
  playerMembers: BattlePokemon[],
  foeMembers: BattlePokemon[],
): BattleState {
  return {
    player: { members: playerMembers, activeIndex: 0 },
    foe: { members: foeMembers, activeIndex: 0 },
    turn: 1,
    winner: null,
  }
}

const other = (side: Side): Side => (side === 'player' ? 'foe' : 'player')

const activeOf = (state: BattleState, side: Side): BattlePokemon =>
  state[side].members[state[side].activeIndex]

const unitId = (side: Side, index: number): string => `${side}:${index}`

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
  /** RandomEvent 來源標記 */
  source?: string
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

  const result = resolveAttack(attacker, target, {
    rng: params.rng,
    qteMult: params.qteMult ?? 1,
    damageMult: params.damageMult ?? 1,
    forceCrit: params.forceCrit ?? false,
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
  })

  if (result.defenderFainted) {
    events.push({ type: 'memberFainted', side: targetSide, index: targetIndex })
    applyForcedSwitch(w, targetSide, events)
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
  const w = cloneState(state)
  const events: BattleEvent[] = []

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
        if (allyIdx >= 0) performAttack(w, 'player', { rng, attackerIndex: allyIdx, source: 'support-ally' }, events)
      }
    }

    const playerQte = action.quality ? attackQteMultiplier(action.quality, action.mashCount ?? 0) : 1
    const playerOpts: AttackParams = { rng, qteMult: playerQte, damageMult: playerDamageMult, forceCrit: playerForceCrit }
    const foeOpts: AttackParams = { rng }

    const playerFirst = playerActsFirst(activeOf(w, 'player'), activeOf(w, 'foe'), rng)
    const order: Side[] = playerFirst ? ['player', 'foe'] : ['foe', 'player']
    // 記下（補刀之後）雙方在場索引：第二攻擊者若已被打倒換人，activeIndex 會變 → 略過其攻擊。
    const startActive: Record<Side, number> = {
      player: w.player.activeIndex,
      foe: w.foe.activeIndex,
    }

    for (const atkSide of order) {
      if (w.winner !== null) break
      if (w[atkSide].activeIndex !== startActive[atkSide]) continue // 原攻擊者已倒並換人
      performAttack(w, atkSide, atkSide === 'player' ? playerOpts : foeOpts, events)
    }
  } else {
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
    performAttack(w, 'foe', { rng, damageMult }, events)
  }

  w.turn = state.turn + 1
  return { nextState: w, events }
}
