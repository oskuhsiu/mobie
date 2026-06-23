// M10 — 星級 Grade（純派生）測試。證明：與 IV/shiny/BST 單調、異色保底 5、滿值傳說=6、零 buff（不碰個體欄）。
import { describe, it, expect } from 'vitest'
import { computeGrade, isShiningGrade, type GradeInput } from './grade'
import type { Species, Stats } from '@/game/types'

const ivs = (v: number): Stats => ({ hp: v, atk: v, def: v, spa: v, spd: v, spe: v })
const indiv = (v: number, shiny = false): GradeInput => ({ ivs: ivs(v), shiny })
const species = (bst: number): Species => ({
  id: 1, name: 'X', nameZh: '某', types: ['normal'],
  baseStats: { hp: bst / 6, atk: bst / 6, def: bst / 6, spa: bst / 6, spd: bst / 6, spe: bst / 6 },
  moveId: 1, artworkUrl: '',
})

const common = species(400) // 一般種
const legendary = species(680) // 傳說（高 BST）

describe('M10 Grade — 範圍與單調', () => {
  it('恆落在 1..6', () => {
    for (const v of [0, 8, 16, 24, 31]) {
      for (const sh of [false, true]) {
        for (const sp of [common, legendary]) {
          const g = computeGrade(indiv(v, sh), sp)
          expect(g).toBeGreaterThanOrEqual(1)
          expect(g).toBeLessThanOrEqual(6)
        }
      }
    }
  })
  it('IV 越高 Grade 不減（單調）', () => {
    let prev = 0
    for (const v of [0, 8, 16, 24, 31]) {
      const g = computeGrade(indiv(v), common)
      expect(g).toBeGreaterThanOrEqual(prev)
      prev = g
    }
  })
  it('普通低 IV 一般種 = 較低 Grade', () => {
    expect(computeGrade(indiv(2), common)).toBeLessThanOrEqual(2)
  })
})

describe('M10 Grade — 異色 / 稀有度', () => {
  it('異色 → 至少 5（Star）', () => {
    expect(computeGrade(indiv(2, true), common)).toBeGreaterThanOrEqual(5)
    expect(computeGrade(indiv(31, true), common)).toBeGreaterThanOrEqual(5)
  })
  it('同個體：傳說種 Grade ≥ 一般種（BST 稀有加成）', () => {
    expect(computeGrade(indiv(20), legendary)).toBeGreaterThanOrEqual(computeGrade(indiv(20), common))
  })
  it('異色 + 滿 IV + 傳說 = 6（Superstar）', () => {
    expect(computeGrade(indiv(31, true), legendary)).toBe(6)
  })
  it('isShiningGrade：5/6 發光，≤4 不發光', () => {
    expect(isShiningGrade(4)).toBe(false)
    expect(isShiningGrade(5)).toBe(true)
    expect(isShiningGrade(6)).toBe(true)
  })
})

describe('M10 Grade — 零 buff（純讀，不動輸入）', () => {
  it('不改動傳入的個體物件', () => {
    const u = indiv(20, true)
    const snapshot = JSON.stringify(u)
    computeGrade(u, common)
    expect(JSON.stringify(u)).toBe(snapshot)
  })
})
