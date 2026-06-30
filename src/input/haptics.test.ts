// EXT.1.a 觸覺回饋純函式測（plan/EXT.1 §4.a 驗收）。
// 環境＝node（無 navigator.vibrate）→ 預設一律 no-op、零報錯；可用 stubGlobal 模擬支援裝置。
import { describe, it, expect, vi, afterEach } from 'vitest'
import { HAPTIC, vibrate, haptic, canVibrate, setHapticsEnabled, type HapticKey } from '@/input/haptics'

const KEYS: HapticKey[] = ['hit', 'crit', 'superEffective', 'faint', 'qteGood', 'capture']

afterEach(() => {
  vi.unstubAllGlobals()
  setHapticsEnabled(true) // 還原總開關，避免測試間污染
})

describe('EXT.1.a haptics', () => {
  it('HAPTIC 表涵蓋所有語意 key、pattern 皆為正數或正數陣列', () => {
    for (const k of KEYS) {
      const p = HAPTIC[k]
      if (typeof p === 'number') expect(p).toBeGreaterThan(0)
      else {
        expect(Array.isArray(p)).toBe(true)
        for (const n of p) expect(n).toBeGreaterThan(0)
      }
    }
  })

  it('node 環境（不支援）→ canVibrate false、vibrate/haptic 回 false 且不丟例外', () => {
    expect(canVibrate()).toBe(false)
    expect(() => vibrate(20)).not.toThrow()
    expect(vibrate(20)).toBe(false)
    expect(haptic('crit')).toBe(false)
  })

  it('支援裝置（stub navigator.vibrate）→ 真的送出且回 true', () => {
    const spy = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate: spy })
    expect(canVibrate()).toBe(true)
    expect(haptic('hit')).toBe(true)
    expect(spy).toHaveBeenCalledWith(HAPTIC.hit)
  })

  it('總開關 off → 即使支援裝置也零呼叫', () => {
    const spy = vi.fn(() => true)
    vi.stubGlobal('navigator', { vibrate: spy })
    setHapticsEnabled(false)
    expect(vibrate(20)).toBe(false)
    expect(haptic('crit')).toBe(false)
    expect(spy).not.toHaveBeenCalled()
  })

  it('navigator.vibrate 丟例外 → 靜默回 false（無使用者手勢的瀏覽器情境）', () => {
    vi.stubGlobal('navigator', { vibrate: () => { throw new Error('no user gesture') } })
    expect(() => vibrate(20)).not.toThrow()
    expect(vibrate(20)).toBe(false)
  })
})
