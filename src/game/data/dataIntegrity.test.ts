// 資料完整性壓力測試：把全 251 物種 / 招式 / 區域 / 卡 / 相剋表逐筆掃過，
// 確保生成資料（species/moves/regions/playerCards）與手寫資料（practiceRegion）皆自洽、
// 不會在 runtime 才炸（getSpecies/getMove 拋錯、區域引用不存在的物種、相剋倍率越界…）。
import { describe, it, expect } from 'vitest'
import type { Stats, TypeName } from '@/game/types'
import { SPECIES, getSpecies } from '@/game/data/species'
import { MOVES, getMove } from '@/game/data/moves'
import { REGIONS } from '@/game/data/regions'
import { PRACTICE_REGION } from '@/game/data/practiceRegion'
import { PLAYER_CARDS } from '@/game/data/playerCards'
import { lookupRegion, canCaptureIn } from '@/game/data/regionLookup'
import { typeMultiplier, typeEffectiveness, effectivenessLabel } from '@/game/data/typeChart'

const ALL_TYPES: TypeName[] = [
  'normal', 'fire', 'water', 'electric', 'grass', 'ice', 'fighting', 'poison', 'ground',
  'flying', 'psychic', 'bug', 'rock', 'ghost', 'dragon', 'dark', 'steel', 'fairy',
]
const TYPE_SET = new Set(ALL_TYPES)
const STAT_KEYS: (keyof Stats)[] = ['hp', 'atk', 'def', 'spa', 'spd', 'spe']
const DEX_MAX = 251
const ids = Array.from({ length: DEX_MAX }, (_, i) => i + 1)
const isPosInt = (n: unknown): n is number => typeof n === 'number' && Number.isInteger(n) && n > 0

describe('資料完整性 · SPECIES（全國圖鑑 1–251）', () => {
  it('每個編號 1–251 都存在、id 自洽、getSpecies 不拋', () => {
    expect(Object.keys(SPECIES)).toHaveLength(DEX_MAX)
    for (const id of ids) {
      const sp = SPECIES[id]
      expect(sp, `species ${id} 缺失`).toBeDefined()
      expect(sp.id).toBe(id)
      expect(() => getSpecies(id)).not.toThrow()
      expect(typeof sp.nameZh).toBe('string')
      expect(sp.nameZh.length).toBeGreaterThan(0)
    }
  })

  it('屬性 1–2 個、皆合法 TypeName', () => {
    for (const id of ids) {
      const t = SPECIES[id].types
      expect(t.length).toBeGreaterThanOrEqual(1)
      expect(t.length).toBeLessThanOrEqual(2)
      for (const ty of t) expect(TYPE_SET.has(ty), `species ${id} 屬性 ${ty} 非法`).toBe(true)
      if (t.length === 2) expect(t[0]).not.toBe(t[1]) // 不重複屬性
    }
  })

  it('種族值六項皆正整數', () => {
    for (const id of ids) {
      const b = SPECIES[id].baseStats
      for (const k of STAT_KEYS) expect(isPosInt(b[k]), `species ${id} baseStats.${k}=${b[k]}`).toBe(true)
    }
  })

  it('artwork 走官方 raw URL（不內建侵權）、編號對應', () => {
    for (const id of ids) {
      expect(SPECIES[id].artworkUrl).toBe(
        `https://raw.githubusercontent.com/PokeAPI/sprites/master/sprites/pokemon/other/official-artwork/${id}.png`,
      )
    }
  })

  it('全 18 屬性都有物種覆蓋（內容廣度）', () => {
    const covered = new Set<TypeName>()
    for (const id of ids) for (const t of SPECIES[id].types) covered.add(t)
    expect(covered.size).toBe(18)
  })
})

describe('資料完整性 · MOVES（每物種專屬招）', () => {
  it('每物種 moveId 都解得出招式、欄位合法', () => {
    for (const id of ids) {
      const sp = SPECIES[id]
      expect(() => getMove(sp.moveId), `species ${id} moveId ${sp.moveId} 解不出`).not.toThrow()
      const mv = getMove(sp.moveId)
      expect(TYPE_SET.has(mv.type)).toBe(true)
      expect(isPosInt(mv.power)).toBe(true)
      expect(mv.accuracy).toBeGreaterThan(0)
      expect(mv.accuracy).toBeLessThanOrEqual(100)
      expect(['physical', 'special']).toContain(mv.category)
      expect(mv.nameZh.length).toBeGreaterThan(0)
    }
  })

  it('MOVES 表自身無壞項', () => {
    for (const [k, mv] of Object.entries(MOVES)) {
      expect(mv.id).toBe(Number(k))
      expect(TYPE_SET.has(mv.type)).toBe(true)
    }
  })
})

