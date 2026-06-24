import { describe, it, expect } from 'vitest'
import type { Move, TypeName } from '@/game/types'
import { createBattleState, resolveTurn, chooseOpponentMove } from './reducer'
import { mon } from './testFixtures'
import { hashSeed } from '@/game/individual'

function mv(id: number, type: TypeName, power = 70): Move {
  return { id, name: `M${id}`, nameZh: `招${id}`, type, power, accuracy: 100, category: 'physical' }
}
function rngFrom(seed: string): () => number {
  let s = hashSeed(seed)
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const NORMAL = mv(2001, 'normal', 60)
const FIRE = mv(2002, 'fire', 90)

describe('M19.b 多招式 reducer/engine（additive）', () => {
  it('action.slotIndex 路由到對應槽：resolvedMoveId 寫進 damageApplied', () => {
    const player = mon({ moves: [NORMAL, FIRE], types: ['normal'], spe: 99 }) // 玩家先手
    const foe = mon({ moves: [mv(2003, 'water', 40)], types: ['water'], maxHp: 999, currentHp: 999 })
    const state = createBattleState([player], [foe])
    const { events } = resolveTurn(state, { type: 'ATTACK', slotIndex: 1, quality: 'normal' }, { rng: rngFrom('a') })
    const dmg = events.find((e) => e.type === 'damageApplied' && e.attackerSide === 'player')
    expect(dmg && dmg.type === 'damageApplied' && dmg.resolvedMoveId).toBe(FIRE.id)
  })

  it('無 slotIndex → slot0（向後相容，resolvedMoveId=moves[0]）', () => {
    const player = mon({ moves: [NORMAL, FIRE], types: ['normal'], spe: 99 })
    const foe = mon({ moves: [mv(2003, 'water', 40)], types: ['water'], maxHp: 999, currentHp: 999 })
    const state = createBattleState([player], [foe])
    const { events } = resolveTurn(state, { type: 'ATTACK', quality: 'normal' }, { rng: rngFrom('a') })
    const dmg = events.find((e) => e.type === 'damageApplied' && e.attackerSide === 'player')
    expect(dmg && dmg.type === 'damageApplied' && dmg.resolvedMoveId).toBe(NORMAL.id)
  })

  it('chooseOpponentMove：單招回 0、且不消耗 rng（保既有測試序）', () => {
    let calls = 0
    const rng = () => { calls++; return 0.5 }
    const single = mon({ moves: [NORMAL] })
    const def = mon({ types: ['fire'] })
    expect(chooseOpponentMove(single, def, rng)).toBe(0)
    expect(calls).toBe(0)
  })

  it('chooseOpponentMove：決定論（同 rng 序 → 同結果）', () => {
    const atk = mon({ moves: [NORMAL, FIRE], types: ['normal'] })
    const def = mon({ types: ['grass'] })
    expect(chooseOpponentMove(atk, def, rngFrom('z'))).toBe(chooseOpponentMove(atk, def, rngFrom('z')))
  })

  it('chooseOpponentMove：加權偏好剋制招（grass 打 water）', () => {
    // attacker 純 grass：moves=[normal, grass]；defender water。grass 剋 water 且本系 → 高權。
    const atk = mon({ moves: [mv(3001, 'normal', 60), mv(3002, 'grass', 60)], types: ['grass'] })
    const def = mon({ types: ['water'] })
    // 權重 normal=1、grass=eff(2→3)×stab(2)=6；total=7。rng()=0.5 → r=3.5 跨過 normal(1) 落在 grass。
    expect(chooseOpponentMove(atk, def, () => 0.5)).toBe(1)
    expect(chooseOpponentMove(atk, def, () => 0)).toBe(0) // r=0 落第一槽
  })
})
