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
  return {
    cardId: `WILD-${picked.speciesId}-${level}`,
    speciesId: picked.speciesId,
    level,
    // 野生個體值略低於玩家卡，讓玩家卡片稍有優勢
    ivs: { hp: 12, atk: 12, def: 12, spa: 12, spd: 12, spe: 12 },
  }
}
