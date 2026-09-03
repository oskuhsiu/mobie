import { classifyBattleWindow } from './BattleLayout'

describe('classifyBattleWindow', () => {
  it.each([
    [1366, 1024, 'wide-landscape'],
    [1024, 1366, 'tablet-portrait'],
    [1180, 820, 'wide-landscape'],
    [393, 852, 'phone-portrait'],
    [852, 393, 'short-landscape'],
    [899, 601, 'mid-landscape'],
  ] as const)('classifies %s x %s as %s', (width, height, expected) => {
    expect(classifyBattleWindow(width, height)).toBe(expected)
  })

  it('gives short landscape priority over its width class', () => {
    expect(classifyBattleWindow(1180, 600)).toBe('short-landscape')
  })
})
