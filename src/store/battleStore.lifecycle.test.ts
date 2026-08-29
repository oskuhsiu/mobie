import { createBattleState, type BattleEvent } from '@/game/battle/reducer'
import { mon } from '@/game/battle/testFixtures'
import type { TurnResolution } from '@/presentation/battle/contracts'
import { useBattleStore } from './battleStore'

const identityA = { battleSessionId: 'session-a', resultFingerprint: 'fingerprint-a' }
const identityB = { battleSessionId: 'session-b', resultFingerprint: 'fingerprint-b' }

function init(logicalBattleKey: object, identity = identityA) {
  return useBattleStore.getState().ensureBattleSession({
    logicalBattleKey,
    playerMembers: [mon()],
    foeMembers: [mon()],
    battleSeed: identity.battleSessionId,
    regionId: 'practice',
    mode: 'arena',
    recordReplay: true,
    snapshot: [],
    createdAt: 1,
    identityFactory: () => identity,
  })
}

function resolution(before: ReturnType<typeof createBattleState>): TurnResolution {
  return {
    before,
    input: { type: 'ATTACK' },
    events: [],
    nextState: { ...before, turn: before.turn + 1 },
    battleSeed: 'a',
    turn: before.turn,
    rngCalls: 2,
    commitMeta: {
      energy: { kind: 'gain', delta: 10, dealtDamage: true },
      lockedIndex: 'unchanged',
      combo: 'unchanged',
      outcome: null,
    },
  }
}

describe('battleStore session lifecycle', () => {
  it('creates a fresh retry identity before preparation and starts that recorder once on completion', () => {
    const logicalKey = {}
    init(logicalKey, identityA)
    useBattleStore.getState().fenceSession(identityA)
    const attempt = useBattleStore.getState().beginSessionAttempt({
      logicalBattleKey: logicalKey,
      battleSeed: 'retry-seed',
      identityFactory: () => identityB,
    })
    const recorder = useBattleStore.getState().session!.recorder
    expect(attempt).toEqual(identityB)
    expect(recorder.active).toBe(false)

    const completed = useBattleStore.getState().ensureBattleSession({
      logicalBattleKey: logicalKey,
      playerMembers: [mon()],
      foeMembers: [mon()],
      battleSeed: 'retry-seed',
      regionId: 'practice',
      mode: 'arena',
      recordReplay: true,
      snapshot: [],
      createdAt: 2,
      forceNew: true,
      attemptToken: attempt,
      identityFactory: () => ({ battleSessionId: 'wrong', resultFingerprint: 'wrong' }),
    })

    expect(completed.token).toEqual(identityB)
    expect(useBattleStore.getState().session?.recorder).toBe(recorder)
    expect(recorder.active).toBe(true)
  })

  it('converges a current resolver failure to one recoverable error without canonical progress', () => {
    init({})
    useBattleStore.setState({ energy: 23 })
    const before = useBattleStore.getState().battle!
    const token = useBattleStore.getState().acquireTurnPresentationToken()!
    useBattleStore.getState().beginPresentation(token, before, { type: 'ATTACK' })

    expect(useBattleStore.getState().failTurnOnce(token, new Error('resolver boom'))).toBe(true)
    expect(useBattleStore.getState().failTurnOnce(token, new Error('late duplicate'))).toBe(false)
    expect(useBattleStore.getState()).toMatchObject({
      battle: before,
      phase: 'error',
      energy: 23,
      presentation: null,
      battleError: { kind: 'resolve', detail: 'resolver boom', requestId: 1 },
      session: { rngCursor: 0, pendingReplay: null, endSent: false },
    })
  })

  it('keeps B exact when retired A performs every late store write', () => {
    init({}, identityA)
    const beforeA = useBattleStore.getState().battle!
    const recorderA = useBattleStore.getState().session!.recorder
    const tokenA = useBattleStore.getState().acquireTurnPresentationToken()!
    useBattleStore.getState().beginPresentation(tokenA, beforeA, { type: 'ATTACK' })
    expect(useBattleStore.getState().fenceSession(identityA)).toBe(true)
    expect(recorderA.active).toBe(false)

    init({}, identityB)
    const beforeB = useBattleStore.getState()
    const recorderB = beforeB.session?.recorder
    useBattleStore.getState().presentationSetBanner(tokenA, 'late A')
    useBattleStore.getState().cancelPresentation(tokenA)
    expect(useBattleStore.getState().recordFailedOnce(tokenA, new Error('late recorder'))).toBe(false)
    expect(useBattleStore.getState().failTurnOnce(tokenA, new Error('late resolver'))).toBe(false)
    expect(useBattleStore.getState().commitTurn(tokenA, resolution(beforeA))).toEqual({ committed: false })
    expect(useBattleStore.getState().finishReplayOnce(tokenA, 'win')).toBe(false)
    expect(useBattleStore.getState().markEndSentOnce(tokenA)).toBe(false)

    const afterB = useBattleStore.getState()
    expect(afterB).toMatchObject({
      battle: beforeB.battle,
      phase: beforeB.phase,
      energy: beforeB.energy,
      log: beforeB.log,
      battleError: null,
      session: { token: identityB, rngCursor: 0, endSent: false, retired: false },
    })
    expect(afterB.session?.recorder).toBe(recorderB)
  })

  it('does not republish A when recorder iteration re-enters and initializes B', () => {
    init({}, identityA)
    const beforeA = useBattleStore.getState().battle!
    const tokenA = useBattleStore.getState().acquireTurnPresentationToken()!
    useBattleStore.getState().beginPresentation(tokenA, beforeA, { type: 'ATTACK' })
    const events = new Proxy([] as BattleEvent[], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) init({}, identityB)
        return Reflect.get(target, property, receiver)
      },
    })

    expect(useBattleStore.getState().tryRecordTurnOnce(tokenA, { type: 'ATTACK' }, events)).toBe('failed')
    expect(useBattleStore.getState().session).toMatchObject({ token: identityB, rngCursor: 0, retired: false })
    expect(useBattleStore.getState().session?.pendingReplay).toBeNull()
  })
})
