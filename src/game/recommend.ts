// 選隊輔助：評估手牌對「對手整隊」的屬性攻防適配度，給不熟相剋的玩家明確建議。
// 純函數、無 UI；CardSelectScreen 用來標示剋制/弱勢與一鍵推薦最佳 3 隻。

import type { BattleMobie } from '@/game/types'
import { typeEffectiveness } from '@/game/data/typeChart'

export interface Matchup {
  /** 本卡招式可剋制（效果絕佳 ≥2）的對手數 */
  counters: number
  /** 本卡會被對手招式痛擊（受到 ≥2 倍）的對手數 */
  weakTo: number
  /** 綜合評分（越高越值得出戰） */
  score: number
}

/** 評估一張卡對「對手全隊」的攻防適配度 */
export function scoreCardVsFoes(card: BattleMobie, foes: BattleMobie[]): Matchup {
  let offense = 0
  let risk = 0
  let counters = 0
  let weakTo = 0
  for (const f of foes) {
    const o = typeEffectiveness(card.move.type, f.types) // 我方招式打它
    const d = typeEffectiveness(f.move.type, card.types) // 它的招式打我方
    offense += o
    risk += d
    if (o >= 2) counters++
    if (d >= 2) weakTo++
  }
  // 攻擊優勢為主、被剋為輔；再以等級與綜合能力微調當 tie-break
  const bulk = (card.maxHp + card.atk + card.spa + card.def + card.spd + card.spe) / 6
  const score = offense - 0.6 * risk + card.level * 0.05 + bulk * 0.01
  return { counters, weakTo, score }
}

/** 從手牌挑出最佳出戰陣容（回傳 cardId 陣列，依評分高→低，長度最多 size） */
export function recommendTeamIds(
  entries: Array<{ id: string; mon: BattleMobie }>,
  foes: BattleMobie[],
  size: number,
): string[] {
  return entries
    .map((e) => ({ id: e.id, s: scoreCardVsFoes(e.mon, foes).score }))
    .sort((a, b) => b.s - a.s)
    .slice(0, size)
    .map((x) => x.id)
}
