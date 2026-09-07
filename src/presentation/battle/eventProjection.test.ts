import { createBattleState, type BattleEvent } from '@/game/battle/reducer'
import { mon } from '@/game/battle/testFixtures'
import { getMove } from '@/game/data/moves'
import { useBattleStore } from '@/store/battleStore'
import { projectEventField } from './eventProjection'

const buff: Extract<BattleEvent, { type: 'statusApplied' }> = {
  type: 'statusApplied', side: 'foe', index: 0, moveId: 2000,
  effectKind: 'buff', label: '攻擊大幅提升', remaining: 2,
}
const terrain: Extract<BattleEvent, { type: 'wildAccident' }> = {
  type: 'wildAccident', kind: 'terrainShift', terrainId: 'steam',
}

describe('event field projection', () => {
  it('uses equipped move values and reducer duration refresh without mutating canonical field', () => {
    const equipped = { ...getMove(2000), effect: { ...getMove(2000).effect!, mult: 1.8 } }
    const battle = createBattleState([mon()], [mon({ moves: [equipped] })])
    battle.field.enemyStatuses = [{ stat: 'atk', mult: 2, remaining: 5, source: 91, label: 'existing' }]
    const original = structuredClone(battle)
    const field = projectEventField(battle, buff)
    expect(field.enemyStatuses).toEqual([{ stat: 'atk', mult: 2, remaining: 2, source: 91, label: 'existing' }])
    expect(field.teamStatuses).toEqual([])
    expect(projectEventField({ ...battle, field }, buff)).toEqual(field)
    expect(battle).toEqual(original)
  })

  it('resolves catalog moves and applies field events in cue order without changing HP or active member', () => {
    const battle = createBattleState([mon()], [mon()])
    const field = projectEventField(battle, buff)
    expect(field.enemyStatuses[0]).toMatchObject({ stat: 'atk', mult: 1.5, remaining: 2, source: 2000 })
    expect(field.terrainEffects).toEqual(battle.field.terrainEffects)
    const afterTerrain = projectEventField({ ...battle, field }, terrain)
    expect(afterTerrain.terrainEffects.current).toEqual(['steam'])
    expect(afterTerrain.terrainEffects.initial).toBe(field.terrainEffects.initial)
    expect(projectEventField({ ...battle, field }, { ...buff, effectKind: 'heal', hpAfter: 80 })).toBe(field)
    expect(battle.foe.members[0].currentHp).toBe(100)
    expect(battle.foe.activeIndex).toBe(0)
  })

  it('merges combo status once per stat and de-duplicates marks by key', () => {
    const battle = createBattleState([mon()], [mon()])
    const event: BattleEvent = {
      type: 'comboCast', key: 'frost-veil', name: '霜霰護幕', icon: '❄️',
      castKind: 'teamBuff', label: '霜霰護幕', remaining: 3,
    }
    const field = projectEventField(battle, event)
    expect(field.teamStatuses).toEqual([{ stat: 'def', mult: 1.4, remaining: 3, source: -1, label: event.name }])
    expect(projectEventField({ ...battle, field }, event)).toEqual(field)
    expect(field.comboCastEffects).toHaveLength(1)
    expect(battle.field.teamStatuses).toEqual([])
  })

  it('fences shadow writes by presentation token and discards them on cancellation', () => {
    const identity = { battleSessionId: 'field-session', resultFingerprint: 'field-result' }
    const token = { ...identity, presentationId: 1, purpose: 'turn' as const }
    const store = useBattleStore.getState()
    store.ensureBattleSession({
      logicalBattleKey: {}, playerMembers: [mon()], foeMembers: [mon()], battleSeed: 'field',
      regionId: 'practice', mode: 'arena', recordReplay: false, snapshot: [], createdAt: 1,
      identityFactory: () => identity,
    })
    const canonical = useBattleStore.getState().battle!
    store.beginPresentation(token, canonical, { type: 'ATTACK' })
    const initial = useBattleStore.getState().presentation
    store.presentationApplyEvent({ ...token, presentationId: 0 }, terrain)
    expect(useBattleStore.getState().presentation).toBe(initial)
    store.presentationApplyEvent(token, terrain)
    expect(useBattleStore.getState().presentation!.battle.field.terrainEffects.current).toEqual(['steam'])
    expect(useBattleStore.getState().battle).toBe(canonical)
    expect(canonical.field.terrainEffects.current).toEqual([])
    store.cancelPresentation(token)
    store.presentationApplyEvent(token, buff)
    expect(useBattleStore.getState().presentation).toBeNull()
    expect(useBattleStore.getState().battle).toBe(canonical)
  })
})
