// 共用測試夾具：engine / reducer / accidents 測試共用的 move()/mon() 工廠。
import type { BattleMobie, Move, TypeName } from '@/game/types'

export function move(type: TypeName, power = 50, accuracy = 100): Move {
  return { id: 1, name: 'Test', nameZh: '測', type, power, accuracy, category: 'physical' }
}

export function mon(over: Partial<BattleMobie> = {}): BattleMobie {
  const base = move('normal')
  const merged: BattleMobie = {
    speciesId: 0, name: 'Mon', nameZh: '怪', types: ['normal'], level: 10,
    maxHp: 100, currentHp: 100, atk: 50, def: 50, spa: 50, spd: 50, spe: 50,
    artworkUrl: '', shiny: false, move: base, moves: [base],
    ivs: { hp: 16, atk: 16, def: 16, spa: 16, spd: 16, spe: 16 }, nature: 0,
    ...over,
  }
  // 保持 move/moves 一致（M19 過渡）：只給其一時同步另一邊。
  if (over.moves === undefined) merged.moves = [merged.move]
  else if (over.move === undefined) merged.move = merged.moves[0]
  if (over.currentHp === undefined) merged.currentHp = merged.maxHp
  return merged
}
