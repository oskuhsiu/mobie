import { createBattleState } from '@/game/battle/reducer'
import { mon } from '@/game/battle/testFixtures'
import type { TurnResolution } from '@/presentation/battle/contracts'
import { useBattleStore } from './battleStore'

const sessionToken = { battleSessionId: 'battle-a', resultFingerprint: 'fingerprint-a' }
const token = { ...sessionToken, presentationId: 1 }
const stale = { ...sessionToken, presentationId: 0 }

function turnResolution(before: ReturnType<typeof createBattleState>, nextState = { ...before, turn: before.turn + 1 }): TurnResolution {
  return {
    before,
    input: { type: 'ATTACK' },
    events: [],
    nextState,
    battleSeed: 'seed',
    turn: before.turn,
    rngCalls: 0,
    commitMeta: {
      energy: { kind: 'gain', delta: 10, dealtDamage: true },
      lockedIndex: null,
      combo: 'unchanged',
      outcome: null,
    },
  }
}

function reset() {
  useBattleStore.getState().ensureBattleSession({
    logicalBattleKey: {},
    playerMembers: [mon()],
    foeMembers: [mon()],
    battleSeed: 'seed',
    regionId: 'practice',
    mode: 'arena',
    recordReplay: false,
    snapshot: [],
    createdAt: 1,
    identityFactory: () => sessionToken,
  })
  useBattleStore.getState().setPhase('playerChoice')
}

describe('battleStore presentation shadow', () => {
  beforeEach(reset)

  it('projects HP/log/hit changes without mutating canonical battle', () => {
    const store = useBattleStore.getState()
    const canonical = store.battle!
    store.beginPresentation(token, canonical, { type: 'ATTACK' })
    store.presentationSetMemberHp(token, 'foe', 0, 42)
    store.presentationPushLog(token, '造成傷害')
    store.presentationShowHit(token, {
      target: 'foe', amount: 58, crit: false, effText: null, missed: false,
    })

    const state = useBattleStore.getState()
    expect(state.battle).toBe(canonical)
    expect(state.battle!.foe.members[0].currentHp).toBe(100)
    expect(state.presentation!.battle).not.toBe(canonical)
    expect(state.presentation!.battle.foe.members[0].currentHp).toBe(42)
    expect(state.presentation!.log).toContain('造成傷害')
    expect(state.presentation!.hitFx).toMatchObject({ id: 1, amount: 58 })
  })

  it('makes all stale projection writes, commit, and cancel no-ops', () => {
    const canonical = useBattleStore.getState().battle!
    useBattleStore.getState().beginPresentation(token, canonical, { type: 'ATTACK' })
    const projection = useBattleStore.getState().presentation
    useBattleStore.getState().presentationSetMemberHp(stale, 'foe', 0, 1)
    useBattleStore.getState().presentationSetBanner(stale, 'stale')
    expect(useBattleStore.getState().commitTurn(stale, turnResolution(canonical))).toEqual({ committed: false })
    useBattleStore.getState().cancelPresentation(stale, 'intro')

    const state = useBattleStore.getState()
    expect(state.presentation).toBe(projection)
    expect(state.battle).toBe(canonical)
    expect(state.phase).toBe('busy')
    expect(state.isPresentationCurrent(token)).toBe(true)
    expect(state.isPresentationCurrent(stale)).toBe(false)
  })

  it('does not let a second token replace an active projection', () => {
    const canonical = useBattleStore.getState().battle!
    useBattleStore.getState().beginPresentation(token, canonical, { type: 'ATTACK' })
    useBattleStore.getState().beginPresentation(
      { battleSessionId: 'battle-a', resultFingerprint: 'fingerprint-b', presentationId: 1 },
      { ...canonical, turn: 99 },
      { type: 'ATTACK' },
    )

    expect(useBattleStore.getState().presentation).toMatchObject({ token, battle: { turn: canonical.turn } })
  })

  it('commits canonical state and projected durable UI once, then clears transients', () => {
    const canonical = useBattleStore.getState().battle!
    const next = { ...createBattleState([mon()], [mon()]), turn: 2 }
    useBattleStore.getState().beginPresentation(token, canonical, { type: 'ATTACK' })
    useBattleStore.getState().presentationPushLog(token, '結果')
    useBattleStore.getState().presentationSetBanner(token, '暫態')
    useBattleStore.getState().presentationShowHit(token, {
      target: 'foe', amount: 1, crit: false, effText: null, missed: false,
    })
    expect(useBattleStore.getState().commitTurn(token, turnResolution(canonical, next))).toMatchObject({ committed: true })

    const committed = useBattleStore.getState()
    expect(committed.battle).toBe(next)
    expect(committed.log).toContain('結果')
    expect(committed.fxCounter).toBe(1)
    expect({ energy: committed.energy, chain: committed.chain, lockedIndex: committed.lockedIndex })
      .toEqual({ energy: 14, chain: 1, lockedIndex: null })
    expect(committed.presentation).toBeNull()
    expect({ banner: committed.banner, hitFx: committed.hitFx }).toEqual({ banner: null, hitFx: null })

    expect(useBattleStore.getState().commitTurn(token, turnResolution(next, { ...next, turn: 99 }))).toEqual({ committed: false })
    expect(useBattleStore.getState().battle!.turn).toBe(2)
  })

  it('applies star reset and outcome phase atomically with the canonical state', () => {
    const canonical = useBattleStore.getState().battle!
    useBattleStore.setState({ energy: 100, chain: 4, lockedIndex: 2, combo: 3 })
    useBattleStore.getState().beginPresentation(token, canonical, { type: 'ATTACK', starStrike: true })
    const next = { ...canonical, turn: canonical.turn + 1, winner: 'player' as const }
    const resolution: TurnResolution = {
      before: canonical,
      input: { type: 'ATTACK', starStrike: true },
      events: [{ type: 'battleEnded', winner: 'player' }],
      nextState: next,
      battleSeed: 'seed',
      turn: canonical.turn,
      rngCalls: 0,
      commitMeta: {
        energy: { kind: 'reset' },
        lockedIndex: 'unchanged',
        combo: 'unchanged',
        outcome: { winner: 'player', outcome: 'win' },
      },
    }

    expect(useBattleStore.getState().commitTurn(token, resolution)).toEqual({
      committed: true,
      outcome: { winner: 'player', outcome: 'win' },
    })
    expect(useBattleStore.getState()).toMatchObject({
      battle: next,
      phase: 'won',
      energy: 0,
      chain: 0,
      lockedIndex: 2,
      combo: 3,
      presentation: null,
    })
  })

  it('cancels only the matching token and restores the supplied phase', () => {
    const canonical = useBattleStore.getState().battle!
    useBattleStore.getState().setBanner('舊暫態')
    useBattleStore.getState().beginPresentation(token, canonical, { type: 'ATTACK' })
    useBattleStore.getState().cancelPresentation(token, 'intro')
    expect(useBattleStore.getState()).toMatchObject({
      presentation: null, phase: 'intro', battle: canonical,
      banner: null, hitFx: null, support: null, combo: null,
    })
  })

  it('a fresh legacy init clears an active projection and runtime session', () => {
    const canonical = useBattleStore.getState().battle!
    useBattleStore.getState().beginPresentation(token, canonical, { type: 'ATTACK' })
    useBattleStore.getState().init([mon()], [mon()])
    expect(useBattleStore.getState()).toMatchObject({ presentation: null, session: null })
  })
})
