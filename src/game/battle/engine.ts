import type { BattleMobie } from '@/game/types'
import { effectivenessLabel, typeEffectiveness } from '@/game/data/typeChart'
import type { DamageHook } from '@/game/ext/seams'

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
  /**
   * 地形倍率（M8，plan/11 §1）：在屬性相剋「之後」乘的純倍率（與 qte/damageMult 同位階）。
   * 預設 1＝無地形，既有測試不動。實際倍率由 reducer 注入（reducer 依招式屬性查 currentTerrains），engine 只乘。
   */
  terrainMult?: number
  /** 強制會心（支援輪盤「必定會心」用）；仍會消耗 crit 亂數以保持順序 */
  forceCrit?: boolean
  /** S3 傷害鉤（plan/09 §0）：傷害結算中段的純倍率（道具 damageHook…）；預設無＝×1。各 hook 自行用 ctx 判定是否生效。 */
  damageHooks?: DamageHook[]
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
  /** 命中判定的原始亂數（給統一 RandomEvent 用） */
  accuracyRoll: number
  /** 會心判定的原始亂數；未擲到（miss / 無效）時為 -1 */
  critRoll: number
}

const CRIT_RATE = 1 / 16
const CRIT_MULT = 1.5

/**
 * 解算一次攻擊（純函數，方便單測）。
 * 傷害公式：本傳簡化版 × STAB × 屬性相剋 × 暴擊 × 隨機(0.85–1) × QTE。
 */
export function resolveAttack(
  attacker: BattleMobie,
  defender: BattleMobie,
  options: AttackOptions = {},
): AttackResult {
  const rng = options.rng ?? Math.random
  const qteMult = options.qteMult ?? 1
  const damageMult = options.damageMult ?? 1
  const terrainMult = options.terrainMult ?? 1
  const move = attacker.move

  const effectiveness = typeEffectiveness(move.type, defender.types)

  // ① 命中判定
  const accuracyRoll = rng()
  const missed = accuracyRoll * 100 >= move.accuracy
  if (missed) {
    return {
      damage: 0, effectiveness, effectivenessText: null,
      missed: true, crit: false,
      defenderHpAfter: defender.currentHp, defenderFainted: false,
      accuracyRoll, critRoll: -1,
    }
  }

  // 屬性無效 → 0 傷害
  if (effectiveness === 0) {
    return {
      damage: 0, effectiveness, effectivenessText: effectivenessLabel(0),
      missed: false, crit: false,
      defenderHpAfter: defender.currentHp, defenderFainted: false,
      accuracyRoll, critRoll: -1,
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
  const critRoll = rng()
  const crit = options.forceCrit === true || critRoll < CRIT_RATE
  const critMult = crit ? CRIT_MULT : 1

  // S3 傷害鉤：與 qte/damageMult 同位階的純倍率，逐 hook 相乘（預設無＝1）。
  let hookMult = 1
  if (options.damageHooks) {
    for (const hook of options.damageHooks) hookMult *= hook({ attacker, defender, effectiveness })
  }

  // 地形倍率在屬性相剋之後乘（plan/11 §1.1）；乘法可交換，列於 effectiveness 後以示語意。
  let damage = Math.floor(base * stab * effectiveness * terrainMult * variance * critMult * qteMult * damageMult * hookMult)
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
    accuracyRoll, critRoll,
  }
}

/** 先手判定：速度高者先攻，相同則隨機 */
export function playerActsFirst(
  player: BattleMobie,
  foe: BattleMobie,
  rng: () => number = Math.random,
): boolean {
  if (player.spe !== foe.spe) return player.spe > foe.spe
  return rng() < 0.5
}

/** 擊敗野生寶可夢後的捕獲機率（等級越低越好捕），0–1 */
export function captureChance(wild: BattleMobie): number {
  const raw = 0.9 - (wild.level - 8) * 0.03
  return Math.min(0.95, Math.max(0.4, raw))
}

export function attemptCapture(wild: BattleMobie, rng: () => number = Math.random): boolean {
  return rng() < captureChance(wild)
}

// ── 捕獲球輪盤（M1.5g）──────────────────────────────────────────
export type BallId = 'poke' | 'great' | 'ultra'

export interface Ball { id: BallId; nameZh: string; mult: number; color: string }

export const BALLS: Ball[] = [
  { id: 'poke', nameZh: '精靈球', mult: 1.0, color: '#e7503a' },
  { id: 'great', nameZh: '超級球', mult: 1.4, color: '#3a7be7' },
  { id: 'ultra', nameZh: '高級球', mult: 1.9, color: '#f0b429' },
]

export const getBall = (id: BallId): Ball => BALLS.find((b) => b.id === id) ?? BALLS[0]

/** 輪盤轉出球種（輪盤上精靈球較多、高級球較稀有） */
export function rollBall(rng: () => number = Math.random): BallId {
  const r = rng()
  if (r < 0.55) return 'poke'
  if (r < 0.85) return 'great'
  return 'ultra'
}

/** 套球種係數後的捕獲機率（封頂 0.98） */
export function captureChanceWithBall(wild: BattleMobie, ballMult: number): number {
  return Math.min(0.98, captureChance(wild) * ballMult)
}

// ── 攻擊 QTE 連打蓄力（M1.5g）─────────────────────────────────
export interface ChargeTier { label: string; color: string; mult: number }

const CHARGE_TIERS: Array<{ min: number } & ChargeTier> = [
  { min: 0, label: '', color: '#9fa19f', mult: 1.0 },
  { min: 1, label: 'RED', color: '#ff5161', mult: 1.06 },
  { min: 5, label: 'BLUE', color: '#3a7be7', mult: 1.12 },
  { min: 10, label: 'YELLOW', color: '#f0b429', mult: 1.2 },
  { min: 16, label: 'PURPLE', color: '#9141cb', mult: 1.28 },
  { min: 24, label: 'RAINBOW', color: '#ff7ae0', mult: 1.38 },
]

/** 連打次數 → 色階加成段（red→rainbow） */
export function chargeTier(mashCount: number): ChargeTier {
  let t = CHARGE_TIERS[0]
  for (const tier of CHARGE_TIERS) if (mashCount >= tier.min) t = tier
  return { label: t.label, color: t.color, mult: t.mult }
}

/** 攻擊 QTE 最終倍率 = timing 品質 × 連打蓄力色階 */
export function attackQteMultiplier(quality: QteQuality, mashCount = 0): number {
  return qteMultiplier(quality) * chargeTier(mashCount).mult
}
