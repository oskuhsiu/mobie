import { describe, it, expect } from 'vitest'
import type { TerrainId } from '@/game/types'
import {
  TERRAINS,
  lookupTerrain,
  terrainMultiplier,
  resolveTerrainMult,
  rollRandomTerrain,
  resolveBattleTerrains,
  TERRAIN_CLAMP_MIN,
  TERRAIN_CLAMP_MAX,
} from './terrains'

const def = (id: TerrainId) => lookupTerrain(id)!

describe('terrainMultiplier — 單一地形', () => {
  it('增益屬性回該倍率（grassland: grass ×1.3）', () => {
    expect(terrainMultiplier('grass', [def('grassland')])).toBeCloseTo(1.3)
  })
  it('減益屬性回該倍率（grassland: fire ×0.8）', () => {
    expect(terrainMultiplier('fire', [def('grassland')])).toBeCloseTo(0.8)
  })
  it('未列出的屬性＝中性 1（grassland 對 water 無影響）', () => {
    expect(terrainMultiplier('water', [def('grassland')])).toBe(1)
  })
  it('neutral / 空地形＝1', () => {
    expect(terrainMultiplier('fire', [def('neutral')])).toBe(1)
    expect(terrainMultiplier('fire', [])).toBe(1)
  })
})

describe('terrainMultiplier — 混合（逐屬性相乘）+ clamp', () => {
  it('混合相乘後夾上限 1.5（grassland 1.3 × flowerfield 1.2 = 1.56 → 1.5）', () => {
    const m = terrainMultiplier('grass', [def('grassland'), def('flowerfield')])
    expect(m).toBe(TERRAIN_CLAMP_MAX)
  })
  it('混合相乘後夾下限 0.5（coastal 0.7 × snowfield 0.7 = 0.49 → 0.5）', () => {
    const m = terrainMultiplier('fire', [def('coastal'), def('snowfield')])
    expect(m).toBe(TERRAIN_CLAMP_MIN)
  })
  it('混合中一增一減＝相乘（grassland grass1.3 × snowfield grass0.8 = 1.04，未觸界）', () => {
    expect(terrainMultiplier('grass', [def('grassland'), def('snowfield')])).toBeCloseTo(1.04)
  })
  it('單一地形不會超界（所有 TERRAINS 任一屬性夾在 [0.5,1.5]）', () => {
    for (const t of TERRAINS) {
      for (const v of Object.values(t.mods)) {
        expect(v).toBeGreaterThanOrEqual(TERRAIN_CLAMP_MIN)
        expect(v).toBeLessThanOrEqual(TERRAIN_CLAMP_MAX)
      }
    }
  })
})

describe('resolveTerrainMult — 由 id 解析（reducer 注入用）', () => {
  it('已知 id 等同查表後計算', () => {
    expect(resolveTerrainMult('grass', ['grassland'])).toBeCloseTo(1.3)
    expect(resolveTerrainMult('grass', ['grassland', 'flowerfield'])).toBe(1.5)
  })
  it('未知 id 略過（不影響倍率）', () => {
    expect(resolveTerrainMult('grass', ['bogus' as TerrainId, 'grassland'])).toBeCloseTo(1.3)
  })
  it('空＝1', () => {
    expect(resolveTerrainMult('fire', [])).toBe(1)
  })
})

describe('rollRandomTerrain — 決定論抽地形', () => {
  const pool: TerrainId[] = ['grassland', 'volcanic', 'coastal', 'stormfield']
  it('同 seed 永遠相同', () => {
    expect(rollRandomTerrain(pool, 'abc')).toBe(rollRandomTerrain(pool, 'abc'))
  })
  it('抽出的一定在池內', () => {
    for (const seed of ['a', 'b', 'c', 'foe-1|foe-2', 'x'.repeat(40)]) {
      expect(pool).toContain(rollRandomTerrain(pool, seed))
    }
  })
  it('不同 seed 至少能抽到不同結果（覆蓋池）', () => {
    const seen = new Set<TerrainId>()
    for (let i = 0; i < 200; i++) seen.add(rollRandomTerrain(pool, `seed-${i}`))
    expect(seen.size).toBeGreaterThan(1)
  })
  it('空池→中性', () => {
    expect(rollRandomTerrain([], 'abc')).toBe('neutral')
  })
})

describe('resolveBattleTerrains — 依 region 解析開場地形', () => {
  it('arena → 空（中性）', () => {
    expect(resolveBattleTerrains({ mode: 'arena', terrains: ['neutral'] }, 's')).toEqual([])
  })
  it('wild 固定地形 → 直接用 terrains（含混合）', () => {
    expect(resolveBattleTerrains({ mode: 'wild', terrains: ['coastal', 'grassland'] }, 's'))
      .toEqual(['coastal', 'grassland'])
  })
  it('wild 隨機地形 → 從池決定論抽 1 個', () => {
    const pool: TerrainId[] = ['volcanic', 'cavern', 'haunt']
    const r = resolveBattleTerrains({ mode: 'wild', terrains: pool, randomTerrain: true }, 'seed')
    expect(r).toHaveLength(1)
    expect(pool).toContain(r[0])
    expect(resolveBattleTerrains({ mode: 'wild', terrains: pool, randomTerrain: true }, 'seed')).toEqual(r)
  })
  it('wild 無 terrains → 空（中性）', () => {
    expect(resolveBattleTerrains({ mode: 'wild' }, 's')).toEqual([])
  })
})
