import type { Species } from '@/game/types'

const artwork = (id: number) =>
  `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`

/** M1 種族 seed：12 隻，屬性分布利於屬性相剋對戰 */
export const SPECIES: Record<number, Species> = {
  1: {
    id: 1, name: 'Bulbasaur', nameZh: '妙蛙種子', types: ['grass', 'poison'],
    baseStats: { hp: 45, atk: 49, def: 49, spa: 65, spd: 65, spe: 45 },
    moveId: 22, artworkUrl: artwork(1),
  },
  4: {
    id: 4, name: 'Charmander', nameZh: '小火龍', types: ['fire'],
    baseStats: { hp: 39, atk: 52, def: 43, spa: 60, spd: 50, spe: 65 },
    moveId: 52, artworkUrl: artwork(4),
  },
  7: {
    id: 7, name: 'Squirtle', nameZh: '傑尼龜', types: ['water'],
    baseStats: { hp: 44, atk: 48, def: 65, spa: 50, spd: 64, spe: 43 },
    moveId: 55, artworkUrl: artwork(7),
  },
  25: {
    id: 25, name: 'Pikachu', nameZh: '皮卡丘', types: ['electric'],
    baseStats: { hp: 35, atk: 55, def: 40, spa: 50, spd: 50, spe: 90 },
    moveId: 85, artworkUrl: artwork(25),
  },
  10: {
    id: 10, name: 'Caterpie', nameZh: '綠毛蟲', types: ['bug'],
    baseStats: { hp: 45, atk: 30, def: 35, spa: 20, spd: 20, spe: 45 },
    moveId: 450, artworkUrl: artwork(10),
  },
  16: {
    id: 16, name: 'Pidgey', nameZh: '波波', types: ['normal', 'flying'],
    baseStats: { hp: 40, atk: 45, def: 40, spa: 35, spd: 35, spe: 56 },
    moveId: 16, artworkUrl: artwork(16),
  },
  74: {
    id: 74, name: 'Geodude', nameZh: '小拳石', types: ['rock', 'ground'],
    baseStats: { hp: 40, atk: 80, def: 100, spa: 30, spd: 30, spe: 20 },
    moveId: 88, artworkUrl: artwork(74),
  },
  66: {
    id: 66, name: 'Machop', nameZh: '腕力', types: ['fighting'],
    baseStats: { hp: 70, atk: 80, def: 50, spa: 35, spd: 35, spe: 35 },
    moveId: 2, artworkUrl: artwork(66),
  },
  92: {
    id: 92, name: 'Gastly', nameZh: '鬼斯', types: ['ghost', 'poison'],
    baseStats: { hp: 30, atk: 35, def: 30, spa: 100, spd: 35, spe: 80 },
    moveId: 247, artworkUrl: artwork(92),
  },
  133: {
    id: 133, name: 'Eevee', nameZh: '伊布', types: ['normal'],
    baseStats: { hp: 55, atk: 55, def: 50, spa: 45, spd: 65, spe: 55 },
    moveId: 98, artworkUrl: artwork(133),
  },
  37: {
    id: 37, name: 'Vulpix', nameZh: '六尾', types: ['fire'],
    baseStats: { hp: 38, atk: 41, def: 40, spa: 50, spd: 65, spe: 65 },
    moveId: 53, artworkUrl: artwork(37),
  },
  60: {
    id: 60, name: 'Poliwag', nameZh: '蚊香蝌蚪', types: ['water'],
    baseStats: { hp: 40, atk: 50, def: 40, spa: 40, spd: 40, spe: 90 },
    moveId: 145, artworkUrl: artwork(60),
  },
}

export function getSpecies(id: number): Species {
  const s = SPECIES[id]
  if (!s) throw new Error(`Unknown species id: ${id}`)
  return s
}
