import { describe, it, expect } from 'vitest'
import type { BattlePokemon, Move, TypeName } from '@/game/types'
import {
  resolveAttack, qteMultiplier, captureChance, attemptCapture, playerActsFirst,
} from './engine'

function move(type: TypeName, power = 50, accuracy = 100): Move {
  return { id: 1, name: 'Test', nameZh: '測試', type, power, accuracy, category: 'physical' }
}

function mon(over: Partial<BattlePokemon> = {}): BattlePokemon {
  return {
    speciesId: 0, name: 'Mon', nameZh: '怪', types: ['normal'], level: 10,
    maxHp: 100, currentHp: 100, atk: 50, def: 50, spa: 50, spd: 50, spe: 50,
    artworkUrl: '', shiny: false,
    ...over,
    move: over.move ?? move('normal'),
  }
}

/** 固定序列 rng，供決定論測試。順序：①命中 ②變異 ③暴擊 */
function seq(...vals: number[]): () => number {
  let i = 0
  return () => vals[Math.min(i++, vals.length - 1)]
}

describe('resolveAttack', () => {
  it('命中時造成正傷害並可能擊倒', () => {
    const atk = mon({ types: ['fire'], move: move('fire', 90), atk: 60, level: 14 })
    const def = mon({ types: ['grass'], def: 40, currentHp: 20, maxHp: 60 })
    const r = resolveAttack(atk, def, { rng: seq(0, 1, 0.99) })
    expect(r.missed).toBe(false)
    expect(r.damage).toBeGreaterThan(0)
    expect(r.defenderFainted).toBe(true)
    expect(r.defenderHpAfter).toBe(0)
  })

  it('STAB（本系加成）使同屬性傷害更高', () => {
    const stabAtk = mon({ types: ['fire'], move: move('fire'), atk: 50 })
    const noStab = mon({ types: ['normal'], move: move('fire'), atk: 50 })
    const def = mon({ types: ['normal'], def: 50, currentHp: 999, maxHp: 999 })
    const withStab = resolveAttack(stabAtk, def, { rng: seq(0, 1, 0.99) }).damage
    const without = resolveAttack(noStab, def, { rng: seq(0, 1, 0.99) }).damage
    expect(withStab).toBeGreaterThan(without)
  })

  it('屬性絕佳傷害 > 普通 > 不太好', () => {
    const atk = mon({ types: ['normal'], move: move('water'), atk: 50 })
    const sup = mon({ types: ['fire'], def: 50, currentHp: 999, maxHp: 999 })
    const neu = mon({ types: ['normal'], def: 50, currentHp: 999, maxHp: 999 })
    const res = mon({ types: ['grass'], def: 50, currentHp: 999, maxHp: 999 })
    const d2 = resolveAttack(atk, sup, { rng: seq(0, 1, 0.99) }).damage
    const d1 = resolveAttack(atk, neu, { rng: seq(0, 1, 0.99) }).damage
    const dh = resolveAttack(atk, res, { rng: seq(0, 1, 0.99) }).damage
    expect(d2).toBeGreaterThan(d1)
    expect(d1).toBeGreaterThan(dh)
  })

  it('免疫屬性造成 0 傷害且不擊倒', () => {
    const atk = mon({ types: ['normal'], move: move('normal') })
    const def = mon({ types: ['ghost'], currentHp: 50, maxHp: 50 })
    const r = resolveAttack(atk, def, { rng: seq(0, 1, 0.99) })
    expect(r.damage).toBe(0)
    expect(r.effectiveness).toBe(0)
    expect(r.effectivenessText).toBe('沒有效果…')
    expect(r.defenderFainted).toBe(false)
  })

  it('命中率不足時 miss（傷害 0）', () => {
    const atk = mon({ types: ['rock'], move: move('rock', 50, 90) })
    const def = mon({ types: ['normal'] })
    // 命中 roll = 0.95 → 95 >= 90 → miss
    const r = resolveAttack(atk, def, { rng: seq(0.95) })
    expect(r.missed).toBe(true)
    expect(r.damage).toBe(0)
  })

  it('命中且有效時至少 1 傷害', () => {
    const atk = mon({ types: ['normal'], move: move('water', 1), atk: 1 })
    const def = mon({ types: ['grass'], def: 999, currentHp: 50, maxHp: 50 }) // 受水抵抗
    const r = resolveAttack(atk, def, { rng: seq(0, 0, 0.99) })
    expect(r.damage).toBeGreaterThanOrEqual(1)
  })

  it('QTE 倍率提高傷害', () => {
    const atk = mon({ types: ['normal'], move: move('normal'), atk: 50 })
    const def = mon({ types: ['normal'], def: 50, currentHp: 999, maxHp: 999 })
    const normal = resolveAttack(atk, def, { rng: seq(0, 1, 0.99), qteMult: 1.0 }).damage
    const perfect = resolveAttack(atk, def, { rng: seq(0, 1, 0.99), qteMult: 1.3 }).damage
    expect(perfect).toBeGreaterThan(normal)
  })

  it('暴擊（rng 落在暴擊區）提高傷害', () => {
    const atk = mon({ types: ['normal'], move: move('normal'), atk: 50 })
    const def = mon({ types: ['normal'], def: 50, currentHp: 999, maxHp: 999 })
    const crit = resolveAttack(atk, def, { rng: seq(0, 1, 0.0) })
    const noCrit = resolveAttack(atk, def, { rng: seq(0, 1, 0.99) })
    expect(crit.crit).toBe(true)
    expect(noCrit.crit).toBe(false)
    expect(crit.damage).toBeGreaterThan(noCrit.damage)
  })
})

describe('qteMultiplier', () => {
  it('品質越好倍率越高', () => {
    expect(qteMultiplier('perfect')).toBeGreaterThan(qteMultiplier('good'))
    expect(qteMultiplier('good')).toBeGreaterThan(qteMultiplier('normal'))
    expect(qteMultiplier('normal')).toBeGreaterThan(qteMultiplier('weak'))
  })
})

describe('playerActsFirst', () => {
  it('速度高者先攻', () => {
    const fast = mon({ move: move('normal'), spe: 90 })
    const slow = mon({ move: move('normal'), spe: 30 })
    expect(playerActsFirst(fast, slow)).toBe(true)
    expect(playerActsFirst(slow, fast)).toBe(false)
  })
})

describe('captureChance / attemptCapture', () => {
  it('機率落在 0.4–0.95 且等級越高越難', () => {
    const low = mon({ move: move('normal'), level: 8 })
    const high = mon({ move: move('normal'), level: 30 })
    expect(captureChance(low)).toBeGreaterThan(captureChance(high))
    expect(captureChance(high)).toBeGreaterThanOrEqual(0.4)
    expect(captureChance(low)).toBeLessThanOrEqual(0.95)
  })
  it('rng 低於機率時捕獲成功', () => {
    const m = mon({ move: move('normal'), level: 10 })
    expect(attemptCapture(m, () => 0)).toBe(true)
    expect(attemptCapture(m, () => 0.999)).toBe(false)
  })
})
