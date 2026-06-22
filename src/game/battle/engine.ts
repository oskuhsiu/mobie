import type { BattlePokemon } from '@/game/types'
import { effectivenessLabel, typeEffectiveness } from '@/game/data/typeChart'

/** Timing QTE 命中品質 */
export type QteQuality = 'perfect' | 'good' | 'normal' | 'weak'

/** 攻擊 QTE 品質 → 傷害倍率 */
export function qteMultiplier(q: QteQuality): number {
  switch (q) {
    case 'perfect': return 1.3
    case 'good': return 1.15
    case 'normal': return 1.0
    case 'weak': return 0.8
  }
}

/**
 * 防禦 QTE 品質 → 受擊傷害倍率（換人時抵減用，<1 代表減傷）。
 * perfect=減傷 90% / good=60% / normal=30% / weak=0%（見 plan 第二場 conclusion）。
 */
export function defenseMultiplier(q: QteQuality): number {
  switch (q) {
    case 'perfect': return 0.1
    case 'good': return 0.4
    case 'normal': return 0.7
    case 'weak': return 1.0
  }
}

export interface AttackOptions {
  /** 隨機來源，呼叫順序：①命中判定 ②傷害變異 ③暴擊。預設 Math.random */
  rng?: () => number
  /** 攻擊 QTE 傷害倍率，預設 1.0 */
  qteMult?: number
  /** 額外傷害倍率（防禦抵減 <1 / 支援UP >1），預設 1.0 */
  damageMult?: number
}

export interface AttackResult {
  damage: number
  /** 屬性相剋總倍率 */
  effectiveness: number
  /** 效果文案（絕佳 / 不太好 / 沒效果），普通為 null */
  effectivenessText: string | null
  missed: boolean
  crit: boolean
  defenderHpAfter: number
  defenderFainted: boolean
}

const CRIT_RATE = 1 / 16
const CRIT_MULT = 1.5

/**
 * 解算一次攻擊（純函數，方便單測）。
 * 傷害公式：本傳簡化版 × STAB × 屬性相剋 × 暴擊 × 隨機(0.85–1) × QTE。
 */
export function resolveAttack(
  attacker: BattlePokemon,
  defender: BattlePokemon,
  options: AttackOptions = {},
): AttackResult {
  const rng = options.rng ?? Math.random
  const qteMult = options.qteMult ?? 1
  const damageMult = options.damageMult ?? 1
  const move = attacker.move

  const effectiveness = typeEffectiveness(move.type, defender.types)

  // ① 命中判定
  const missed = rng() * 100 >= move.accuracy
  if (missed) {
    return {
      damage: 0, effectiveness, effectivenessText: null,
      missed: true, crit: false,
      defenderHpAfter: defender.currentHp, defenderFainted: false,
    }
  }

  // 屬性無效 → 0 傷害
  if (effectiveness === 0) {
    return {
      damage: 0, effectiveness, effectivenessText: effectivenessLabel(0),
      missed: false, crit: false,
      defenderHpAfter: defender.currentHp, defenderFainted: false,
    }
  }

  const atk = move.category === 'physical' ? attacker.atk : attacker.spa
  const def = move.category === 'physical' ? defender.def : defender.spd

  // 本傳簡化傷害公式
  const base = Math.floor(
    Math.floor((Math.floor((2 * attacker.level) / 5 + 2) * move.power * atk) / def) / 50,
  ) + 2

  const stab = attacker.types.includes(move.type) ? 1.5 : 1
  // ② 傷害變異
  const variance = 0.85 + rng() * 0.15
  const crit = rng() < CRIT_RATE
  const critMult = crit ? CRIT_MULT : 1

  let damage = Math.floor(base * stab * effectiveness * variance * critMult * qteMult * damageMult)
  damage = Math.max(1, damage) // 命中且有效，至少 1

  const defenderHpAfter = Math.max(0, defender.currentHp - damage)

  return {
    damage,
    effectiveness,
    effectivenessText: effectivenessLabel(effectiveness),
    missed: false,
    crit,
    defenderHpAfter,
    defenderFainted: defenderHpAfter <= 0,
  }
}

/** 先手判定：速度高者先攻，相同則隨機 */
export function playerActsFirst(
  player: BattlePokemon,
  foe: BattlePokemon,
  rng: () => number = Math.random,
): boolean {
  if (player.spe !== foe.spe) return player.spe > foe.spe
  return rng() < 0.5
}

/** 擊敗野生寶可夢後的捕獲機率（等級越低越好捕），0–1 */
export function captureChance(wild: BattlePokemon): number {
  const raw = 0.9 - (wild.level - 8) * 0.03
  return Math.min(0.95, Math.max(0.4, raw))
}

export function attemptCapture(wild: BattlePokemon, rng: () => number = Math.random): boolean {
  return rng() < captureChance(wild)
}
