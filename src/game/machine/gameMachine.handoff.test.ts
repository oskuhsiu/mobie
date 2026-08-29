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
})
