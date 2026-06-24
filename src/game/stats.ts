import type { BattleMobie, Card, Stats } from '@/game/types'
import { getSpecies } from '@/game/data/species'
import { getMove } from '@/game/data/moves'
import { rollIndividual, natureMultiplier } from '@/game/individual'

/** 本傳 HP 公式（忽略 EV，HP 不受性格影響） */
function hpStat(base: number, ivVal: number, level: number): number {
  return Math.floor(((2 * base + ivVal) * level) / 100) + level + 10
}

/** 本傳其他能力值公式（忽略 EV）＋性格乘數（±10%，最後套用、向下取整） */
function otherStat(base: number, ivVal: number, level: number, natureMult: number): number {
  const raw = Math.floor(((2 * base + ivVal) * level) / 100) + 5
  return Math.floor(raw * natureMult)
}

/**
 * 由卡片（或野生資料）建出進入戰鬥的實例，最終數值一次算好。
 * 個體（IV/性格/異色）由 cardId 決定論 roll；card 若顯式給 ivs/shiny 則覆寫。
 */
export function buildBattleMobie(card: Card): BattleMobie {
  const species = getSpecies(card.speciesId)
  const move = getMove(species.moveId)
  const { baseStats: b } = species
  const lv = card.level

  const ind = rollIndividual(card.cardId)
  const ivOf = (k: keyof Stats): number => card.ivs?.[k] ?? ind.ivs[k]
  const ivs: Stats = {
    hp: ivOf('hp'), atk: ivOf('atk'), def: ivOf('def'),
    spa: ivOf('spa'), spd: ivOf('spd'), spe: ivOf('spe'),
  }
  const nature = card.nature ?? ind.nature
  const maxHp = hpStat(b.hp, ivs.hp, lv)

  return {
    speciesId: species.id,
    name: species.name,
    nameZh: species.nameZh,
    types: species.types,
    level: lv,
    maxHp,
    currentHp: maxHp,
    atk: otherStat(b.atk, ivs.atk, lv, natureMultiplier(nature, 'atk')),
    def: otherStat(b.def, ivs.def, lv, natureMultiplier(nature, 'def')),
    spa: otherStat(b.spa, ivs.spa, lv, natureMultiplier(nature, 'spa')),
    spd: otherStat(b.spd, ivs.spd, lv, natureMultiplier(nature, 'spd')),
    spe: otherStat(b.spe, ivs.spe, lv, natureMultiplier(nature, 'spe')),
    move,
    artworkUrl: species.artworkUrl,
    shiny: card.shiny ?? ind.shiny,
    ivs,
    nature,
    // M7 戰鬥暫態：道具由卡帶入；hook 自行依此分流（道具縫關閉＝無作用）。特性 abilityId 在 Stage 4 補。
    heldItemId: card.heldItemId,
  }
}
