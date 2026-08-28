import { createBattleState, type BattleEvent } from '@/game/battle/reducer'
import { mon, move } from '@/game/battle/testFixtures'
import { compileBattleCues } from './compileBattleCues'
import type { TurnPresentationJob } from './contracts'

describe('compileBattleCues', () => {
  it('preserves event order and stable ids while compiling legacy normal-attack timing and move identity', () => {
    const fallback = { ...move('normal'), id: 1, nameZh: '基礎招' }
    const selected = { ...move('fire'), id: 7, nameZh: '火招' }
    const before = createBattleState(
      [mon({ move: fallback, moves: [fallback, selected] })],
      [mon({ nameZh: '守方' })],
    )
    const events: BattleEvent[] = [
      { type: 'random', event: { type: 'accuracy', actorId: 'p', roll: 0.5, outcome: 'hit', source: 'attack' } },
      {
        type: 'damageApplied', attackerSide: 'player', attackerIndex: 0,
        targetSide: 'foe', targetIndex: 0, amount: 12, missed: false,
        crit: false, effectiveness: 1, effectivenessText: null,
        hpBefore: 100, hpAfter: 88, maxHp: 100, resolvedMoveId: 7,
      },
      { type: 'memberFainted', side: 'foe', index: 0 },
    ]
    const job: TurnPresentationJob = {
      kind: 'turn', token: { battleSessionId: 'battle', presentationId: 1 },
      before, input: { type: 'ATTACK', slotIndex: 1 }, events,
    }

    const cues = compileBattleCues(job)

    expect(cues.map((cue) => [cue.kind, cue.id])).toEqual([
      ['legacy-event', 'event:0:random'],
      ['normal-attack', 'event:1:damageApplied'],
      ['legacy-event', 'event:2:memberFainted'],
    ])
    expect(cues[0]?.event).toBe(events[0])
    expect(cues[2]?.event).toBe(events[2])
    expect(cues[1]).toMatchObject({
      attacker: before.player.members[0],
      defender: before.foe.members[0],
      move: selected,
      timing: { windupMs: 440, resultMs: 820, clearMs: 140 },
    })
  })

  it('falls back to the actor legacy move and rejects star attacks', () => {
    const before = createBattleState([mon()], [mon()])
    const event: BattleEvent = {
      type: 'damageApplied', attackerSide: 'player', attackerIndex: 0,
      targetSide: 'foe', targetIndex: 0, amount: 1, missed: false,
      crit: false, effectiveness: 1, effectivenessText: null,
      hpBefore: 100, hpAfter: 99, maxHp: 100, resolvedMoveId: 999,
    }
    const base = {
      kind: 'turn' as const,
      token: { battleSessionId: 'battle', presentationId: 1 },
      before,
      input: { type: 'ATTACK' as const },
      events: [event],
    }
    expect(compileBattleCues(base)[0]).toMatchObject({ move: before.player.members[0].move })
    expect(() => compileBattleCues({
      ...base,
      input: { type: 'ATTACK', starStrike: true } as never,
    })).toThrow('non-star ATTACK')
  })
})
