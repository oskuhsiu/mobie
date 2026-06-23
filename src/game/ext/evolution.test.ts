// M10 — 進化（S6 postGrowth）測試。用真實 SPECIES 進化資料（gen_dex 由 PokéAPI evolution-chain 派生）。
import { describe, it, expect } from 'vitest'
import { evolvedSpeciesId, EVOLUTION_MODULE } from './evolution'
import { assemblePostGrowth } from '@/store/ext'
import { defaultSettings, setModuleEnabledIn } from '@/game/settings'
import { SPECIES } from '@/game/data/species'
import type { OwnedUnit } from '@/game/types'

const unit = (over: Partial<OwnedUnit>): OwnedUnit => ({
  id: 'u', speciesId: 1, level: 5, exp: 125,
  ivs: { hp: 31, atk: 20, def: 15, spa: 28, spd: 22, spe: 9 }, nature: 7, seed: 'seed-u', shiny: true,
  heldItemId: 'lifeorb', ...over,
})

describe('M10 進化 — evolvedSpeciesId（真實 dex 資料）', () => {
  it('低於 evolveLevel 不進化（回 null）', () => {
    expect(evolvedSpeciesId(unit({ speciesId: 1, level: 5 }))).toBeNull() // 妙蛙種子 @16 進化
  })
  it('達 evolveLevel 進化一階', () => {
    expect(SPECIES[1].evolvesTo).toBe(2)
    expect(SPECIES[1].evolveLevel).toBe(16)
    expect(evolvedSpeciesId(unit({ speciesId: 1, level: 16 }))).toBe(2) // 妙蛙種子→妙蛙草
  })
  it('連跳多階：等級夠高一次跳到最終進化', () => {
    // 妙蛙種子(1)@16→妙蛙草(2)@32→妙蛙花(3)
    expect(evolvedSpeciesId(unit({ speciesId: 1, level: 32 }))).toBe(3)
    // 綠毛蟲(10)@7→鐵甲蛹(11)@10→巴大蝶(12)
    expect(evolvedSpeciesId(unit({ speciesId: 10, level: 12 }))).toBe(12)
  })
  it('中間階只升一步（等級不足跳第二階）', () => {
    expect(evolvedSpeciesId(unit({ speciesId: 1, level: 20 }))).toBe(2) // 16≤20<32 → 只到妙蛙草
  })
  it('最終進化不再進化（回 null）', () => {
    expect(SPECIES[3].evolvesTo).toBeUndefined()
    expect(evolvedSpeciesId(unit({ speciesId: 3, level: 100 }))).toBeNull()
  })
})

describe('M10 進化 — S6 postGrowth 個體欄位全保留（plan/09 §4.3）', () => {
  const hook = EVOLUTION_MODULE.seams.postGrowth!
  it('只改 speciesId，IV/EXP/nature/seed/shiny/heldItemId/id 全不變', () => {
    const u = unit({ speciesId: 1, level: 16, exp: 4096 })
    const evolved = hook(u)
    expect(evolved.speciesId).toBe(2)
    expect(evolved.id).toBe(u.id)
    expect(evolved.level).toBe(u.level)
    expect(evolved.exp).toBe(u.exp)
    expect(evolved.ivs).toEqual(u.ivs)
    expect(evolved.nature).toBe(u.nature)
    expect(evolved.seed).toBe(u.seed)
    expect(evolved.shiny).toBe(u.shiny)
    expect(evolved.heldItemId).toBe(u.heldItemId)
  })
  it('未達等級原樣返回（同參照語意：speciesId 不變）', () => {
    const u = unit({ speciesId: 1, level: 5 })
    expect(hook(u).speciesId).toBe(1)
  })
})

describe('M10 進化 — assemblePostGrowth 依 settings 掛載', () => {
  it('evolution 關閉 → []（升級不進化）', () => {
    expect(assemblePostGrowth(defaultSettings())).toEqual([])
  })
  it('evolution 開啟 → 收 1 個 postGrowth hook', () => {
    const on = setModuleEnabledIn(defaultSettings(), 'evolution', true)
    const hooks = assemblePostGrowth(on)
    expect(hooks).toHaveLength(1)
    expect(hooks[0](unit({ speciesId: 1, level: 16 })).speciesId).toBe(2)
  })
})
