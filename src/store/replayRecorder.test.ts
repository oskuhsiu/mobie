import { describe, it, expect, vi } from 'vitest'
import { ReplayRecorder } from './replayRecorder'
import type { RecorderStart, ReplayRecorderDependencies } from './replayRecorder'
import type { BattleEvent } from '@/game/battle/reducer'
import { hashSeed } from '@/game/rng'
import { encodeReplay } from '@/game/replay/codec'

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

  it('tryRecord 清楚區分 inactive、recorded 與首次失敗後的 disabled', () => {
    const r = new ReplayRecorder()
    expect(r.tryRecord({ type: 'ATTACK' }, [ev])).toEqual({ status: 'inactive' })

    r.start(START)
    expect(r.tryRecord({ type: 'ATTACK' }, [ev])).toEqual({ status: 'recorded' })

    const failure = new Error('event copy failed')
    const brokenEvents = new Proxy([] as BattleEvent[], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) throw failure
        return Reflect.get(target, property, receiver)
      },
    })
    expect(r.tryRecord({ type: 'ATTACK' }, brokenEvents)).toEqual({ status: 'failed', error: failure })
    expect(r.active).toBe(false)
    expect(r.build('win')).toBeNull()
    expect(r.tryRecord({ type: 'ATTACK' }, [ev])).toEqual({ status: 'disabled' })

    r.start(START)
    expect(r.tryRecord({ type: 'ATTACK' }, [ev])).toEqual({ status: 'recorded' })
  })

  it('stages a turn without changing the canonical replay until commitPrepared', () => {
    const r = new ReplayRecorder()
    r.start(START)
    const prepared = r.prepareTurn({ type: 'ATTACK' }, [ev])
    expect(prepared.status).toBe('prepared')
    expect(r.build('win')).toBeNull()
    if (prepared.status !== 'prepared') throw new Error('expected prepared replay turn')
    expect(r.commitPrepared(prepared.turn)).toEqual({ status: 'recorded' })
    expect(r.build('win')?.turns).toHaveLength(1)
  })

  it('contains build, encode, and persistence failures without throwing', async () => {
    const makeDependencies = (overrides: Partial<ReplayRecorderDependencies> = {}): ReplayRecorderDependencies => ({
      hashSeed,
      encodeReplay,
      putReplay: vi.fn().mockResolvedValue(undefined),
      ...overrides,
    })

    const brokenBuild = new ReplayRecorder(makeDependencies({
      hashSeed: () => { throw new Error('hash failed') },
    }))
    brokenBuild.start(START)
    brokenBuild.record({ type: 'ATTACK' }, [ev])
    expect(() => brokenBuild.build('win')).not.toThrow()
    expect(brokenBuild.active).toBe(false)

    const brokenEncode = new ReplayRecorder(makeDependencies({
      encodeReplay: () => { throw new Error('encode failed') },
    }))
    brokenEncode.start(START)
    brokenEncode.record({ type: 'ATTACK' }, [ev])
    await expect(brokenEncode.finish('win')).resolves.toBe(false)
    expect(brokenEncode.active).toBe(false)

    const brokenPersist = new ReplayRecorder(makeDependencies({
      putReplay: vi.fn().mockRejectedValue(new Error('persist failed')),
    }))
    brokenPersist.start(START)
    brokenPersist.record({ type: 'ATTACK' }, [ev])
    await expect(brokenPersist.finish('win')).resolves.toBe(false)
    expect(brokenPersist.active).toBe(false)
  })
})
