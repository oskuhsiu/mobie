import type { Move } from '@/game/types'

/** M1 招式池：每隻寶可夢一個專屬招式 */
export const MOVES: Record<number, Move> = {
  22: { id: 22, name: 'Vine Whip', nameZh: '藤鞭', type: 'grass', power: 45, accuracy: 100, category: 'physical' },
  52: { id: 52, name: 'Ember', nameZh: '火花', type: 'fire', power: 40, accuracy: 100, category: 'special' },
  55: { id: 55, name: 'Water Gun', nameZh: '水槍', type: 'water', power: 40, accuracy: 100, category: 'special' },
  85: { id: 85, name: 'Thunderbolt', nameZh: '十萬伏特', type: 'electric', power: 90, accuracy: 100, category: 'special' },
  450: { id: 450, name: 'Bug Bite', nameZh: '蟲咬', type: 'bug', power: 60, accuracy: 100, category: 'physical' },
  16: { id: 16, name: 'Gust', nameZh: '起風', type: 'flying', power: 40, accuracy: 100, category: 'special' },
  88: { id: 88, name: 'Rock Throw', nameZh: '落石', type: 'rock', power: 50, accuracy: 90, category: 'physical' },
  2: { id: 2, name: 'Karate Chop', nameZh: '空手劈', type: 'fighting', power: 50, accuracy: 100, category: 'physical' },
  247: { id: 247, name: 'Shadow Ball', nameZh: '暗影球', type: 'ghost', power: 80, accuracy: 100, category: 'special' },
  98: { id: 98, name: 'Quick Attack', nameZh: '電光一閃', type: 'normal', power: 40, accuracy: 100, category: 'physical' },
  53: { id: 53, name: 'Flamethrower', nameZh: '噴射火焰', type: 'fire', power: 90, accuracy: 100, category: 'special' },
  145: { id: 145, name: 'Bubble', nameZh: '泡沫', type: 'water', power: 40, accuracy: 100, category: 'special' },
}

export function getMove(id: number): Move {
  const m = MOVES[id]
  if (!m) throw new Error(`Unknown move id: ${id}`)
  return m
}
