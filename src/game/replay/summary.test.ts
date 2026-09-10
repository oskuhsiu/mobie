import { describe, expect, it } from 'vitest'
import { formatReplayDuration, summarizeReplay } from './summary'
import type { ReplayLog } from './types'

const LOG: ReplayLog = {
  header: {
    formatVersion: 2,
    battleId: 'summary',
    battleSeed: 'seed',
    createdAt: 1,
    durationMs: 91_400,
    regionId: 'practice',
    mode: 'arena',
    outcome: 'lose',
    snapshot: [
      { instanceId: 'player:0', side: 'player', slot: 0, speciesId: 1, displayName: '妙蛙種子', level: 5, maxHp: 20, initialHp: 20, shiny: false },
      { instanceId: 'foe:0', side: 'foe', slot: 0, speciesId: 4, displayName: '小火龍', level: 5, maxHp: 20, initialHp: 20, shiny: false },
    ],
  },
  turns: [
    { input: { type: 'ATTACK' }, events: [{ type: 'battleEnded', winner: 'foe' }] },
    { input: { type: 'ATTACK' }, events: [] },
  ],
}

describe('replay summary', () => {
  it('derives participants, turn/event counts, and duration from canonical log', () => {
    expect(summarizeReplay(LOG)).toEqual({
      turnCount: 2,
      eventCount: 1,
      durationMs: 91_400,
      participants: 2,
      players: ['妙蛙種子'],
      foes: ['小火龍'],
    })
  })

  it('formats recorded and legacy durations safely', () => {
    expect(formatReplayDuration(91_400)).toBe('1:31')
    expect(formatReplayDuration(null)).toBe('時間未記錄')
  })
})
