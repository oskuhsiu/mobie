import { describe, it, expect } from 'vitest'
import {
  rollIndividual, natureMultiplier, ivStars, NATURES, getNature,
  IV_MAX, IV_TOTAL_MAX,
} from './individual'
import type { Stats } from '@/game/types'

const flat = (v: number): Stats => ({ hp: v, atk: v, def: v, spa: v, spd: v, spe: v })

describe('rollIndividual — 決定論', () => {
  it('同 seed → 完全相同', () => {
    const a = rollIndividual('CARD-001')
    const b = rollIndividual('CARD-001')
    expect(a).toEqual(b)
  })

  it('IV 都落在 0..31', () => {
    for (const seed of ['x', 'y', 'WILD-25-12-abc', 'player-pikachu']) {
      const { ivs } = rollIndividual(seed)
      for (const k of Object.keys(ivs) as (keyof Stats)[]) {
        expect(ivs[k]).toBeGreaterThanOrEqual(0)
        expect(ivs[k]).toBeLessThanOrEqual(IV_MAX)
      }
    }
  })

  it('不同 seed 不會全部相同（有變異）', () => {
    const seeds = Array.from({ length: 16 }, (_, i) => `seed-${i}`)
    const totals = seeds.map((s) => {
      const { ivs } = rollIndividual(s)
      return ivs.hp + ivs.atk + ivs.def + ivs.spa + ivs.spd + ivs.spe
    })
    expect(new Set(totals).size).toBeGreaterThan(1)
  })

  it('nature 落在 0..24、shiny 為 boolean', () => {
    const { nature, shiny } = rollIndividual('abc')
    expect(nature).toBeGreaterThanOrEqual(0)
    expect(nature).toBeLessThan(NATURES.length)
    expect(typeof shiny).toBe('boolean')
  })
})

describe('NATURES 性格表', () => {
  it('共 25 種，5 個無影響性格 up/down 皆 null', () => {
    expect(NATURES).toHaveLength(25)
    const neutral = NATURES.filter((n) => n.up === null && n.down === null)
    expect(neutral.map((n) => n.id)).toEqual([0, 6, 12, 18, 24])
  })

  it('固執(3)=攻↑特攻↓、膽小(10)=速↑攻↓', () => {
    expect(getNature(3)).toMatchObject({ up: 'atk', down: 'spa' })
    expect(getNature(10)).toMatchObject({ up: 'spe', down: 'atk' })
  })
})

describe('natureMultiplier — ±10%', () => {
  it('提升 ×1.1、下降 ×0.9、其餘 ×1，HP 永遠 1', () => {
    // 固執(3)：atk↑ spa↓
    expect(natureMultiplier(3, 'atk')).toBeCloseTo(1.1)
    expect(natureMultiplier(3, 'spa')).toBeCloseTo(0.9)
    expect(natureMultiplier(3, 'def')).toBe(1)
    expect(natureMultiplier(3, 'hp')).toBe(1)
  })

  it('無影響性格(0) 全部 ×1', () => {
    for (const k of ['atk', 'def', 'spa', 'spd', 'spe', 'hp'] as (keyof Stats)[]) {
      expect(natureMultiplier(0, k)).toBe(1)
    }
  })
})

describe('ivStars — IV 總和 → 1..5 星', () => {
  it('全 0 → 1 星、全滿 → 5 星', () => {
    expect(ivStars(flat(0))).toBe(1)
    expect(ivStars(flat(IV_MAX))).toBe(5)
    expect(IV_TOTAL_MAX).toBe(186)
  })

  it('星級隨總和單調不減', () => {
    let prev = 0
    for (let v = 0; v <= IV_MAX; v++) {
      const s = ivStars(flat(v))
      expect(s).toBeGreaterThanOrEqual(prev)
      prev = s
    }
  })
})