describe('資料完整性 · REGIONS（8 主題野外區）+ 競技場', () => {
  it('野外區皆 mode=wild、欄位齊、遭遇表引用合法物種與等級帶', () => {
    expect(REGIONS.length).toBeGreaterThanOrEqual(1)
    const seenIds = new Set<string>()
    for (const r of REGIONS) {
      expect(r.id.length).toBeGreaterThan(0)
      expect(seenIds.has(r.id), `region id 重複 ${r.id}`).toBe(false)
      seenIds.add(r.id)
      expect(r.name.length).toBeGreaterThan(0)
      expect(r.mode).toBe('wild')
      expect(r.gradient).toHaveLength(2)
      expect(r.encounters.length).toBeGreaterThan(0)
      for (const e of r.encounters) {
        expect(SPECIES[e.speciesId], `region ${r.id} 引用不存在物種 ${e.speciesId}`).toBeDefined()
        expect(e.weight).toBeGreaterThan(0)
        expect(e.minLevel).toBeGreaterThanOrEqual(1)
        expect(e.minLevel).toBeLessThanOrEqual(e.maxLevel)
        expect(e.maxLevel).toBeLessThanOrEqual(100)
      }
    }
  })

  it('競技場 mode=arena、遭遇表引用合法物種', () => {
    expect(PRACTICE_REGION.mode).toBe('arena')
    expect(PRACTICE_REGION.encounters.length).toBeGreaterThan(0)
    for (const e of PRACTICE_REGION.encounters) {
      expect(SPECIES[e.speciesId]).toBeDefined()
      expect(e.minLevel).toBeLessThanOrEqual(e.maxLevel)
    }
  })

  it('regionLookup / canCaptureIn 依 mode 分流正確', () => {
    expect(lookupRegion(PRACTICE_REGION.id).mode).toBe('arena')
    expect(canCaptureIn(PRACTICE_REGION.id)).toBe(false) // 競技場不可捕獲
    for (const r of REGIONS) {
      expect(lookupRegion(r.id).id).toBe(r.id)
      expect(canCaptureIn(r.id)).toBe(true) // 野外可捕獲
    }
    expect(canCaptureIn('does-not-exist')).toBe(false) // 未知 → 安全 false
  })
})

describe('資料完整性 · PLAYER_CARDS（起始 roster）', () => {
  it('起始卡跨屬性、引用合法物種、等級/卡號合法且唯一', () => {
    expect(PLAYER_CARDS.length).toBeGreaterThanOrEqual(5)
    const seen = new Set<string>()
    for (const c of PLAYER_CARDS) {
      expect(SPECIES[c.speciesId], `playerCard 引用不存在物種 ${c.speciesId}`).toBeDefined()
      expect(c.level).toBeGreaterThanOrEqual(1)
      expect(c.level).toBeLessThanOrEqual(100)
      expect(c.cardId.length).toBeGreaterThan(0)
      expect(seen.has(c.cardId), `cardId 重複 ${c.cardId}`).toBe(false)
      seen.add(c.cardId)
    }
  })
})

describe('資料完整性 · 相剋表（18×18）', () => {
  it('單屬倍率僅 {0,0.5,1,2}；雙屬連乘僅 {0,0.25,0.5,1,2,4}', () => {
    const single = new Set([0, 0.5, 1, 2])
    const dual = new Set([0, 0.25, 0.5, 1, 2, 4])
    for (const atk of ALL_TYPES) {
      for (const def of ALL_TYPES) {
        expect(single.has(typeMultiplier(atk, def)), `${atk}→${def}=${typeMultiplier(atk, def)}`).toBe(true)
        for (const def2 of ALL_TYPES) {
          const e = typeEffectiveness(atk, [def, def2])
          expect(dual.has(e), `${atk}→${def}/${def2}=${e}`).toBe(true)
        }
      }
    }
  })

  it('效果文案對應倍率', () => {
    expect(effectivenessLabel(0)).toBe('沒有效果…')
    expect(effectivenessLabel(2)).toBe('效果絕佳！')
    expect(effectivenessLabel(4)).toBe('效果絕佳！')
    expect(effectivenessLabel(0.5)).toBe('效果不太好…')
    expect(effectivenessLabel(1)).toBeNull()
  })

  it('已知相剋關係抽樣（水剋火、電對地無效、一般對幽靈無效、超能對惡無效）', () => {
    expect(typeMultiplier('water', 'fire')).toBe(2)
    expect(typeMultiplier('electric', 'ground')).toBe(0)
    expect(typeMultiplier('normal', 'ghost')).toBe(0)
    expect(typeMultiplier('psychic', 'dark')).toBe(0)
    expect(typeMultiplier('fire', 'grass')).toBe(2)
    expect(typeMultiplier('grass', 'fire')).toBe(0.5)
  })
})
