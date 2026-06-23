// M6（原 M7.0）— 模式 contract：捕獲資格集中由 region.mode 決定（plan/11 §2）。
import { describe, it, expect } from 'vitest'
import { REGIONS } from './regions'
import { PRACTICE_REGION } from './practiceRegion'
import { canCaptureIn, lookupRegion, ALL_REGIONS } from './regionLookup'

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
