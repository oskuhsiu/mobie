// 共用測試夾具：engine / reducer / accidents 測試共用的 move()/mon() 工廠。
import type { BattlePokemon, Move, TypeName } from '@/game/types'

export function move(type: TypeName, power = 50, accuracy = 100): Move {
  return { id: 1, name: 'Test', nameZh: '測', type, power, accuracy, category: 'physical' }
}

export function mon(over: Partial<BattlePokemon> = {}): BattlePokemon {
  const merged: BattlePokemon = {
    speciesId: 0, name: 'Mon', nameZh: '怪', types: ['normal'], level: 10,
    maxHp: 100, currentHp: 100, atk: 50, def: 50, spa: 50, spd: 50, spe: 50,
    artworkUrl: '', shiny: false, move: move('normal'),
    ivs: { hp: 16, atk: 16, def: 16, spa: 16, spd: 16, spe: 16 }, nature: 0,
    ...over,
  }
  if (over.currentHp === undefined) merged.currentHp = merged.maxHp
  return merged
}
