import { createActor } from 'xstate'
import { describe, expect, it } from 'vitest'
import { gameMachine, INITIAL_GAME_CONTEXT } from './gameMachine'
import { createBattleIdentity, type BattleIdentityCrypto } from '@/presentation/battle/battleIdentity'
import { classifyResultIdentity } from '@/presentation/battle/resultIdentity'
import { PLAYER_CARDS } from '@/game/data/playerCards'

function battleActor() {
  const snapshot = gameMachine.resolveState({
    value: 'battle',
    context: { ...INITIAL_GAME_CONTEXT },
  })
  return createActor(gameMachine, { snapshot }).start()
}

describe('gameMachine result handoff', () => {
  it('preserves the exact coordinator payload and ignores repeats after transition', () => {
    const actor = battleActor()
    const handoff = {
      resultId: 'battle-1',
      resultFingerprint: 'fingerprint-1',
      outcome: 'win' as const,
    }

    actor.send({ type: 'END_BATTLE', ...handoff })
    expect(actor.getSnapshot().value).toBe('result')
    expect(actor.getSnapshot().context.battleResult).toEqual(handoff)
    expect(actor.getSnapshot().context.outcome).toBe('win')

    actor.send({ type: 'END_BATTLE', ...handoff })
    expect(actor.getSnapshot().context.battleResult).toEqual(handoff)

    actor.send({
      type: 'END_BATTLE',
      resultId: 'battle-2',
      resultFingerprint: 'fingerprint-2',
      outcome: 'lose',
    })
    expect(actor.getSnapshot().context.battleResult).toEqual(handoff)
    actor.stop()
  })

  it('keeps the timeout reason on the stable Result handoff', () => {
    const actor = battleActor()
    const handoff = {
      resultId: 'battle-timeout',
      resultFingerprint: 'fingerprint-timeout',
      outcome: 'win' as const,
      reason: 'timeout' as const,
    }

    actor.send({ type: 'END_BATTLE', ...handoff })

    expect(actor.getSnapshot().context.battleResult).toEqual(handoff)
    actor.stop()
  })

  it('retains a restored handoff and exposes a deterministic cold-reload collision', () => {
    let call = 0
    const crypto: BattleIdentityCrypto = {
      randomUUID: () => (++call % 2 === 1 ? 'reused-result-id' : `fingerprint-${Math.ceil(call / 2)}`),
      getRandomValues: (array) => array,
    }
    const first = createBattleIdentity(crypto)
    const restored = {
      resultId: first.battleSessionId,
      resultFingerprint: first.resultFingerprint,
      outcome: 'win' as const,
    }
    const snapshot = gameMachine.resolveState({
      value: 'result',
      context: { ...INITIAL_GAME_CONTEXT, outcome: 'win', battleResult: restored },
    })
    const actor = createActor(gameMachine, { snapshot }).start()

    expect(actor.getSnapshot().context.battleResult).toEqual(restored)

    const afterReload = createBattleIdentity(crypto)
    expect(classifyResultIdentity(restored, {
      resultId: afterReload.battleSessionId,
      resultFingerprint: afterReload.resultFingerprint,
    })).toBe('collision')
    actor.stop()
  })

  it('clears the handoff before retrying an encounter', () => {
    const snapshot = gameMachine.resolveState({
      value: 'result',
      context: {
        ...INITIAL_GAME_CONTEXT,
        outcome: 'lose',
        battleResult: { resultId: 'old', resultFingerprint: 'old-fp', outcome: 'lose' },
        regionId: 'verdant-forest',
      },
    })
    const actor = createActor(gameMachine, { snapshot }).start()
    actor.send({ type: 'PLAY_AGAIN' })
    expect(actor.getSnapshot().context.battleResult).toBeNull()
    expect(actor.getSnapshot().context.outcome).toBeNull()
    actor.stop()
  })

  it('aborts battle to regions without recording an outcome and clears encounter/tower runtime', () => {
    const cards = PLAYER_CARDS.slice(0, 3)
    const snapshot = gameMachine.resolveState({
      value: 'battle',
      context: {
        ...INITIAL_GAME_CONTEXT,
        regionId: 'verdant-forest',
        foeTeam: cards,
        playerTeam: cards,
        outcome: null,
        battleResult: null,
        captured: true,
        tower: { ascension: 1, floor: 2, seed: 'tower', teamCards: cards },
      },
    })
    const actor = createActor(gameMachine, { snapshot }).start()
    actor.send({ type: 'ABORT_BATTLE' })

    expect(actor.getSnapshot().value).toBe('regionSelect')
    expect(actor.getSnapshot().context).toMatchObject({
      foeTeam: [], playerTeam: [], outcome: null, battleResult: null, captured: false, tower: null,
    })
    actor.stop()
  })

  it('rejects malformed route events instead of bypassing the handoff contract', () => {
    const regionActor = createActor(gameMachine, {
      snapshot: gameMachine.resolveState({ value: 'regionSelect', context: INITIAL_GAME_CONTEXT }),
    }).start()
    regionActor.send({ type: 'SELECT_REGION', regionId: 'not-a-region' })
    expect(regionActor.getSnapshot().value).toBe('regionSelect')
    expect(regionActor.getSnapshot().context).toEqual(INITIAL_GAME_CONTEXT)
    regionActor.stop()

    const encounterActor = createActor(gameMachine, {
      snapshot: gameMachine.resolveState({
        value: 'encounter',
        context: { ...INITIAL_GAME_CONTEXT, regionId: 'practice', foeTeam: [] },
      }),
    }).start()
    encounterActor.send({ type: 'ENGAGE' })
    expect(encounterActor.getSnapshot().value).toBe('encounter')
    encounterActor.stop()

    const retryActor = createActor(gameMachine, {
      snapshot: gameMachine.resolveState({
        value: 'encounter',
        context: { ...INITIAL_GAME_CONTEXT, regionId: 'practice', foeTeam: PLAYER_CARDS.slice(0, 3) },
      }),
    }).start()
    retryActor.send({ type: 'RETRY_ENCOUNTER' })
    expect(retryActor.getSnapshot().value).toBe('encounter')
    expect(retryActor.getSnapshot().context.foeTeam).toHaveLength(3)
    retryActor.stop()

    const cardActor = createActor(gameMachine, {
      snapshot: gameMachine.resolveState({
        value: 'cardSelect',
        context: { ...INITIAL_GAME_CONTEXT, regionId: 'practice', foeTeam: PLAYER_CARDS.slice(0, 3) },
      }),
    }).start()
    cardActor.send({ type: 'SELECT_TEAM', cards: PLAYER_CARDS.slice(0, 2) })
    expect(cardActor.getSnapshot().value).toBe('cardSelect')
    cardActor.stop()
  })

  it('does not allow a losing Tower Result to continue, while malformed Tower can still quit', () => {
    const cards = PLAYER_CARDS.slice(0, 3)
    const loseActor = createActor(gameMachine, {
      snapshot: gameMachine.resolveState({
        value: 'result',
        context: {
          ...INITIAL_GAME_CONTEXT,
          regionId: 'practice',
          foeTeam: cards,
          playerTeam: cards,
          outcome: 'lose',
          battleResult: { resultId: 'tower-lose', resultFingerprint: 'tower-lose-fp', outcome: 'lose' },
          tower: { ascension: 0, floor: 2, seed: 'tower', teamCards: cards },
        },
      }),
    }).start()
    loseActor.send({ type: 'TOWER_CONTINUE' })
    expect(loseActor.getSnapshot().value).toBe('result')
    expect(loseActor.getSnapshot().context.tower?.floor).toBe(2)
    loseActor.stop()

    const malformedActor = createActor(gameMachine, {
      snapshot: gameMachine.resolveState({
        value: 'result',
        context: {
          ...INITIAL_GAME_CONTEXT,
          outcome: 'win',
          tower: { ascension: 0, floor: 0, seed: 'bad', teamCards: cards } as never,
        },
      }),
    }).start()
    malformedActor.send({ type: 'TOWER_QUIT' })
    expect(malformedActor.getSnapshot().value).toBe('regionSelect')
    expect(malformedActor.getSnapshot().context.tower).toBeNull()
    malformedActor.stop()
  })
})
