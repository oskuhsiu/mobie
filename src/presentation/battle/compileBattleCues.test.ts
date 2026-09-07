import { createBattleState, type BattleEvent } from '@/game/battle/reducer'
import { mon, move } from '@/game/battle/testFixtures'
import type { ReplayInput } from '@/game/replay/types'
import { compileBattleCues } from './compileBattleCues'
import type { TurnPresentationJob } from './contracts'

const token = { battleSessionId: 'battle', resultFingerprint: 'fingerprint', presentationId: 1, purpose: 'turn' as const }

function job(input: ReplayInput, events: readonly BattleEvent[]): TurnPresentationJob {
  return {
    kind: 'turn', token,
    before: createBattleState([mon()], [mon()]), input, events,
    battleSeed: 'seed', turn: 1,
  }
}

describe('compileBattleCues', () => {
  it.each([
    ['physical', 'electric', 'physical'],
    ['special', 'electric', 'electric'],
    ['special', 'fire', null],
  ] as const)('selects tracer from resolved %s/%s move, not the default move', (category, type, tracerRecipe) => {
    const selected = { ...move(type), id: 7, category }
    const before = createBattleState([mon({ moves: [selected] })], [mon()])
    const event: BattleEvent = {
      type: 'damageApplied', attackerSide: 'player', attackerIndex: 0,
      targetSide: 'foe', targetIndex: 0, amount: 10, missed: false, crit: false,
      effectiveness: 1, effectivenessText: null, hpBefore: 100, hpAfter: 90,
      maxHp: 100, resolvedMoveId: 7,
    }
    expect(compileBattleCues({ ...job({ type: 'ATTACK' }, [event]), before })[0])
      .toMatchObject({ kind: 'damage', tracerRecipe })
  })

  it('preserves event order and legacy damage timing/move identity', () => {
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
    const cues = compileBattleCues({ ...job({ type: 'ATTACK', slotIndex: 1 }, events), before })

    expect(cues.map((cue) => [cue.kind, cue.id])).toEqual([
      ['intentional-noop', 'event:0:random:accuracy'],
      ['damage', 'event:1:damageApplied'],
      ['legacy-event', 'event:2:memberFainted'],
    ])
    const damage = cues[1]
    if (damage?.kind !== 'damage') throw new Error('expected damage cue')
    expect(damage).toMatchObject({
      attacker: before.player.members[0], defender: before.foe.members[0], move: selected,
      normalAttack: true,
      timing: { windupMs: 160, resultMs: 640, clearMs: 140 },
    })
  })

  it('keeps normal camera timing off star, chain, combo, and support damage', () => {
    const playerDamage: BattleEvent = {
      type: 'damageApplied', attackerSide: 'player', attackerIndex: 0,
      targetSide: 'foe', targetIndex: 0, amount: 10, missed: false,
      crit: false, effectiveness: 1, effectivenessText: null,
      hpBefore: 100, hpAfter: 90, maxHp: 100,
    }
    const foeDamage: BattleEvent = { ...playerDamage, attackerSide: 'foe', targetSide: 'player' }
    const supportDamage: BattleEvent = { ...playerDamage, attackerIndex: 1 }
    const before = createBattleState([mon(), mon()], [mon()])
    const compile = (input: ReplayInput, event: BattleEvent) => {
      const cue = compileBattleCues({ ...job(input, [event]), before })
        .find((candidate) => candidate.kind === 'damage')
      if (cue?.kind !== 'damage') throw new Error('expected damage cue')
      return cue
    }

    expect(compile({ type: 'ATTACK' }, playerDamage).normalAttack).toBe(true)
    expect(compile({ type: 'ATTACK', starStrike: true }, playerDamage).normalAttack).toBe(false)
    expect(compile({ type: 'CHAIN', hits: [] }, playerDamage).normalAttack).toBe(false)
    expect(compile({ type: 'ATTACK' }, supportDamage).normalAttack).toBe(false)
    expect(compile({ type: 'CHAIN', hits: [] }, foeDamage).normalAttack).toBe(true)
  })

  it.each<readonly [ReplayInput, readonly string[]]>([
    [{ type: 'ATTACK' }, []],
    [{ type: 'SWITCH', index: 1 }, []],
    [{ type: 'ATTACK', starStrike: true }, ['star-prelude']],
    [{ type: 'CHAIN', hits: [] }, ['chain-prelude', 'chain-cleanup']],
  ])('compiles input %j with action cue boundaries', (input, expected) => {
    expect(compileBattleCues(job(input, [])).map((cue) => cue.kind)).toEqual(expected)
  })

  it('infers star only from input, never from a critical damage event', () => {
    const damage: BattleEvent = {
      type: 'damageApplied', attackerSide: 'player', attackerIndex: 0,
      targetSide: 'foe', targetIndex: 0, amount: 10, missed: false, crit: true,
      effectiveness: 1, effectivenessText: null, hpBefore: 100, hpAfter: 90, maxHp: 100,
    }
    expect(compileBattleCues(job({ type: 'ATTACK' }, [damage])).map((cue) => cue.kind)).toEqual(['damage'])
    expect(compileBattleCues(job({ type: 'ATTACK', starStrike: true }, [damage])).map((cue) => cue.kind))
      .toEqual(['star-prelude', 'damage'])
  })

  it.each(['accuracy', 'crit', 'ballRoulette'] as const)('marks random %s as intentional no-op', (type) => {
    const event: BattleEvent = { type: 'random', event: { type, actorId: 'p', roll: 0.2, outcome: 'x', source: 'test' } }
    expect(compileBattleCues(job({ type: 'ATTACK' }, [event]))[0]?.kind).toBe('intentional-noop')
  })

  it('routes support roulette and every nested gameplay variant to legacy cues', () => {
    const events: BattleEvent[] = [
      { type: 'random', event: { type: 'supportRoulette', actorId: 'p', roll: 0.2, outcome: 'ally', source: 'test' } },
      { type: 'wildAccident', kind: 'terrainShift', terrainId: 'volcanic' },
      { type: 'wildAccident', kind: 'intrusion', side: 'player', index: 0, amount: 2, hpAfter: 98 },
      { type: 'statusApplied', side: 'player', index: 0, moveId: 1, effectKind: 'buff', label: 'buff', remaining: 2 },
      { type: 'statusApplied', side: 'player', index: 0, moveId: 1, effectKind: 'heal', label: 'heal', remaining: 0 },
      { type: 'statusApplied', side: 'player', index: 0, moveId: 1, effectKind: 'terrain', label: 'terrain', remaining: 0 },
      { type: 'comboCast', key: 'a', name: 'a', icon: 'a', castKind: 'infuseTerrain', label: 'a', remaining: 1 },
      { type: 'comboCast', key: 'b', name: 'b', icon: 'b', castKind: 'teamBuff', label: 'b', remaining: 1 },
      { type: 'comboCast', key: 'c', name: 'c', icon: 'c', castKind: 'enemyDebuff', label: 'c', remaining: 1 },
    ]
    expect(compileBattleCues(job({ type: 'SWITCH', index: 0 }, events)).map((cue) => cue.kind))
      .toEqual(events.map(() => 'legacy-event'))
  })

  it('emits one semantic outcome cue and rejects duplicates', () => {
    const win: BattleEvent = { type: 'battleEnded', winner: 'player' }
    expect(compileBattleCues(job({ type: 'ATTACK' }, [win]))).toMatchObject([
      { kind: 'battle-outcome', event: win },
    ])
    expect(() => compileBattleCues(job({ type: 'ATTACK' }, [win, win])))
      .toThrow('at most one battleEnded')
  })
})
