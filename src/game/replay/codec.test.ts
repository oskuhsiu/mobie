import { describe, it, expect } from 'vitest'
import { encodeReplay, decodeReplay } from './codec'
import { REPLAY_FORMAT_VERSION, type ReplayLog } from './types'

function sampleLog(): ReplayLog {
  return {
    header: {
      formatVersion: REPLAY_FORMAT_VERSION,
      battleId: 'b1',
      battleSeed: 'seed-xyz',
      createdAt: 1_700_000_000_000,
      regionId: 'grassland',
      mode: 'wild',
      outcome: 'win',
      snapshot: [
        { instanceId: 'player:0', side: 'player', slot: 0, speciesId: 1, displayName: '妙蛙種子', level: 12, maxHp: 40, initialHp: 40, shiny: false },
        { instanceId: 'foe:0', side: 'foe', slot: 0, speciesId: 4, displayName: '小火龍', level: 11, maxHp: 36, initialHp: 36, shiny: false },
      ],
    },
    turns: [
      {
        input: { type: 'ATTACK', quality: 'good', slotIndex: 1 },
        events: [
          { type: 'random', event: { type: 'accuracy', actorId: 'player:0', roll: 0.4, outcome: 'hit', source: 'p' } },
          { type: 'damageApplied', attackerSide: 'player', attackerIndex: 0, targetSide: 'foe', targetIndex: 0, amount: 18, missed: false, crit: false, effectiveness: 2, effectivenessText: '效果絕佳', hpBefore: 36, hpAfter: 18, maxHp: 36, resolvedMoveId: 22 },
        ],
      },
      {
        input: { type: 'ATTACK', starStrike: true },
        events: [
          { type: 'damageApplied', attackerSide: 'player', attackerIndex: 0, targetSide: 'foe', targetIndex: 0, amount: 18, missed: false, crit: true, effectiveness: 1, effectivenessText: null, hpBefore: 18, hpAfter: 0, maxHp: 36 },
          { type: 'memberFainted', side: 'foe', index: 0 },
          { type: 'battleEnded', winner: 'player' },
        ],
      },
    ],
  }
}

describe('replay codec — round-trip', () => {
  it('encode → decode 還原相同 log', () => {
    const log = sampleLog()
    const res = decodeReplay(encodeReplay(log))
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.log.header.battleId).toBe('b1')
      expect(res.log.turns).toEqual(log.turns)
    }
  })

  it('encode 穩定鍵序：同 log 兩次序列化字串相同', () => {
    const log = sampleLog()
    expect(encodeReplay(log)).toBe(encodeReplay(log))
  })

  it('encode 寫入 turns checksum', () => {
    const txt = encodeReplay(sampleLog())
    const parsed = JSON.parse(txt)
    expect(typeof parsed.header.checksum).toBe('string')
    expect(parsed.header.checksum).toHaveLength(8)
  })
})

describe('replay codec — 分類錯誤', () => {
  it('not-json：非 JSON 字串', () => {
    const res = decodeReplay('not a json {')
    expect(res).toMatchObject({ ok: false, error: 'not-json' })
  })

  it('bad-shape：缺 turns', () => {
    const res = decodeReplay(JSON.stringify({ header: sampleLog().header }))
    expect(res).toMatchObject({ ok: false, error: 'bad-shape' })
  })

  it('version-too-new：formatVersion 比本版新', () => {
    const log = sampleLog()
    const txt = encodeReplay(log)
    const obj = JSON.parse(txt)
    obj.header.formatVersion = REPLAY_FORMAT_VERSION + 1
    const res = decodeReplay(JSON.stringify(obj))
    expect(res).toMatchObject({ ok: false, error: 'version-too-new' })
  })

  it('unknown-event：含未知 event variant', () => {
    const obj = JSON.parse(encodeReplay(sampleLog()))
    obj.turns[0].events.push({ type: 'comboCast', foo: 1 })
    const res = decodeReplay(JSON.stringify(obj))
    expect(res).toMatchObject({ ok: false, error: 'unknown-event' })
  })

  it('bad-checksum：竄改 turns 後 checksum 不符', () => {
    const obj = JSON.parse(encodeReplay(sampleLog()))
    obj.turns[0].events[1].amount = 999 // 改傷害但不重算 checksum
    const res = decodeReplay(JSON.stringify(obj))
    expect(res).toMatchObject({ ok: false, error: 'bad-checksum' })
  })
})
