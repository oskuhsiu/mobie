import { describe, expect, it } from 'vitest'
import { abilityForType } from '@/game/ext/abilities'
import { createOwnedUnit } from '@/game/growth'
import { buildOwnedMobieForDisplay } from '@/game/ownedMobie'

describe('buildOwnedMobieForDisplay', () => {
  it('集中建立 owner 資訊卡所需的 canonical 數值與展示特性', () => {
    const owned = createOwnedUnit('owned-display', 1, 16)
    const displayed = buildOwnedMobieForDisplay(owned)

    expect(displayed).toMatchObject({
      speciesId: owned.speciesId,
      level: owned.level,
      ivs: owned.ivs,
      nature: owned.nature,
      shiny: owned.shiny,
      abilityId: abilityForType(displayed.types[0]),
    })
  })
})
