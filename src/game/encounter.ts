import type { Card, Region } from '@/game/types'

/** 依權重從區域遭遇表抽一隻野生寶可夢，回傳可進 buildBattlePokemon 的 Card */
export function rollEncounter(region: Region, rng: () => number = Math.random): Card {
  const table = region.encounters
  const total = table.reduce((s, e) => s + e.weight, 0)
  let roll = rng() * total
  let picked = table[0]
  for (const e of table) {
    roll -= e.weight
    if (roll <= 0) {
      picked = e
      break
    }
  }
  const level = picked.minLevel + Math.floor(rng() * (picked.maxLevel - picked.minLevel + 1))
  // 個體（IV/性格/異色）由 buildBattlePokemon 依 cardId 決定論 roll；加 rng 後綴讓同種同階也有不同個體
  const tag = Math.floor(rng() * 1e6).toString(36)
  return {
    cardId: `WILD-${picked.speciesId}-${level}-${tag}`,
    speciesId: picked.speciesId,
    level,
  }
}

/**
 * 抽一支對手隊伍（3v3 用）。各隻獨立抽取，cardId 補上 index 後綴避免重複（React key）。
 * 末隻視為 boss（勝利後的捕獲對象）。
 */
export function rollEncounterTeam(region: Region, size = 3, rng: () => number = Math.random): Card[] {
  return Array.from({ length: size }, (_, i) => {
    const c = rollEncounter(region, rng)
    return { ...c, cardId: `${c.cardId}-${i}` }
  })
}
