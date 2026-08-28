import type { ReplayInput } from '@/game/replay/types'
import { battleActionFromReplayInput } from './turnInput'

describe('battleActionFromReplayInput', () => {
  it.each([
    { type: 'ATTACK', quality: 'good', mashCount: 4, starStrike: true, slotIndex: 1 },
    { type: 'SWITCH', index: 2, defenseQuality: 'perfect' },
  ] satisfies ReplayInput[])('copies $type directly', (input) => {
    expect(battleActionFromReplayInput(input)).toEqual(input)
  })

  it('maps CHAIN to reducer vocabulary and copies its hits', () => {
    const input: Extract<ReplayInput, { type: 'CHAIN' }> = { type: 'CHAIN', hits: [{ attackerIndex: 1, quality: 'good' }] }
    const action = battleActionFromReplayInput(input)
    expect(action).toEqual({ type: 'SUBMIT_CHAIN_RESULT', hits: input.hits })
    expect(action.type === 'SUBMIT_CHAIN_RESULT' && action.hits).not.toBe(input.hits)
  })
})
