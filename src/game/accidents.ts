// M11 野外意外（wild-only，plan/11 §3）——全走既有統一 RandomEvent / 注入機制，wild 專屬。
//
// 守鐵律：①只存 canonical OwnedUnit（意外全為 encounter/reward flag 或戰鬥內暫態）②純 reducer
// （戰中意外＝注入 hook，reducer 不認識「野外」語意）③不新增第 4 隻 unit（intrusion 為純削血事件）。
//
// 五意外落點：rareBoss(encounter flag) / luckyBonus(reward) / supplyCache(開場前·戰後) 走 setup/result 層；
// terrainShift / intrusion(戰中) 走注入 reducer 的 wildEvents hook。

import type { Card, Region, Stats, TerrainId } from '@/game/types'
import type { BattleState, BattleEvent, Side } from '@/game/battle/reducer'
import { hashSeed, mulberry32 } from '@/game/individual'

// ── 機率 / 參數（待玩測調平衡，plan/11 §7）──────────────────────
const RARE_BOSS_CHANCE = 0.12 // 稀有閃光 boss
const LUCKY_BONUS_CHANCE = 0.18 // 幸運加碼（自動）
const SUPPLY_CACHE_CHANCE = 0.25 // 天降補給（開場三選一）
const ACCIDENT_PER_TURN = 0.12 // 戰中每回合觸發任一意外的機率
const ACCIDENT_MIN_TURN = 2 // 開場第 1 回合不觸發（讓對戰先安頓）
const INTRUSION_FRAC = 0.12 // 亂入削血＝maxHp 比例（非致命，留 ≥1）

// ── encounter 層：稀有閃光 boss（plan/11 §3.7）────────────────────

/**
 * wild 區域有機率把 boss（末隻）升為稀有閃光：顯式覆寫 shiny + 高 IV（→ 高 Grade、捕獲報酬更香）。
 * 純函數（rng 注入）；只動末隻 card 的覆寫欄，個體仍由既有 captureUnit 決定論落地。arena 不觸發。
 */
export function maybeRareBoss(team: Card[], region: Region, rng: () => number): Card[] {
  if (region.mode !== 'wild' || team.length === 0) return team
  if (rng() >= RARE_BOSS_CHANCE) return team
  const hiIvs: Partial<Stats> = { hp: 30, atk: 30, def: 30, spa: 30, spd: 30, spe: 30 }
  return team.map((c, i) => (i === team.length - 1 ? { ...c, shiny: true, ivs: { ...hiIvs, ...c.ivs } } : c))
}

// ── encounter 層：自動獎勵旗標 + 天降補給三選一（plan/11 §3.6/3.9）──

export type SupplyKind = 'sp' | 'exp' | 'capture'
export interface SupplyOption {
  kind: SupplyKind
  icon: string
  label: string
  desc: string
}
const SUPPLY_POOL: SupplyOption[] = [
  { kind: 'sp', icon: '✦', label: '修行心得', desc: '立即獲得 3 SP（招式/夥伴技能共用）' },
  { kind: 'exp', icon: '🍀', label: '經驗加倍符', desc: '本場勝利經驗 ×1.5' },
  { kind: 'capture', icon: '🎯', label: '幸運捕獲球', desc: '本場捕獲率提升' },
]

/** 一場 wild 遭遇的意外旗標（決定論，依 foeTeam seed 穩定）。arena 全 false/null。 */
export interface EncounterAccidents {
  /** 幸運加碼（自動）：本場勝利額外經驗倍率（1＝無） */
  luckyExpMult: number
  /** 天降補給三選一（null＝本場無補給） */
  supply: SupplyOption[] | null
}

/** 由 region + foeTeam 決定論 roll 出 encounter 意外旗標（同一遭遇穩定、不隨 re-render 變）。 */
export function rollEncounterAccidents(region: Region, foeTeam: Card[]): EncounterAccidents {
  if (region.mode !== 'wild') return { luckyExpMult: 1, supply: null }
  const rng = mulberry32(hashSeed(`accident|${region.id}|${foeTeam.map((c) => c.cardId).join(',')}`))
  const luckyExpMult = rng() < LUCKY_BONUS_CHANCE ? 1.5 : 1
  let supply: SupplyOption[] | null = null
  if (rng() < SUPPLY_CACHE_CHANCE) supply = SUPPLY_POOL // 固定三選一（簡單、可玩測再隨機池）
  return { luckyExpMult, supply }
}

// ── 戰中層：地形突變 / 亂入（注入 reducer 的 wildEvents hook，plan/11 §3.1/3.2）──

export interface WildEventConfig {
  /** 地形突變可抽的池（注入，reducer 不認識地形資料）；空＝不觸發地形突變 */
  terrainPool: TerrainId[]
}

/**
 * 製作注入 reducer 的 wildEvents hook：每回合一次依機率觸發地形突變 / 亂入削血。
 * 純（rng 注入）；就地改 working state（hook 收到的是 cloneState 出來的 w）。
 * intrusion **非致命**（留 ≥1 HP）＝不引強制換、守 §0.4 contract E；不新增第 4 隻 unit。
 */
export function makeWildEvents(cfg: WildEventConfig) {
  return ({ state, rng }: { state: BattleState; rng: () => number }): BattleEvent[] => {
    if (state.turn < ACCIDENT_MIN_TURN) return []
    if (rng() >= ACCIDENT_PER_TURN) return []
    const canShift = cfg.terrainPool.length > 0
    const doShift = canShift && rng() < 0.5
    if (doShift) {
      const t = cfg.terrainPool[Math.floor(rng() * cfg.terrainPool.length)]
      state.field.terrainEffects.current = [t]
      return [{ type: 'wildAccident', kind: 'terrainShift', terrainId: t }]
    }
    // 亂入：對隨機一方在場者一次性非致命削血
    const side: Side = rng() < 0.5 ? 'player' : 'foe'
    const index = state[side].activeIndex
    const m = state[side].members[index]
    const dmg = Math.max(1, Math.floor(m.maxHp * INTRUSION_FRAC))
    const hpAfter = Math.max(1, m.currentHp - dmg) // 非致命
    const amount = m.currentHp - hpAfter
    m.currentHp = hpAfter
    return [{ type: 'wildAccident', kind: 'intrusion', side, index, amount, hpAfter }]
  }
}
