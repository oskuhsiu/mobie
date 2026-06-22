import { describe, it, expect } from 'vitest'
import { sanitizeRoster } from './rosterSanitize'
import { MAX_LEVEL, expForLevel } from './growth'
import { IV_MAX, NATURES } from './individual'
import type { OwnedUnit } from '@/game/types'

const unit = (over: Partial<OwnedUnit> = {}): OwnedUnit => ({
  id: 'u1',
  speciesId: 1, // 妙蛙種子，存在於圖鑑
  level: 5,
  exp: expForLevel(5),
  ivs: { hp: 10, atk: 10, def: 10, spa: 10, spd: 10, spe: 10 },
  nature: 0,
  seed: 'u1',
  shiny: false,
  ...over,
})

// 髒資料測試需要繞過型別，模擬從 localStorage 反序列化的任意值
const dirty = (o: unknown): OwnedUnit[] => [o] as unknown as OwnedUnit[]

describe('sanitizeRoster', () => {
  it('合法單位原樣保留', () => {
    const u = unit()
    expect(sanitizeRoster([u])).toEqual([u])
  })

  it('丟棄 speciesId 不在圖鑑的單位（擋 getSpecies 拋錯死迴圈）', () => {
    expect(sanitizeRoster([unit({ speciesId: 99999 })])).toEqual([])
    expect(sanitizeRoster(dirty({ ...unit(), speciesId: 'x' }))).toEqual([])
  })

  it('丟棄沒有字串 id 的單位', () => {
    expect(sanitizeRoster(dirty({ ...unit(), id: 123 }))).toEqual([])
    expect(sanitizeRoster(dirty({ ...unit(), id: '' }))).toEqual([])
  })

  it('level 夾到 1..MAX_LEVEL', () => {
    expect(sanitizeRoster([unit({ level: 999, exp: 0 })])[0].level).toBe(MAX_LEVEL)
    expect(sanitizeRoster([unit({ level: -5, exp: 0 })])[0].level).toBe(1)
  })

  it('level 至少對齊 exp 反推的等級（與 applyExp 一致）', () => {
    // exp = 10^3 → 至少 Lv.10，即使存檔 level 寫 1
    const r = sanitizeRoster([unit({ level: 1, exp: 1000 })])[0]
    expect(r.level).toBe(10)
  })

  it('exp 夾到 0..MAX_EXP', () => {
    expect(sanitizeRoster([unit({ exp: -100 })])[0].exp).toBe(0)
    expect(sanitizeRoster([unit({ exp: 9e9 })])[0].exp).toBe(expForLevel(MAX_LEVEL))
  })

  it('ivs 各項夾到 0..IV_MAX，缺漏補 0', () => {
    const r = sanitizeRoster([unit({ ivs: { hp: 999, atk: -5 } as never })])[0]
    expect(r.ivs.hp).toBe(IV_MAX)
    expect(r.ivs.atk).toBe(0)
    expect(r.ivs.spe).toBe(0) // 缺漏
  })

  it('nature 夾到 0..NATURES.length-1', () => {
    expect(sanitizeRoster([unit({ nature: 999 })])[0].nature).toBe(NATURES.length - 1)
    expect(sanitizeRoster([unit({ nature: -1 })])[0].nature).toBe(0)
  })

  it('NaN / 非數字欄位用安全 fallback、不外洩 NaN', () => {
    const r = sanitizeRoster(dirty({ ...unit(), level: NaN, exp: NaN, nature: NaN }))[0]
    expect(Number.isFinite(r.level)).toBe(true)
    expect(Number.isFinite(r.exp)).toBe(true)
    expect(Number.isFinite(r.nature)).toBe(true)
    expect(r.level).toBe(1)
  })

  it('seed 非字串時退回用 id', () => {
    expect(sanitizeRoster(dirty({ ...unit(), seed: 42 }))[0].seed).toBe('u1')
  })

  it('非陣列輸入回空陣列', () => {
    expect(sanitizeRoster(null as unknown as OwnedUnit[])).toEqual([])
  })
})
