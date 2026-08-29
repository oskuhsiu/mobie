import { describe, expect, it } from 'vitest'
import { normalizedBattleAnchor, projectBattleAnchor } from './battleAnchors'

describe('battle anchor projection', () => {
  it('preserves the legacy normalized impact points across resize', () => {
    expect(normalizedBattleAnchor('player', 'impact')).toEqual({ nx: 0.3, ny: 0.62 })
    expect(normalizedBattleAnchor('foe', 'impact')).toEqual({ nx: 0.72, ny: 0.22 })
    expect(projectBattleAnchor('player', 'impact', { width: 1_000, height: 500 })).toEqual({ x: 300, y: 310 })
    expect(projectBattleAnchor('player', 'impact', { width: 500, height: 1_000 })).toEqual({ x: 150, y: 620 })
  })

  it('projects every generic anchor inside the viewport', () => {
    for (const side of ['player', 'foe'] as const) {
      for (const anchor of ['root', 'center', 'head', 'ground', 'cast', 'impact'] as const) {
        const point = projectBattleAnchor(side, anchor, { width: 777, height: 333 })
        expect(point.x).toBeGreaterThanOrEqual(0)
        expect(point.x).toBeLessThanOrEqual(777)
        expect(point.y).toBeGreaterThanOrEqual(0)
        expect(point.y).toBeLessThanOrEqual(333)
      }
    }
  })
})
