import { describe, it, expect } from 'vitest'
import { hashSeed, mulberry32, makeRng } from './rng'
import { createBattleState, resolveTurn, type BattleEvent } from './battle/reducer'
import { move, mon } from './battle/testFixtures'

describe('rng — 純函式決定論', () => {
  it('hashSeed 同字串同雜湊、不同字串多半不同', () => {
    expect(hashSeed('abc')).toBe(hashSeed('abc'))
    expect(hashSeed('abc')).not.toBe(hashSeed('abd'))
    expect(hashSeed('')).toBe(2166136261 >>> 0)
  })

  it('mulberry32 同 seed 同序列、輸出落在 [0,1)', () => {
    const a = mulberry32(123)
    const b = mulberry32(123)
    const seqA = [a(), a(), a(), a()]
    const seqB = [b(), b(), b(), b()]
    expect(seqA).toEqual(seqB)
    for (const v of seqA) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('makeRng = hashSeed → mulberry32（同 seed 字串同序列）', () => {
    const r1 = makeRng('battle-x')
    const r2 = mulberry32(hashSeed('battle-x'))
    expect([r1(), r1(), r1()]).toEqual([r2(), r2(), r2()])
  })
})

describe('rng — resolveTurn 重模擬決定論（回放地基）', () => {
  // 同一場開場狀態 + 同 seed + 同輸入序列 → 同事件流。
  const STRONG = { atk: 70, move: move('normal', 80), spe: 60 }
  const WEAK = { atk: 30, move: move('normal', 40), spe: 40 }

  function runBattle(seed: string): BattleEvent[] {
    const rng = makeRng(seed)
    let state = createBattleState(
      [mon(STRONG), mon(STRONG), mon(STRONG)],
      [mon(WEAK), mon(WEAK), mon(WEAK)],
    )
    const all: BattleEvent[] = []
    for (let i = 0; i < 8 && !state.winner; i++) {
      const { nextState, events } = resolveTurn(state, { type: 'ATTACK', quality: 'good' }, { rng })
      state = nextState
      all.push(...events)
    }
    return all
  }

  it('同 seed 兩次重跑事件流完全相同', () => {
    expect(runBattle('seed-A')).toEqual(runBattle('seed-A'))
  })

  it('不同 seed 多半產生不同事件流（rng 確實驅動）', () => {
    const a = JSON.stringify(runBattle('seed-A'))
    const b = JSON.stringify(runBattle('seed-B'))
    expect(a).not.toBe(b)
  })
})
