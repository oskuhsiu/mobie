import { describe, it, expect } from 'vitest'
import { typeMultiplier, typeEffectiveness, effectivenessLabel } from './typeChart'

describe('typeMultiplier（單屬性相剋）', () => {
  it('剋制為 2 倍', () => {
    expect(typeMultiplier('fire', 'grass')).toBe(2)
    expect(typeMultiplier('water', 'fire')).toBe(2)
  })
  it('被抵抗為 0.5 倍', () => {
    expect(typeMultiplier('fire', 'water')).toBe(0.5)
    expect(typeMultiplier('water', 'water')).toBe(0.5)
  })
  it('無效為 0 倍', () => {
    expect(typeMultiplier('electric', 'ground')).toBe(0)
    expect(typeMultiplier('normal', 'ghost')).toBe(0)
    expect(typeMultiplier('ground', 'flying')).toBe(0)
  })
  it('無相剋關係為 1 倍', () => {
    expect(typeMultiplier('normal', 'water')).toBe(1)
    expect(typeMultiplier('fire', 'electric')).toBe(1)
  })
})

describe('typeEffectiveness（雙屬性連乘）', () => {
  it('妙蛙種子(草/毒) 受火 = 2 倍', () => {
    expect(typeEffectiveness('fire', ['grass', 'poison'])).toBe(2)
  })
  it('小拳石(岩/地) 受水 = 4 倍', () => {
    expect(typeEffectiveness('water', ['rock', 'ground'])).toBe(4)
  })
  it('岩 對 火/飛 = 4 倍', () => {
    expect(typeEffectiveness('rock', ['fire', 'flying'])).toBe(4)
  })
  it('含免疫屬性 → 0 倍', () => {
    expect(typeEffectiveness('normal', ['ghost'])).toBe(0)
  })
})

describe('effectivenessLabel', () => {
  it('依倍率給文案', () => {
    expect(effectivenessLabel(0)).toBe('沒有效果…')
    expect(effectivenessLabel(2)).toBe('效果絕佳！')
    expect(effectivenessLabel(4)).toBe('效果絕佳！')
    expect(effectivenessLabel(0.5)).toBe('效果不太好…')
    expect(effectivenessLabel(1)).toBeNull()
  })
})
