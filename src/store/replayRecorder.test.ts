import { describe, it, expect } from 'vitest'
import { ReplayRecorder } from './replayRecorder'
import type { RecorderStart } from './replayRecorder'
import type { BattleEvent } from '@/game/battle/reducer'

const START: RecorderStart = {
  battleSeed: 'seed-1',
  regionId: 'grassland',
  mode: 'wild',
  createdAt: 1_700_000_000_000,
  snapshot: [
    { instanceId: 'player:0', side: 'player', slot: 0, speciesId: 1, displayName: '妙蛙種子', level: 12, maxHp: 40, initialHp: 40, shiny: false },
    { instanceId: 'foe:0', side: 'foe', slot: 0, speciesId: 4, displayName: '小火龍', level: 11, maxHp: 36, initialHp: 36, shiny: false },
  ],
}

const ev: BattleEvent = { type: 'damageApplied', attackerSide: 'player', attackerIndex: 0, targetSide: 'foe', targetIndex: 0, amount: 10, missed: false, crit: false, effectiveness: 1, effectivenessText: null, hpBefore: 36, hpAfter: 26, maxHp: 36 }

describe('ReplayRecorder', () => {
  it('未 start ⇒ active=false、record/build 為 no-op', () => {
    const r = new ReplayRecorder()
    expect(r.active).toBe(false)
    r.record({ type: 'ATTACK' }, [ev])
    expect(r.build('win')).toBeNull()
  })

  it('start → record → build 組出 ReplayLog（含 battleId/seed/turns）', () => {
    const r = new ReplayRecorder()
    r.start(START)
    expect(r.active).toBe(true)
    r.record({ type: 'ATTACK', quality: 'good', slotIndex: 1 }, [ev])
    r.record({ type: 'ATTACK', starStrike: true }, [ev, { type: 'memberFainted', side: 'foe', index: 0 }, { type: 'battleEnded', winner: 'player' }])
    const log = r.build('win')
    expect(log).not.toBeNull()
    expect(log!.header.battleSeed).toBe('seed-1')
    expect(log!.header.outcome).toBe('win')
    expect(log!.header.battleId).toBeTruthy()
    expect(log!.turns).toHaveLength(2)
    expect(log!.turns[0].input).toMatchObject({ type: 'ATTACK', slotIndex: 1 })
  })

  it('battleId 決定論：同 seed+snapshot 兩次相同', () => {
    const a = new ReplayRecorder(); a.start(START); a.record({ type: 'ATTACK' }, [ev])
    const b = new ReplayRecorder(); b.start(START); b.record({ type: 'ATTACK' }, [ev])
    expect(a.build('win')!.header.battleId).toBe(b.build('win')!.header.battleId)
  })

  it('start 後無回合 ⇒ build=null（不存空回放）', () => {
    const r = new ReplayRecorder()
    r.start(START)
    expect(r.build('lose')).toBeNull()
  })
})
