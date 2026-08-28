import { describe, expect, it } from 'vitest'
import { safeBgmStartTime } from './audioEngine'

describe('safeBgmStartTime', () => {
  it('keeps future transport time and makes each lane strictly increasing', () => {
    expect(safeBgmStartTime(12.5, 12, Number.NEGATIVE_INFINITY)).toBe(12.5)
    expect(safeBgmStartTime(12.5, 12, 12.5)).toBeCloseTo(12.5 + 1 / 48_000)
  })

  it('drops callbacks at or behind current audio time', () => {
    expect(safeBgmStartTime(21, 21, 20.9)).toBeNull()
    expect(safeBgmStartTime(20.98, 21, 20.9)).toBeNull()
  })

  it('drops stale catch-up callbacks instead of compressing missed melody notes', () => {
    expect(safeBgmStartTime(20.8, 21, 20.7)).toBeNull()
  })

  it('uses the supplied audio sample duration for strict ordering', () => {
    expect(safeBgmStartTime(8, 7, 8, 1 / 44_100)).toBeCloseTo(8 + 1 / 44_100)
  })
})
