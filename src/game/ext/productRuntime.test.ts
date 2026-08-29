import { describe, expect, it } from 'vitest'
import { mon } from '@/game/battle/testFixtures'
import { createOwnedUnit } from '@/game/growth'
import { PRODUCT_RUNTIME } from './productRuntime'

describe('fixed battle product runtime', () => {
  it('composes every fixed seam through one production interface', () => {
    const player = [
      mon({ speciesId: 4, types: ['fire'], heldItemId: 'headband', atk: 100 }),
      mon({ speciesId: 7, types: ['water'] }),
      mon({ speciesId: 1, types: ['grass'] }),
    ]
    const foe = [mon({ speciesId: 143, types: ['normal'] })]

    const prepared = PRODUCT_RUNTIME.prepareBattleTeams(player, foe)

    expect(prepared.playerModifiers.length).toBeGreaterThan(0)
    expect(prepared.playerTeam[0].atk).toBeGreaterThan(100)
    expect(prepared.playerTeam.every((unit) => Boolean(unit.abilityId))).toBe(true)
    expect(prepared.foeTeam.every((unit) => Boolean(unit.abilityId))).toBe(true)
    expect(PRODUCT_RUNTIME.previewPlayerSynergy(player)).toEqual(prepared.playerModifiers)
    expect(PRODUCT_RUNTIME.turnExtensions.damageHooks.length).toBeGreaterThan(0)
    expect(PRODUCT_RUNTIME.turnExtensions.turnEndTriggers.length).toBeGreaterThan(0)
    expect(PRODUCT_RUNTIME.turnExtensions.chain.maxHits).toBeGreaterThan(0)
    expect(PRODUCT_RUNTIME.turnExtensions.combo.match(prepared.playerTeam.slice(0, 2), [])).not.toBeNull()

    const evolved = PRODUCT_RUNTIME.applyPostGrowth(createOwnedUnit('fixed-evolution', 1, 16))
    expect(evolved.speciesId).toBe(2)
  })
})
