// M6（原 M7.0）— 模式 contract：捕獲資格集中由 region.mode 決定（plan/11 §2）。
import { describe, it, expect } from 'vitest'
import { REGIONS } from './regions'
import { PRACTICE_REGION } from './practiceRegion'
import { canCaptureIn, lookupRegion, ALL_REGIONS } from './regionLookup'
import { lookupTerrain, resolveBattleTerrains } from './terrains'

describe('M6 模式 contract', () => {
  it('競技場（原練習場）為 arena、不可捕獲', () => {
    expect(PRACTICE_REGION.mode).toBe('arena')
    expect(canCaptureIn(PRACTICE_REGION.id)).toBe(false)
  })

  it('所有主題區為 wild、可捕獲', () => {
    expect(REGIONS.length).toBeGreaterThan(0)
    for (const r of REGIONS) {
      expect(r.mode).toBe('wild')
      expect(canCaptureIn(r.id)).toBe(true)
    }
  })

  it('未選區域 / 未知 id → 不可捕獲（不丟例外）', () => {
    expect(canCaptureIn(null)).toBe(false)
    expect(canCaptureIn('does-not-exist')).toBe(false)
  })

  it('lookupRegion 含競技場、查無拋錯', () => {
    expect(lookupRegion(PRACTICE_REGION.id).id).toBe('practice')
    expect(ALL_REGIONS).toContain(PRACTICE_REGION)
    expect(() => lookupRegion('nope')).toThrow()
  })
})

describe('M8 地形 contract', () => {
  it('所有區域的 terrains id 都查得到 TerrainDef（catch 產生器/手寫筆誤）', () => {
    for (const r of ALL_REGIONS) {
      for (const id of r.terrains ?? []) {
        expect(lookupTerrain(id), `${r.id} → ${id}`).toBeDefined()
      }
    }
  })

  it('arena 開場一律中性（空地形）；wild 主題區皆有地形', () => {
    expect(resolveBattleTerrains(PRACTICE_REGION, 'seed')).toEqual([])
    for (const r of REGIONS) {
      expect(resolveBattleTerrains(r, 'seed').length, r.id).toBeGreaterThan(0)
    }
  })

  it('隨機地形區開場抽出的地形落在其地形池內', () => {
    const random = REGIONS.filter((r) => r.randomTerrain)
    expect(random.length).toBeGreaterThan(0)
    for (const r of random) {
      const picked = resolveBattleTerrains(r, 'any-seed')
      expect(picked).toHaveLength(1)
      expect(r.terrains).toContain(picked[0])
    }
  })
})
