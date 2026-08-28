import { createBattleState } from '@/game/battle/reducer'
import { mon } from '@/game/battle/testFixtures'
import { useBattleStore } from './battleStore'

const token = { battleSessionId: 'battle-a', presentationId: 1 }
const stale = { battleSessionId: 'battle-a', presentationId: 0 }

function reset() {
  useBattleStore.getState().init([mon()], [mon()])
  useBattleStore.getState().setPhase('playerChoice')
}

describe('battleStore presentation shadow', () => {
  beforeEach(reset)

  it('projects HP/log/hit changes without mutating canonical battle', () => {
    const store = useBattleStore.getState()
    const canonical = store.battle!
    store.beginPresentation(token, canonical)
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
    useBattleStore.getState().beginPresentation(token, canonical)
    const projection = useBattleStore.getState().presentation
    useBattleStore.getState().presentationSetMemberHp(stale, 'foe', 0, 1)
    useBattleStore.getState().presentationSetBanner(stale, 'stale')
    useBattleStore.getState().commitPresentation(stale, { ...canonical, turn: 99 })
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
    useBattleStore.getState().beginPresentation(token, canonical)
    useBattleStore.getState().beginPresentation(
      { battleSessionId: 'battle-b', presentationId: 1 },
      { ...canonical, turn: 99 },
    )

    expect(useBattleStore.getState().presentation).toMatchObject({ token, battle: { turn: canonical.turn } })
  })

  it('commits canonical state and projected durable UI once, then clears transients', () => {
    const canonical = useBattleStore.getState().battle!
    const next = { ...createBattleState([mon()], [mon()]), turn: 2 }
    useBattleStore.getState().beginPresentation(token, canonical)
    useBattleStore.getState().presentationPushLog(token, '結果')
    useBattleStore.getState().presentationSetBanner(token, '暫態')
    useBattleStore.getState().presentationShowHit(token, {
      target: 'foe', amount: 1, crit: false, effText: null, missed: false,
    })
    useBattleStore.getState().commitPresentation(token, next)

    const committed = useBattleStore.getState()
    expect(committed.battle).toBe(next)
    expect(committed.log).toContain('結果')
    expect(committed.fxCounter).toBe(1)
    expect(committed.presentation).toBeNull()
    expect({ banner: committed.banner, hitFx: committed.hitFx }).toEqual({ banner: null, hitFx: null })

    useBattleStore.getState().commitPresentation(token, { ...next, turn: 99 })
    expect(useBattleStore.getState().battle!.turn).toBe(2)
  })

  it('cancels only the matching token and restores the supplied phase', () => {
    const canonical = useBattleStore.getState().battle!
    useBattleStore.getState().setBanner('舊暫態')
    useBattleStore.getState().beginPresentation(token, canonical)
    useBattleStore.getState().cancelPresentation(token, 'intro')
    expect(useBattleStore.getState()).toMatchObject({
      presentation: null, phase: 'intro', battle: canonical,
      banner: null, hitFx: null, support: null, combo: null,
    })
  })

  it('init and legacy setBattle clear an active projection', () => {
    const canonical = useBattleStore.getState().battle!
    useBattleStore.getState().beginPresentation(token, canonical)
    useBattleStore.getState().setBattle({ ...canonical, turn: 3 })
    expect(useBattleStore.getState().presentation).toBeNull()

    useBattleStore.getState().beginPresentation(token, useBattleStore.getState().battle!)
    useBattleStore.getState().init([mon()], [mon()])
    expect(useBattleStore.getState().presentation).toBeNull()
  })
})
