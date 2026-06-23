// M7 — 隊伍羈絆（S2）純函數測試。設計真相：plan/09 §2。
import { describe, it, expect } from 'vitest'
import { mon } from '@/game/battle/testFixtures'
import { computeSynergy, SYNERGY_RULES, SYNERGY_MODULE } from '@/game/ext/synergy'
import { assembleBattlePrep, applyBattlePrep } from '@/store/ext'
import { defaultSettings, setModuleEnabledIn } from '@/game/settings'

const ids = (mods: ReturnType<typeof computeSynergy>) => mods.map((m) => m.source + ':' + m.label)
const has = (mods: ReturnType<typeof computeSynergy>, frag: string) => ids(mods).some((s) => s.includes(frag))

describe('M7 隊伍羈絆 computeSynergy', () => {
  it('每條規則的 modifier 都帶 label/source/icon（禁隱形加成）', () => {
    for (const r of SYNERGY_RULES) {
      expect(r.modifier.label).toBeTruthy()
      expect(r.modifier.source).toBeTruthy()
      expect(r.modifier.icon).toBeTruthy()
      expect(typeof r.modifier.apply).toBe('function')
    }
  })

  it('多樣陣容：涵蓋 ≥3 屬性 → 速度 +10%；<3 不觸發', () => {
    const diverse = [mon({ types: ['fire'] }), mon({ types: ['water'] }), mon({ types: ['grass'] })]
    const mods = computeSynergy(diverse)
    expect(has(mods, '多樣陣容')).toBe(true)
    const boosted = mods.find((m) => m.label.includes('多樣'))!.apply!(mon({ spe: 100 }))
    expect(boosted.spe).toBe(110)

    const narrow = [mon({ types: ['fire'] }), mon({ types: ['fire'] })]
    expect(has(computeSynergy(narrow), '多樣陣容')).toBe(false)
  })

  it('同屬共鳴：≥2 隻共享屬性 → 攻擊/特攻 +10%', () => {
    const team = [mon({ types: ['fire'] }), mon({ types: ['fire', 'flying'] }), mon({ types: ['water'] })]
    const mods = computeSynergy(team)
    expect(has(mods, '同屬共鳴')).toBe(true)
    const out = mods.find((m) => m.label.includes('同屬'))!.apply!(mon({ atk: 100, spa: 80 }))
    expect(out.atk).toBe(110)
    expect(out.spa).toBe(88)

    const noShare = [mon({ types: ['fire'] }), mon({ types: ['water'] }), mon({ types: ['grass'] })]
    expect(has(computeSynergy(noShare), '同屬共鳴')).toBe(false)
  })

  it('世代羈絆：全同世代 → HP +8%；跨世代不觸發', () => {
    const gen1 = [mon({ speciesId: 6 }), mon({ speciesId: 25 }), mon({ speciesId: 130 })]
    const mods = computeSynergy(gen1)
    expect(has(mods, '世代羈絆')).toBe(true)
    // 滿血時同比例放大 maxHp/currentHp，仍保持滿血（不引入「回血」副作用）
    const out = mods.find((m) => m.label.includes('世代'))!.apply!(mon({ maxHp: 200, currentHp: 200 }))
    expect(out.maxHp).toBe(216)
    expect(out.currentHp).toBe(216)

    const mixed = [mon({ speciesId: 6 }), mon({ speciesId: 160 })]
    expect(has(computeSynergy(mixed), '世代羈絆')).toBe(false)
  })

  it('世代羈絆套在殘血單位：currentHp 夾在新 maxHp 內、不溢出', () => {
    const gen = [mon({ speciesId: 1 }), mon({ speciesId: 2 })]
    const apply = computeSynergy(gen).find((m) => m.label.includes('世代'))!.apply!
    const out = apply(mon({ maxHp: 100, currentHp: 50 }))
    expect(out.maxHp).toBe(108)
    expect(out.currentHp).toBeLessThanOrEqual(out.maxHp)
    expect(out.currentHp).toBe(54)
  })

  it('空隊 / 單隻：不觸發任何需要 ≥2 的羈絆', () => {
    expect(computeSynergy([])).toEqual([])
    expect(has(computeSynergy([mon({ types: ['fire'] })]), '同屬共鳴')).toBe(false)
    expect(has(computeSynergy([mon({ speciesId: 6 })]), '世代羈絆')).toBe(false)
  })
})

describe('M7 羈絆掛載（prep 閘控，可選式）', () => {
  const team = () => [mon({ types: ['fire'], speciesId: 6 }), mon({ types: ['fire'], speciesId: 25 }), mon({ types: ['water'], speciesId: 130 })]
  const reg = [SYNERGY_MODULE]

  it('關閉：prep 為空 → applyBattlePrep 原封不動、無 modifier', () => {
    const prep = assembleBattlePrep(defaultSettings(), reg)
    expect(prep.preBattleHooks).toHaveLength(0)
    const before = team()
    const { team: after, modifiers } = applyBattlePrep(before, prep, true)
    expect(modifiers).toEqual([])
    expect(after.map((m) => m.spe)).toEqual(before.map((m) => m.spe))
  })

  it('開啟：套用生效羈絆，且野生對手（withSynergy=false）不吃羈絆', () => {
    const on = setModuleEnabledIn(defaultSettings(), 'synergy', true)
    const prep = assembleBattlePrep(on, reg)
    const { team: player, modifiers } = applyBattlePrep(team(), prep, true)
    // 2 隻火＋1 隻水：觸發同屬共鳴（atk/spa +10%）+ 世代羈絆（HP +8%）；不觸發多樣陣容
    expect(modifiers.length).toBeGreaterThanOrEqual(2)
    expect(player[0].atk).toBe(55) // 同屬共鳴 +10%，base 50

    const { team: foe, modifiers: foeMods } = applyBattlePrep(team(), prep, false)
    expect(foeMods).toEqual([])
    expect(foe[0].atk).toBe(50) // 對手不吃羈絆
  })
})
