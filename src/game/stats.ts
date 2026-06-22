import type { BattlePokemon, Card, Stats } from '@/game/types'
import { getSpecies } from '@/game/data/species'
import { getMove } from '@/game/data/moves'

const DEFAULT_IV = 16

function iv(ivs: Partial<Stats> | undefined, key: keyof Stats): number {
  const v = ivs?.[key]
  return typeof v === 'number' ? v : DEFAULT_IV
}

/** 本傳 HP 公式（忽略 EV / 性格，MVP 簡化） */
function hpStat(base: number, ivVal: number, level: number): number {
  return Math.floor(((2 * base + ivVal) * level) / 100) + level + 10
}

/** 本傳其他能力值公式（忽略 EV / 性格） */
function otherStat(base: number, ivVal: number, level: number): number {
  return Math.floor(((2 * base + ivVal) * level) / 100) + 5
}

/** 由卡片（或野生資料）建出進入戰鬥的實例，最終數值一次算好 */
export function buildBattlePokemon(card: Card): BattlePokemon {
  const species = getSpecies(card.speciesId)
  const move = getMove(species.moveId)
  const { baseStats: b } = species
  const lv = card.level

  const maxHp = hpStat(b.hp, iv(card.ivs, 'hp'), lv)

  return {
    speciesId: species.id,
    name: species.name,
    nameZh: species.nameZh,
    types: species.types,
    level: lv,
    maxHp,
    currentHp: maxHp,
    atk: otherStat(b.atk, iv(card.ivs, 'atk'), lv),
    def: otherStat(b.def, iv(card.ivs, 'def'), lv),
    spa: otherStat(b.spa, iv(card.ivs, 'spa'), lv),
    spd: otherStat(b.spd, iv(card.ivs, 'spd'), lv),
    spe: otherStat(b.spe, iv(card.ivs, 'spe'), lv),
    move,
    artworkUrl: species.artworkUrl,
    shiny: card.shiny ?? false,
  }
}
