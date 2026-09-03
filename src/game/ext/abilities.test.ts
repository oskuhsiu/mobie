// M7 — 特性（S1/S3）。設計真相：plan/10。測試實際掛載的縫（ABILITIES_MODULE.seams）。
import { describe, it, expect } from 'vitest'
import type { TypeName } from '@/game/types'
import { mon } from '@/game/battle/testFixtures'
import { ABILITIES_MODULE, ABILITIES, getAbility, abilityForType, resolveAbilityDamageEffect } from '@/game/ext/abilities'

const build = ABILITIES_MODULE.seams.buildUnit!
const damage = ABILITIES_MODULE.seams.damageHook!
const ALL_TYPES: TypeName[] = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
  'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
]
const ctx = (attacker: ReturnType<typeof mon>, defender: ReturnType<typeof mon>, effectiveness = 1) => ({
  attacker, defender, effectiveness,
})

describe('M7 特性表 / 屬性指派', () => {
  it('每個特性有 id/name/icon/desc + 合法 kind', () => {
    for (const d of ABILITIES) {
      expect(d.id && d.name && d.icon && d.desc).toBeTruthy()
      expect(['statMod', 'pinch', 'guard']).toContain(d.kind)
    }
  })
  it('18 型全有對應特性、且都是已知 id', () => {
    for (const t of ALL_TYPES) {
      const id = abilityForType(t)
      expect(getAbility(id)).toBeDefined()
    }
  })
})

describe('M7 特性 S1 buildUnit', () => {
  it('依主屬性寫入 abilityId', () => {
    expect(build(mon({ types: ['fire'] })).abilityId).toBe('pinch_boost')
    expect(build(mon({ types: ['fighting'] })).abilityId).toBe('power')
    expect(build(mon({ types: ['ice'] })).abilityId).toBe('guard')
  })
  it('statMod 型特性套能力值倍率', () => {
    expect(build(mon({ types: ['fighting'], atk: 100 })).atk).toBe(115) // 蠻力
    expect(build(mon({ types: ['steel'], def: 100 })).def).toBe(120) // 鐵壁
    expect(build(mon({ types: ['electric'], spe: 100 })).spe).toBe(125) // 疾風
    expect(build(mon({ types: ['psychic'], spa: 100 })).spa).toBe(115) // 神秘體
  })
  it('pinch / guard 型特性不改能力值（只在 S3 生效）', () => {
    const f = build(mon({ types: ['fire'], atk: 100, spa: 100 }))
    expect(f.atk).toBe(100)
    expect(f.spa).toBe(100)
  })
})

describe('M7 特性 S3 damageHook', () => {
  it('絕境爆發：攻擊方 HP ≤ 1/3 → ×1.5；高於則 ×1', () => {
    const low = mon({ abilityId: 'pinch_boost', maxHp: 100, currentHp: 30 })
    const high = mon({ abilityId: 'pinch_boost', maxHp: 100, currentHp: 50 })
    expect(damage(ctx(low, mon()))).toBeCloseTo(1.5)
    expect(damage(ctx(high, mon()))).toBe(1)
  })
  it('厚實：防守方被效果絕佳攻擊 → ×0.8；普通 → ×1', () => {
    const guarded = mon({ abilityId: 'guard' })
    expect(damage(ctx(mon(), guarded, 2))).toBeCloseTo(0.8)
    expect(damage(ctx(mon(), guarded, 1))).toBe(1)
  })
  it('攻守特性同時生效：絕境爆發 ×1.5 × 厚實 ×0.8 疊乘', () => {
    const atk = mon({ abilityId: 'pinch_boost', maxHp: 100, currentHp: 20 })
    const def = mon({ abilityId: 'guard' })
    expect(damage(ctx(atk, def, 2))).toBeCloseTo(1.2)
  })
  it('無特性：傷害倍率 ×1', () => {
    expect(damage(ctx(mon(), mon(), 2))).toBe(1)
  })

  it('shares active attack and guard sources with the HUD', () => {
    const result = resolveAbilityDamageEffect(ctx(
      mon({ abilityId: 'pinch_boost', maxHp: 90, currentHp: 30 }),
      mon({ abilityId: 'guard' }),
      2,
    ))
    expect(result.multiplier).toBeCloseTo(1.2)
    expect(result).toMatchObject({
      attackerSource: { id: 'pinch_boost', name: '絕境爆發' },
      defenderSource: { id: 'guard', name: '厚實' },
    })
  })
})
