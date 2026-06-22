import type { Region } from '@/game/types'

/** M1 區域：3 個主題化區域，各有野生遭遇表 */
export const REGIONS: Region[] = [
  {
    id: 'verdant-forest',
    name: '常綠森林',
    gradient: ['#1f6e43', '#0c3a24'],
    icon: '🌳',
    blurb: '蟲與草系出沒的蓊鬱林地，新手最佳起點。',
    encounters: [
      { speciesId: 1, weight: 3, minLevel: 8, maxLevel: 12 },
      { speciesId: 10, weight: 4, minLevel: 6, maxLevel: 10 },
      { speciesId: 16, weight: 3, minLevel: 7, maxLevel: 11 },
      { speciesId: 133, weight: 2, minLevel: 9, maxLevel: 13 },
      { speciesId: 25, weight: 1, minLevel: 10, maxLevel: 14 },
    ],
  },
  {
    id: 'ember-volcano',
    name: '灼熱火山',
    gradient: ['#b3361f', '#5c1208'],
    icon: '🌋',
    blurb: '岩漿與礫石交錯，火、岩、格鬥系的領域。',
    encounters: [
      { speciesId: 4, weight: 3, minLevel: 9, maxLevel: 13 },
      { speciesId: 37, weight: 3, minLevel: 9, maxLevel: 13 },
      { speciesId: 74, weight: 3, minLevel: 8, maxLevel: 12 },
      { speciesId: 66, weight: 2, minLevel: 10, maxLevel: 14 },
    ],
  },
  {
    id: 'crystal-shore',
    name: '澄澈水濱',
    gradient: ['#1b6fb3', '#0a2f5c'],
    icon: '🌊',
    blurb: '清澈水域與電光交織，水、電、幽靈系棲息。',
    encounters: [
      { speciesId: 7, weight: 3, minLevel: 9, maxLevel: 13 },
      { speciesId: 60, weight: 4, minLevel: 7, maxLevel: 11 },
      { speciesId: 25, weight: 2, minLevel: 10, maxLevel: 14 },
      { speciesId: 92, weight: 2, minLevel: 10, maxLevel: 14 },
    ],
  },
]

export function getRegion(id: string): Region {
  const r = REGIONS.find((x) => x.id === id)
  if (!r) throw new Error(`Unknown region id: ${id}`)
  return r
}
