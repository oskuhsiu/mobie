import { describe, it, expect } from 'vitest'
import { normalizeFromBox } from './normalize'

describe('normalizeFromBox', () => {
  it('縮放到指定高度', () => {
    const { scale } = normalizeFromBox({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 4, z: 1 } }, 2)
    expect(scale).toBeCloseTo(0.5)
  })

  it('位移後腳底落在 y=0、x/z 置中', () => {
    // 一個高 2、中心在 (10, 1, -10) 的盒
    const { scale, offset } = normalizeFromBox(
      { min: { x: 9, y: 0, z: -11 }, max: { x: 11, y: 2, z: -9 } },
      2,
    )
    expect(scale).toBeCloseTo(1)
    // 縮放後套 offset：min.y 應到 0、中心 x/z 應到 0
    const newMinY = 0 * scale + offset[1]
    const newCx = 10 * scale + offset[0]
    const newCz = -10 * scale + offset[2]
    expect(newMinY).toBeCloseTo(0)
    expect(newCx).toBeCloseTo(0)
    expect(newCz).toBeCloseTo(0)
  })

  it('高瘦模型也統一到同一高度', () => {
    const short = normalizeFromBox({ min: { x: 0, y: 0, z: 0 }, max: { x: 3, y: 1, z: 3 } }, 2)
    const tall = normalizeFromBox({ min: { x: 0, y: 0, z: 0 }, max: { x: 1, y: 8, z: 1 } }, 2)
    expect(short.scale).toBeCloseTo(2)
    expect(tall.scale).toBeCloseTo(0.25)
  })

  it('退化盒（高度 0）不爆掉，scale 退回 1', () => {
    const { scale, offset } = normalizeFromBox({ min: { x: 0, y: 5, z: 0 }, max: { x: 0, y: 5, z: 0 } })
    expect(scale).toBe(1)
    expect(offset[1]).toBeCloseTo(-5)
  })
})
