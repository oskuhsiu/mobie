// M22.b 純手勢層單測（plan/22 §5.1）：邊界 / 逾時 / 部分進度 / 決定論。
import { describe, it, expect } from 'vitest'
import {
  swipeFromPointer, swipeThrowValid, circleProgress, sweptAngle, wrapAngle, angleTo,
  holdCharge, beatSchedule, matchTapsToBeats, rhythmAccuracy, rhythmTaps,
  type Pt,
} from '@/input/gestures'

const pt = (x: number, y: number, t: number): Pt => ({ x, y, t })

describe('swipeFromPointer', () => {
  it('少於 2 點＝靜止（零向量）', () => {
    expect(swipeFromPointer([]).speed).toBe(0)
    expect(swipeFromPointer([pt(0.5, 0.5, 0)]).dist).toBe(0)
  })

  it('向上甩：dir=up、速度=dist/dt、單位投擲向量', () => {
    const r = swipeFromPointer([pt(0.5, 0.9, 0), pt(0.5, 0.4, 100)])
    expect(r.dir).toBe('up')
    expect(r.dist).toBeCloseTo(0.5, 5)
    expect(r.speed).toBeCloseTo(0.005, 5) // 0.5 / 100ms
    expect(r.throwVector.y).toBeCloseTo(-1, 5)
    expect(r.throwVector.x).toBeCloseTo(0, 5)
  })

  it('四向判定：水平主導 → left/right', () => {
    expect(swipeFromPointer([pt(0.8, 0.5, 0), pt(0.2, 0.52, 80)]).dir).toBe('left')
    expect(swipeFromPointer([pt(0.2, 0.5, 0), pt(0.8, 0.48, 80)]).dir).toBe('right')
  })

  it('swipeThrowValid：快甩過閾為真、慢移為假；逾時(dt 大→speed 低)→假', () => {
    const fast = swipeFromPointer([pt(0.5, 0.9, 0), pt(0.5, 0.4, 80)])
    expect(swipeThrowValid(fast, 'lite')).toBe(true)
    const slow = swipeFromPointer([pt(0.5, 0.55, 0), pt(0.5, 0.5, 1000)])
    expect(swipeThrowValid(slow, 'lite')).toBe(false)
    // 同樣位移、極長 dt（逾時拖曳）→ 速度不足
    const stale = swipeFromPointer([pt(0.5, 0.9, 0), pt(0.5, 0.4, 5000)])
    expect(swipeThrowValid(stale, 'arcade')).toBe(false)
  })
})

describe('circleProgress / sweptAngle', () => {
  it('wrapAngle 把角度收進 (-π, π]', () => {
    expect(wrapAngle(0)).toBeCloseTo(0, 6)
    expect(wrapAngle(Math.PI)).toBeCloseTo(Math.PI, 6)
    expect(wrapAngle(Math.PI * 1.5)).toBeCloseTo(-Math.PI * 0.5, 6)
    expect(wrapAngle(-Math.PI * 2)).toBeCloseTo(0, 6)
  })

  it('繞圈一週掃掠約 2π；半圈約 π（部分進度）', () => {
    const c = { x: 0.5, y: 0.5 }
    const full: Pt[] = Array.from({ length: 33 }, (_, i) => {
      const a = (i / 32) * 2 * Math.PI
      return pt(0.5 + 0.3 * Math.cos(a), 0.5 + 0.3 * Math.sin(a), i)
    })
    expect(sweptAngle(full, c)).toBeCloseTo(2 * Math.PI, 1)
    const half = full.slice(0, 17)
    expect(sweptAngle(half, c)).toBeCloseTo(Math.PI, 1)
    // 目標 2π：整圈→1、半圈→~0.5（部分進度）
    expect(circleProgress(full, 2 * Math.PI, c)).toBeCloseTo(1, 2)
    expect(circleProgress(half, 2 * Math.PI, c)).toBeGreaterThan(0.45)
    expect(circleProgress(half, 2 * Math.PI, c)).toBeLessThan(0.55)
  })

  it('progress 夾上限 1（畫超過目標不溢出）；少於 2 點＝0', () => {
    const c = { x: 0.5, y: 0.5 }
    const two: Pt[] = Array.from({ length: 65 }, (_, i) => {
      const a = (i / 32) * 2 * Math.PI // 兩整圈
      return pt(0.5 + 0.3 * Math.cos(a), 0.5 + 0.3 * Math.sin(a), i)
    })
    expect(circleProgress(two, 2 * Math.PI, c)).toBe(1)
    expect(circleProgress([pt(0.5, 0.5, 0)], 2 * Math.PI, c)).toBe(0)
  })

  it('決定論：同輸入同輸出', () => {
    const c = { x: 0.5, y: 0.5 }
    const s: Pt[] = Array.from({ length: 12 }, (_, i) => pt(0.5 + 0.3 * Math.cos(i), 0.5 + 0.3 * Math.sin(i), i))
    expect(circleProgress(s, Math.PI * 4, c)).toBe(circleProgress(s, Math.PI * 4, c))
    expect(angleTo(c, pt(0.8, 0.5, 0))).toBeCloseTo(0, 6)
  })
})

