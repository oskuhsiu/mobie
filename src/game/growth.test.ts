import { describe, it, expect } from 'vitest'
import {
  expForLevel, levelFromExp, expYield, applyExp,
  createOwnedUnit, ownedToCard, MAX_LEVEL,
} from './growth'
import { MemoryAdapter } from './persistence'
import type { OwnedUnit } from '@/game/types'

describe('n^3 經驗曲線', () => {
  it('expForLevel = n^3', () => {
    expect(expForLevel(1)).toBe(1)
    expect(expForLevel(5)).toBe(125)
    expect(expForLevel(10)).toBe(1000)
    expect(expForLevel(100)).toBe(1_000_000)
  })

  it('levelFromExp 為其反函數（取不超過的最大等級）', () => {
    expect(levelFromExp(0)).toBe(1)
    expect(levelFromExp(1)).toBe(1)
    expect(levelFromExp(343)).toBe(7)   // 7^3
    expect(levelFromExp(342)).toBe(6)   // 差 1 → 還是 6
    expect(levelFromExp(1000)).toBe(10)
    expect(levelFromExp(999)).toBe(9)
    expect(levelFromExp(1_000_000)).toBe(100)
  })

  it('每一級往返一致', () => {
    for (let n = 1; n <= MAX_LEVEL; n++) {
      expect(levelFromExp(expForLevel(n))).toBe(n)
    }
  })
})

describe('expYield', () => {
  it('隨被擊敗者等級單調遞增、為正整數', () => {
    let prev = 0
    for (let L = 1; L <= 50; L++) {
      const y = expYield(L)
      expect(Number.isInteger(y)).toBe(true)
      expect(y).toBeGreaterThan(prev)
      prev = y
    }
  })
})

describe('applyExp — 升級重算', () => {
  const base: OwnedUnit = {
    id: 'u1', speciesId: 1, level: 7, exp: expForLevel(7),
    ivs: { hp: 16, atk: 16, def: 16, spa: 16, spd: 16, spe: 16 }, nature: 0, seed: 'u1', shiny: false,
  }

  it('累積足夠經驗會升級', () => {
    const r = applyExp(base, 512 - 343 + 1) // 跨過 8^3=512
    expect(r.fromLevel).toBe(7)
    expect(r.toLevel).toBe(8)
    expect(r.leveledUp).toBe(true)
    expect(r.unit.level).toBe(8)
    expect(r.unit.exp).toBe(343 + (512 - 343 + 1))
  })

  it('經驗不足不升級', () => {
    const r = applyExp(base, 10)
    expect(r.leveledUp).toBe(false)
    expect(r.toLevel).toBe(7)
  })

  it('等級只增不減、不超過 MAX_LEVEL', () => {
    const maxed = applyExp({ ...base, level: MAX_LEVEL, exp: expForLevel(MAX_LEVEL) }, 999999)
    expect(maxed.unit.level).toBe(MAX_LEVEL)
    expect(maxed.unit.exp).toBeLessThanOrEqual(expForLevel(MAX_LEVEL))
  })
})

describe('createOwnedUnit / ownedToCard', () => {
  it('同 seed 決定論、exp 對齊起始等級', () => {
    const a = createOwnedUnit('seed-x', 25, 12)
    const b = createOwnedUnit('seed-x', 25, 12)
    expect(a).toEqual(b)
    expect(a.level).toBe(12)
    expect(a.exp).toBe(expForLevel(12))
    expect(a.id).toBe('seed-x')
  })

  it('ownedToCard 帶 canonical 個體', () => {
    const u = createOwnedUnit('seed-y', 1, 5)
    const c = ownedToCard(u)
    expect(c).toMatchObject({ cardId: 'seed-y', speciesId: 1, level: 5, ivs: u.ivs, nature: u.nature, shiny: u.shiny })
  })

  it('card 顯式 shiny/nature/ivs 覆寫 seed roll（掃描/自製卡）', () => {
    const u = createOwnedUnit('seed-z', 25, 12, { shiny: true, nature: 7, ivs: { atk: 31 } })
    expect(u.shiny).toBe(true)
    expect(u.nature).toBe(7)
    expect(u.ivs.atk).toBe(31) // 覆寫
    // 未指定的 iv 仍走 seed roll（與不帶覆寫時一致）
    expect(u.ivs.hp).toBe(createOwnedUnit('seed-z', 25, 12).ivs.hp)
  })
})

describe('PersistenceAdapter（MemoryAdapter 契約）', () => {
  it('saveRoster/loadRoster 往返', async () => {
    const a = new MemoryAdapter()
    const roster = [createOwnedUnit('a', 1, 5), createOwnedUnit('b', 2, 6)]
    await a.saveRoster(roster)
    const back = await a.loadRoster()
    expect(back).toEqual(roster)
  })

  it('saveUnit 更新既有 / 新增', async () => {
    const a = new MemoryAdapter()
    const u = createOwnedUnit('a', 1, 5)
    await a.saveUnit(u)
    const leveled = applyExp(u, 999999).unit
    await a.saveUnit(leveled)
    const roster = await a.loadRoster()
    expect(roster).toHaveLength(1)
    expect(roster[0].level).toBe(leveled.level)
    await a.saveUnit(createOwnedUnit('b', 2, 6))
    expect(await a.loadRoster()).toHaveLength(2)
  })
})
