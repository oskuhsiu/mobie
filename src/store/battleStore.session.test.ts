import { mon } from '@/game/battle/testFixtures'
import type { BattleEvent } from '@/game/battle/reducer'
import { useBattleStore } from './battleStore'

const identityA = { battleSessionId: 'same-id', resultFingerprint: 'fingerprint-a' }
const identityB = { battleSessionId: 'same-id', resultFingerprint: 'fingerprint-b' }
const damageEvent: BattleEvent = {
  type: 'damageApplied', attackerSide: 'player', attackerIndex: 0,
  targetSide: 'foe', targetIndex: 0, amount: 1, missed: false,
  crit: false, effectiveness: 1, effectivenessText: null,
  hpBefore: 100, hpAfter: 99, maxHp: 100,
}

function init(
  logicalBattleKey: object,
  identity = identityA,
) {
  return useBattleStore.getState().ensureBattleSession({
    logicalBattleKey,
    playerMembers: [mon()],
    foeMembers: [mon()],
    battleSeed: 'seed',
    regionId: 'practice',
    mode: 'arena',
    recordReplay: true,
    snapshot: [],
    createdAt: 1,
    identityFactory: () => identity,
  })
}

describe('battleStore runtime session', () => {
  it('reuses identity/RNG/recorder for one logical key and keeps presentation ids monotonic', () => {
    const key = {}
    const first = init(key)
    const runtime = useBattleStore.getState().session
    const token1 = useBattleStore.getState().acquireTurnPresentationToken()
    const second = init(key, identityB)
    const token2 = useBattleStore.getState().acquireTurnPresentationToken()

    expect(first).toMatchObject({ created: true, token: identityA })
    expect(second).toMatchObject({ created: false, token: identityA })
    expect(useBattleStore.getState().session).toMatchObject({
      token: identityA,
      nextPresentationId: 3,
    })
    expect(useBattleStore.getState().session?.recorder).toBe(runtime?.recorder)
    expect(useBattleStore.getState().session?.rngCursor).toBe(0)
    expect([token1?.presentationId, token2?.presentationId]).toEqual([1, 2])
  })

  it('creates a new pair for a new key or explicit forceNew and fences same-id collisions', () => {
    const key = {}
    init(key, identityA)
    const oldToken = useBattleStore.getState().acquireTurnPresentationToken()!
    init({}, identityB)
    const collisionToken = useBattleStore.getState().acquireTurnPresentationToken()!

    expect(useBattleStore.getState().isSessionCurrent(oldToken)).toBe(false)
    expect(useBattleStore.getState().isSessionCurrent(collisionToken)).toBe(true)

    const forced = useBattleStore.getState().ensureBattleSession({
      logicalBattleKey: key,
      playerMembers: [mon()],
      foeMembers: [mon()],
      battleSeed: 'retry-seed',
      regionId: 'practice',
      mode: 'arena',
      recordReplay: false,
      snapshot: [],
      createdAt: 2,
      forceNew: true,
      identityFactory: () => ({ battleSessionId: 'retry', resultFingerprint: 'retry-fp' }),
    })
    expect(forced).toMatchObject({ created: true, token: { battleSessionId: 'retry' } })
  })

  it('keeps star energy canonical until commit and restores it on cancellation', () => {
    init({}, identityA)
    useBattleStore.setState({ energy: 100, chain: 4 })
    const before = useBattleStore.getState().battle!
    const token = useBattleStore.getState().acquireTurnPresentationToken()!
    useBattleStore.getState().beginPresentation(token, before, { type: 'ATTACK', starStrike: true })

    expect(useBattleStore.getState().presentation).toMatchObject({ energy: 0, chain: 0 })
    expect(useBattleStore.getState()).toMatchObject({ energy: 100, chain: 4 })
    useBattleStore.getState().cancelPresentation(token)
    expect(useBattleStore.getState()).toMatchObject({ energy: 100, chain: 4, phase: 'playerChoice' })
  })

  it('records each token once and emits one token-fenced warning after recorder failure', () => {
    init({}, identityA)
    const before = useBattleStore.getState().battle!
    const token = useBattleStore.getState().acquireTurnPresentationToken()!
    useBattleStore.getState().beginPresentation(token, before, { type: 'ATTACK' })
    const failure = new Error('copy failed')
    const brokenEvents = new Proxy([] as BattleEvent[], {
      get(target, property, receiver) {
        if (property === Symbol.iterator) throw failure
        return Reflect.get(target, property, receiver)
      },
    })

    expect(useBattleStore.getState().tryRecordTurnOnce(token, { type: 'ATTACK' }, brokenEvents)).toBe('failed')
    expect(useBattleStore.getState().tryRecordTurnOnce(token, { type: 'ATTACK' }, [])).toBe('already-recorded')
    expect(useBattleStore.getState().presentation?.log.filter((line) => line.includes('回放錄製已停用'))).toHaveLength(1)
  })

  it('finishes replay and marks END_BATTLE once per session', () => {
    init({}, identityA)
    const token = useBattleStore.getState().acquireTurnPresentationToken()!
    expect(useBattleStore.getState().finishReplayOnce(token, 'win')).toBe(true)
    expect(useBattleStore.getState().finishReplayOnce(token, 'win')).toBe(false)
    expect(useBattleStore.getState().markEndSentOnce(token)).toBe(true)
    expect(useBattleStore.getState().markEndSentOnce(token)).toBe(false)
  })

  it('rolls back staged replay/RNG ownership on cancel and publishes both only on commit', () => {
    const logicalKey = {}
    init(logicalKey, identityA)
    const before = useBattleStore.getState().battle!
    const cancelled = useBattleStore.getState().acquireTurnPresentationToken()!
    useBattleStore.getState().beginPresentation(cancelled, before, { type: 'ATTACK' })
    expect(useBattleStore.getState().tryRecordTurnOnce(cancelled, { type: 'ATTACK' }, [damageEvent])).toBe('recorded')
    expect(useBattleStore.getState().session?.recorder.build('win')).toBeNull()
    useBattleStore.getState().cancelPresentation(cancelled)
    expect(init(logicalKey, identityB)).toMatchObject({ created: false, token: identityA })
    expect(useBattleStore.getState().session).toMatchObject({ rngCursor: 0, pendingReplay: null })
    expect(useBattleStore.getState().session?.recorder.build('win')).toBeNull()

    const committed = useBattleStore.getState().acquireTurnPresentationToken()!
    useBattleStore.getState().beginPresentation(committed, before, { type: 'ATTACK' })
    expect(useBattleStore.getState().tryRecordTurnOnce(committed, { type: 'ATTACK' }, [damageEvent])).toBe('recorded')
    const result = useBattleStore.getState().commitTurn(committed, {
      before,
      input: { type: 'ATTACK' },
      events: [damageEvent],
      nextState: { ...before, turn: before.turn + 1 },
      battleSeed: 'seed',
      turn: before.turn,
      rngCalls: 2,
      commitMeta: {
        energy: { kind: 'unchanged' }, lockedIndex: 'unchanged', combo: 'unchanged', outcome: null,
      },
    })
    expect(result).toMatchObject({ committed: true })
    expect(useBattleStore.getState().session?.rngCursor).toBe(2)
    expect(useBattleStore.getState().session?.recorder.build('win')?.turns).toHaveLength(1)
  })
})