describe('holdCharge', () => {
  it('0 起、過半、填滿、夾上限', () => {
    expect(holdCharge(0, 'lite')).toBe(0)
    expect(holdCharge(425, 'lite')).toBeCloseTo(0.5, 1) // lite holdChargeMs=850
    expect(holdCharge(850, 'lite')).toBe(1)
    expect(holdCharge(99999, 'lite')).toBe(1) // 不溢出
  })

  it('arcade 蓄力較久（同時間進度較低）＝強度更高', () => {
    expect(holdCharge(600, 'arcade')).toBeLessThan(holdCharge(600, 'lite'))
  })

  it('off 退回 lite 強度、不崩', () => {
    expect(holdCharge(850, 'off')).toBe(1)
  })
})

describe('rhythmTaps（太鼓式）', () => {
  it('beatSchedule：等距 N 拍', () => {
    expect(beatSchedule(1000, 'lite')).toEqual([1000]) // lite 1 拍
    const arc = beatSchedule(0, 'arcade') // arcade 3 拍 interval 520
    expect(arc).toHaveLength(3)
    expect(arc[1] - arc[0]).toBe(520)
  })

  it('matchTapsToBeats：每 tap 至多配一拍、缺拍記 window', () => {
    const offs = matchTapsToBeats([100, 700], [100, 700, 1300], 200)
    expect(offs[0]).toBe(0)
    expect(offs[1]).toBe(0)
    expect(offs[2]).toBe(200) // 第 3 拍無 tap → 滿窗（0 分）
  })

  it('rhythmAccuracy：完美→1、半窗誤差→0.5、空→0', () => {
    expect(rhythmAccuracy([0, 0], 200)).toBe(1)
    expect(rhythmAccuracy([100, 100], 200)).toBeCloseTo(0.5, 6)
    expect(rhythmAccuracy([], 200)).toBe(0)
  })

  it('rhythmTaps：精準命中 beat → 高分；全失準/逾時 → 0', () => {
    const beats = beatSchedule(0, 'arcade')
    expect(rhythmTaps(beats, beats, 'arcade')).toBe(1) // tap 落在每拍正中
    // 全部 tap 在窗外（遠晚＝逾時）→ 0 分，但仍回有限數（不崩）
    expect(rhythmTaps([9000, 9001, 9002], beats, 'arcade')).toBe(0)
    // 沒按任何 tap（取消）→ 0
    expect(rhythmTaps([], beats, 'arcade')).toBe(0)
  })
})

// ── M22.f/g/h/i 新增純helpers ────────────────────────────────────────────────
import { rhythmToMashCount, swipeShieldQuality, pathLength, frictionProgress, MASH_COUNT_CAP } from '@/input/gestures'

describe('rhythmToMashCount（M22.g）', () => {
  it('accuracy 0→0、1→CAP、夾邊界', () => {
    expect(rhythmToMashCount(0)).toBe(0)
    expect(rhythmToMashCount(1)).toBe(MASH_COUNT_CAP)
    expect(rhythmToMashCount(0.5)).toBe(Math.round(MASH_COUNT_CAP * 0.5))
    expect(rhythmToMashCount(2)).toBe(MASH_COUNT_CAP) // 夾上限
    expect(rhythmToMashCount(-1)).toBe(0) // 夾下限
  })
})

describe('swipeShieldQuality（M22.f）', () => {
  const down = (speedMul: number): Pt[] => {
    // 由上往下的快滑：dy>0；速度＝dist/dt
    return [pt(0.5, 0.2, 0), pt(0.5, 0.2 + 0.4, 0.4 / (0.0008 * speedMul))]
  }
  it('無效甩動→weak', () => {
    expect(swipeShieldQuality(swipeFromPointer([pt(0.5, 0.5, 0), pt(0.5, 0.51, 1000)]), 'lite')).toBe('weak')
  })
  it('向下快滑依速度給 good/perfect', () => {
    const r = swipeFromPointer(down(3))
    expect(r.dir).toBe('down')
    expect(['good', 'perfect']).toContain(swipeShieldQuality(r, 'lite'))
  })
})

describe('pathLength / frictionProgress（M22.h/i）', () => {
  it('pathLength 累加折線段長', () => {
    expect(pathLength([pt(0, 0, 0), pt(0, 1, 1), pt(1, 1, 2)])).toBeCloseTo(2, 5)
    expect(pathLength([pt(0, 0, 0)])).toBe(0)
  })
  it('frictionProgress 夾 0..1、target<=0→1', () => {
    const back = [pt(0, 0, 0), pt(1, 0, 1), pt(0, 0, 2)] // 來回 = 長度 2
    expect(frictionProgress(back, 4)).toBeCloseTo(0.5, 5)
    expect(frictionProgress(back, 1)).toBe(1) // 超過夾 1
    expect(frictionProgress(back, 0)).toBe(1)
  })
})
