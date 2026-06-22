import type { Card } from '@/game/types'

/**
 * M1 玩家假卡 roster（手牌）。
 * M2 會由掃描實體卡 QR 取代；這裡先給跨屬性的 5 張，
 * 讓玩家面對任何區域都有屬性相剋的策略選擇。
 */
export const PLAYER_CARDS: Card[] = [
  { cardId: 'DEV-CHARMANDER', speciesId: 4, level: 14, ivs: { hp: 20, atk: 20, def: 15, spa: 25, spd: 15, spe: 20 } },
  { cardId: 'DEV-SQUIRTLE', speciesId: 7, level: 14, ivs: { hp: 22, atk: 18, def: 25, spa: 18, spd: 22, spe: 12 } },
  { cardId: 'DEV-BULBASAUR', speciesId: 1, level: 14, ivs: { hp: 22, atk: 18, def: 18, spa: 24, spd: 24, spe: 16 } },
  { cardId: 'DEV-PIKACHU', speciesId: 25, level: 15, ivs: { hp: 18, atk: 20, def: 14, spa: 20, spd: 18, spe: 28 }, shiny: true },
  { cardId: 'DEV-MACHOP', speciesId: 66, level: 14, ivs: { hp: 26, atk: 28, def: 18, spa: 12, spd: 14, spe: 14 } },
]
