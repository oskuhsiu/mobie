import { describe, it, expect } from 'vitest'
import { rollEncounterProfile, applyProfileToMon, ENCOUNTER_TAG_META } from './encounterProfile'
import { mon } from '@/game/battle/testFixtures'

describe('rollEncounterProfile（決定論、0–2 標籤）', () => {
  it('同 speciesId 永遠相同；標籤數 0–2、互異、皆合法', () => {
    for (let id = 1; id <= 60; id++) {
      const a = rollEncounterProfile(id)
      const b = rollEncounterProfile(id)
      expect(a).toEqual(b)
      expect(a.tags.length).toBeLessThanOrEqual(2)
      expect(new Set(a.tags).size).toBe(a.tags.length) // 互異
      for (const t of a.tags) expect(ENCOUNTER_TAG_META[t]).toBeTruthy()
    }
  })
})

describe('applyProfileToMon（反射被動微調）', () => {
  it('aggressive 提升 atk、sustain 增厚 HP、disruptor 提速；無標籤不變', () => {
    const base = mon({ atk: 100, spe: 100, maxHp: 100 })
    const agg = applyProfileToMon(base, { tags: ['aggressive'] })
    expect(agg.atk).toBeGreaterThan(base.atk)
    expect(agg.encounterTags).toEqual(['aggressive'])

    const sus = applyProfileToMon(base, { tags: ['sustain'] })
    expect(sus.maxHp).toBeGreaterThan(base.maxHp)
    expect(sus.currentHp).toBe(sus.maxHp)

    const dis = applyProfileToMon(base, { tags: ['disruptor'] })
    expect(dis.spe).toBeGreaterThan(base.spe)

    const none = applyProfileToMon(base, { tags: [] })
    expect(none.atk).toBe(base.atk)
    expect(none.spe).toBe(base.spe)
    expect(none.maxHp).toBe(base.maxHp)
  })

  it('terrain/combo_seed 為純宣告（不調能力值）', () => {
    const base = mon({ atk: 100, spe: 100, maxHp: 100 })
    const t = applyProfileToMon(base, { tags: ['terrain', 'combo_seed'] })
    expect(t.atk).toBe(base.atk)
    expect(t.spe).toBe(base.spe)
    expect(t.maxHp).toBe(base.maxHp)
    expect(t.encounterTags).toEqual(['terrain', 'combo_seed'])
  })
})
