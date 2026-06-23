// 成長（M1.5f）：Medium Fast n^3 經驗曲線、戰勝得 EXP、升級重算。
// 只動 canonical 的 level/exp；能力值由 buildBattlePokemon 依新 level 重算（不存派生）。

import type { Card, OwnedUnit, Stats } from '@/game/types'
import { rollIndividual } from '@/game/individual'

export const MAX_LEVEL = 100

/** Medium Fast：到達等級 n 所需的總經驗 = n^3 */
export function expForLevel(level: number): number {
  const n = Math.max(1, Math.min(MAX_LEVEL, Math.floor(level)))
  return n * n * n
}

/** 由總經驗反推等級（最大的 n 使 n^3 ≤ exp），夾在 1..MAX_LEVEL */
export function levelFromExp(exp: number): number {
  if (exp < 1) return 1
  let n = Math.floor(Math.cbrt(exp))
  // 浮點保險：往上修到剛好不超過
  while ((n + 1) ** 3 <= exp && n < MAX_LEVEL) n++
  while (n ** 3 > exp && n > 1) n--
  return Math.max(1, Math.min(MAX_LEVEL, n))
}

/** 擊敗一隻 level 寶可夢得到的經驗（依被擊敗者等級；自用平衡值） */
export function expYield(defeatedLevel: number): number {
  const L = Math.max(1, Math.floor(defeatedLevel))
  return Math.floor(L * L * 0.8) + L * 2 + 5
}

export interface ExpResult {
  unit: OwnedUnit
  gained: number
  fromLevel: number
  toLevel: number
  leveledUp: boolean
}

/** 給一隻 OwnedUnit 加經驗、重算等級（等級只增不減），回傳新 unit 與升級資訊 */
export function applyExp(unit: OwnedUnit, gained: number): ExpResult {
  const add = Math.max(0, Math.floor(gained))
  const exp = Math.min(unit.exp + add, expForLevel(MAX_LEVEL))
  const toLevel = Math.max(unit.level, levelFromExp(exp))
  return {
    unit: { ...unit, exp, level: toLevel },
    gained: add,
    fromLevel: unit.level,
    toLevel,
    leveledUp: toLevel > unit.level,
  }
}

/**
 * 由 seed 建一隻 OwnedUnit（個體決定論 roll，exp 對齊起始等級）。
 * `card` 顯式給的 ivs/nature/shiny 會覆寫 seed roll（與 buildBattlePokemon 一致），
 * 讓掃描/自製卡上標的異色等屬性能落到 canonical 存檔，而非被 seed roll 蓋掉。
 */
export function createOwnedUnit(
  seed: string,
  speciesId: number,
  level: number,
  card?: Pick<Card, 'ivs' | 'nature' | 'shiny'>,
): OwnedUnit {
  const ind = rollIndividual(seed)
  const ivs: Stats = card?.ivs
    ? {
        hp: card.ivs.hp ?? ind.ivs.hp,
        atk: card.ivs.atk ?? ind.ivs.atk,
        def: card.ivs.def ?? ind.ivs.def,
        spa: card.ivs.spa ?? ind.ivs.spa,
        spd: card.ivs.spd ?? ind.ivs.spd,
        spe: card.ivs.spe ?? ind.ivs.spe,
      }
    : ind.ivs
  return {
    id: seed,
    speciesId,
    level,
    exp: expForLevel(level),
    ivs,
    nature: card?.nature ?? ind.nature,
    seed,
    shiny: card?.shiny ?? ind.shiny,
  }
}

/** OwnedUnit → 進戰鬥用 Card（帶 canonical 個體，buildBattlePokemon 不再 roll） */
export function ownedToCard(u: OwnedUnit): Card {
  return {
    cardId: u.id,
    speciesId: u.speciesId,
    level: u.level,
    ivs: u.ivs,
    nature: u.nature,
    shiny: u.shiny,
    heldItemId: u.heldItemId,
  }
}
