import { describe, expect, it } from 'vitest'
import { mon } from '@/game/battle/testFixtures'
import {
  SWITCH_CONSEQUENCE,
  mobCardDisabledReason,
  resourceActionState,
  switchAvailability,
} from './BattleActionModel'

describe('battle action projection', () => {
  it('returns only legal switch targets and a truthful disabled reason', () => {
    const members = [
      mon({ nameZh: '出戰者' }),
      mon({ nameZh: '倒下者', currentHp: 0 }),
      mon({ nameZh: '可換者' }),
    ]

    expect(switchAvailability(members, 0, null)).toEqual({
      consequence: SWITCH_CONSEQUENCE,
      legalIndices: [2],
      disabledReason: null,
    })
    expect(switchAvailability(members, 0, 2)).toEqual({
      consequence: SWITCH_CONSEQUENCE,
      legalIndices: [],
      disabledReason: '剛換下的夥伴本回合不能立刻換回',
    })
    expect(switchAvailability([members[0], members[1]], 0, null).disabledReason)
      .toBe('沒有可換上的夥伴')
  })

  it.each([
    [{ current: 38, max: 100, activating: false }, 'charging'],
    [{ current: 100, max: 100, activating: false }, 'ready'],
    [{ current: 0, max: 100, activating: true }, 'activating'],
    [{ current: 0, max: 100, activating: false }, 'charging'],
  ] as const)('projects resource state %o as %s', (input, expected) => {
    expect(resourceActionState(input)).toBe(expected)
  })

  it('allows MobCard only during player choice', () => {
    expect(mobCardDisabledReason('playerChoice')).toBeNull()
    expect(mobCardDisabledReason('qte')).toBe('戰鬥輸入進行中')
    expect(mobCardDisabledReason('busy')).toBe('正在結算回合')
  })
})
