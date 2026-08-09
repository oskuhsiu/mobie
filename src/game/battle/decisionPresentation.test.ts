import { describe, expect, it } from 'vitest'
import {
  initiativePresentation,
  moveDecisionPresentation,
} from '@/game/battle/decisionPresentation'
import type { Move } from '@/game/types'

const damageMove = (type: Move['type']): Move => ({
  id: 1,
  name: `${type}-move`,
  nameZh: `${type}招式`,
  type,
  power: 60,
  accuracy: 100,
  category: 'special',
})

describe('battle decision presentation', () => {
  it.each([
    ['fire', ['grass'], '效果絕佳 ×2'],
    ['normal', ['water'], '一般 ×1'],
    ['grass', ['fire'], '效果不佳 ×0.5'],
    ['electric', ['ground'], '無效 ×0'],
  ] as const)('describes %s moves against the active foe', (type, foeTypes, label) => {
    expect(moveDecisionPresentation(damageMove(type), [...foeTypes]).label).toBe(label)
  })

  it('describes a status move by its existing effect instead of damage effectiveness', () => {
    const move: Move = {
      ...damageMove('normal'),
      nameZh: '戰吼',
      power: 0,
      category: 'status',
      effect: { kind: 'buff', stat: 'atk', mult: 1.5, duration: 2, label: '攻擊力上升' },
    }

    expect(moveDecisionPresentation(move, ['ghost']).label).toBe('變化：攻擊力上升')
  })

  it.each([
    [101, 100, '你先攻'],
    [99, 100, '對手先攻'],
    [100, 100, '速度相同，先攻順序不定'],
  ])('describes initiative from the existing speed rule', (playerSpeed, foeSpeed, label) => {
    expect(initiativePresentation(playerSpeed, foeSpeed)).toBe(label)
  })
})
