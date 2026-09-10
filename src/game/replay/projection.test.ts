import { describe, expect, it } from 'vitest'
import { flattenReplay, projectReplay, clampReplayCursor } from './projection'
import type { ReplayLog } from './types'

const LOG: ReplayLog = {
  header: {
    formatVersion: 2,
    battleId: 'projection-1',
    battleSeed: 'seed',
    createdAt: 1,
    regionId: 'practice',
    mode: 'arena',
    outcome: 'win',
    snapshot: [
      { instanceId: 'player:0', side: 'player', slot: 0, speciesId: 1, displayName: '我方一', level: 10, maxHp: 40, initialHp: 40, shiny: false },
      { instanceId: 'player:1', side: 'player', slot: 1, speciesId: 4, displayName: '我方二', level: 10, maxHp: 30, initialHp: 30, shiny: false },
      { instanceId: 'foe:0', side: 'foe', slot: 0, speciesId: 7, displayName: '對手一', level: 10, maxHp: 50, initialHp: 50, shiny: false },
      { instanceId: 'foe:1', side: 'foe', slot: 1, speciesId: 25, displayName: '對手二', level: 10, maxHp: 25, initialHp: 25, shiny: false },
    ],
  },
  turns: [
    {
      input: { type: 'ATTACK' },
      events: [
        { type: 'damageApplied', attackerSide: 'player', attackerIndex: 0, targetSide: 'foe', targetIndex: 0, amount: 20, missed: false, crit: false, effectiveness: 1, effectivenessText: null, hpBefore: 50, hpAfter: 30, maxHp: 50 },
        { type: 'statusApplied', side: 'player', index: 0, moveId: 2000, effectKind: 'buff', label: '攻擊大幅提升', remaining: 4 },
        { type: 'wildAccident', kind: 'terrainShift', terrainId: 'rain' },
        { type: 'chainOpportunity', maxHits: 2, eligibleIndices: [0, 1] },
      ],
    },
    {
      input: { type: 'CHAIN', hits: [{ attackerIndex: 0, quality: 'good' }] },
      events: [
        { type: 'chainHit', comboCount: 1, attackerIndex: 0 },
        { type: 'activeChanged', side: 'foe', fromIndex: 0, toIndex: 1, forced: true },
        { type: 'memberFainted', side: 'foe', index: 0 },
        { type: 'comboCast', key: 'frost-veil', name: '霜霰護幕', icon: '❄️', castKind: 'teamBuff', label: '全隊防禦提升', remaining: 3 },
        { type: 'battleEnded', winner: 'player' },
      ],
    },
  ],
}

describe('replay projection', () => {
  it('folds the decoded event prefix into HP, active, field, chain, status and outcome', () => {
    const steps = flattenReplay(LOG)
    const afterFirstTurn = projectReplay(LOG, 4)
    expect(steps).toHaveLength(9)
    expect(afterFirstTurn.cursor).toBe(4)
    expect(afterFirstTurn.currentTurn).toBe(0)
    expect(afterFirstTurn.units.get('foe:0')?.hp).toBe(30)
    expect(afterFirstTurn.active.foe).toBe(0)
    expect(afterFirstTurn.field.terrainIds).toEqual(['rain'])
    expect(afterFirstTurn.field.terrainKnown).toBe(true)
    expect(afterFirstTurn.field.chainCount).toBe(0)
    expect(afterFirstTurn.field.chainMax).toBe(2)
    expect(afterFirstTurn.field.teamStatuses[0]).toMatchObject({ stat: 'atk', remaining: 3 })

    const complete = projectReplay(LOG, 999)
    expect(complete.cursor).toBe(steps.length)
    expect(complete.units.get('foe:0')?.fainted).toBe(true)
    expect(complete.active.foe).toBe(1)
    expect(complete.field.chainCount).toBe(1)
    expect(complete.field.teamStatuses[1]).toMatchObject({ stat: 'def', remaining: 2 })
    expect(complete.outcome).toBe('player')

    const withEmptyTurn: ReplayLog = { ...LOG, turns: [LOG.turns[0], { input: { type: 'ATTACK' }, events: [] }, LOG.turns[1]] }
    const emptyTurnComplete = projectReplay(withEmptyTurn, 999)
    expect(emptyTurnComplete.field.teamStatuses[0]).toMatchObject({ stat: 'atk', remaining: 1 })
    expect(emptyTurnComplete.field.teamStatuses[1]).toMatchObject({ stat: 'def', remaining: 2 })
  })

  it('clamps cursor operations and reports missing initial field data honestly', () => {
    expect(clampReplayCursor(-2, 4)).toBe(0)
    expect(clampReplayCursor(2.8, 4)).toBe(2)
    expect(clampReplayCursor(99, 4)).toBe(4)
    const start = projectReplay(LOG, 0)
    expect(start.field.terrainKnown).toBe(false)
    expect(start.degraded.some((message) => message.includes('開場地形未記錄'))).toBe(true)
    expect(start.outcome).toBeNull()
  })

  it('marks optional event payloads as degraded instead of silently dropping their projection', () => {
    const log: ReplayLog = {
      ...LOG,
      turns: [{
        input: { type: 'ATTACK' },
        events: [
          { type: 'statusApplied', side: 'player', index: 0, moveId: 2003, effectKind: 'heal', label: '回復體力', remaining: 0 },
          { type: 'wildAccident', kind: 'intrusion', side: 'foe', index: 0, amount: 3 },
        ],
      }],
    }
    const projection = projectReplay(log, 2)
    expect(projection.degraded).toEqual(expect.arrayContaining([
      '回血事件缺少 hpAfter，HP 顯示可能不完整',
      '亂入事件缺少受擊方或 hpAfter，HP 顯示可能不完整',
    ]))

    const badHp = projectReplay({
      ...LOG,
      turns: [{
        input: { type: 'ATTACK' },
        events: [{ type: 'statusApplied', side: 'player', index: 0, moveId: 2000, effectKind: 'buff', label: '錯誤 HP', remaining: 3, hpAfter: 1 }],
      }],
    }, 1)
    expect(badHp.units.get('player:0')?.hp).toBe(40)
  })
})
