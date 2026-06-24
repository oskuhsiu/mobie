// M19.d 變化招（status moves）reducer 測試（plan/17 §1.3）。
// 守住的不變式：①變化招無傷害（不 emit damageApplied）②QTE 只影響強度不影響成敗
// ③強度硬上限（同 stat 不疊乘爆表）④buff 寫 fieldState 暫態、回合末遞減過期
// ⑤防守 buff 減傷⑥連鎖：變化招不斷鏈、貢獻減半支援值。
import { describe, it, expect } from 'vitest'
import type { Move, MoveEffect, TypeName } from '@/game/types'
import { createBattleState, resolveTurn, type StatusEffect } from './reducer'
import { CHAIN_MODULE } from '@/game/ext/chain'
import { mon } from './testFixtures'
import { hashSeed } from '@/game/individual'

function atk(id: number, type: TypeName, power = 70): Move {
  return { id, name: `M${id}`, nameZh: `招${id}`, type, power, accuracy: 100, category: 'physical' }
}
function status(id: number, effect: MoveEffect, type: TypeName = 'normal'): Move {
  return { id, name: `S${id}`, nameZh: `變${id}`, type, power: 0, accuracy: 100, category: 'status', effect }
}
function rngFrom(seed: string): () => number {
  let s = hashSeed(seed)
  return () => {
    s |= 0; s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const ATK_BUFF = status(2000, { kind: 'buff', stat: 'atk', mult: 1.5, duration: 4, label: '攻擊提升' })
const HEAL = status(2003, { kind: 'heal', healFrac: 0.4, label: '回復' })
const TERRAIN = status(2004, { kind: 'terrain', terrainId: 'grassland', label: '青草場地' }, 'grass')
const STRIKE = atk(2100, 'normal', 80)

// 高 HP、低攻、慢速的對手：不干擾玩家行動觀測（玩家先手、對手打不死玩家）。
const dummyFoe = () => mon({ moves: [atk(2200, 'water', 10)], types: ['water'], maxHp: 9999, currentHp: 9999, atk: 1, spa: 1, spe: 1 })
const fastPlayer = (moves: Move[], over = {}) => mon({ moves, types: ['normal'], spe: 200, maxHp: 300, ...over })

describe('M19.d 變化招', () => {
  it('攻擊向 buff 寫進 teamStatuses + 發 statusApplied、且玩家無 damageApplied', () => {
    const state = createBattleState([fastPlayer([STRIKE, ATK_BUFF])], [dummyFoe()])
    const { nextState, events } = resolveTurn(state, { type: 'ATTACK', slotIndex: 1, quality: 'normal' }, { rng: rngFrom('a') })
    const playerDmg = events.find((e) => e.type === 'damageApplied' && e.attackerSide === 'player')
    expect(playerDmg).toBeUndefined() // 變化招不造成傷害
    const applied = events.find((e) => e.type === 'statusApplied')
    expect(applied && applied.type === 'statusApplied' && applied.effectKind).toBe('buff')
    expect(nextState.field.teamStatuses.some((s) => s.stat === 'atk' && s.mult === 1.5)).toBe(true)
  })

  it('攻擊向 buff 真的提升傷害（同 rng 對照，folded into damageMult）', () => {
    const base = createBattleState([fastPlayer([STRIKE])], [dummyFoe()])
    const d0 = resolveTurn(base, { type: 'ATTACK', slotIndex: 0, quality: 'normal' }, { rng: rngFrom('z') })
      .events.find((e) => e.type === 'damageApplied' && e.attackerSide === 'player')
    const buffed = createBattleState([fastPlayer([STRIKE])], [dummyFoe()])
    buffed.field.teamStatuses = [{ stat: 'atk', mult: 1.5, remaining: 3, source: 2000, label: 'x' }]
    const d1 = resolveTurn(buffed, { type: 'ATTACK', slotIndex: 0, quality: 'normal' }, { rng: rngFrom('z') })
      .events.find((e) => e.type === 'damageApplied' && e.attackerSide === 'player')
    expect(d0 && d0.type === 'damageApplied' && d1 && d1.type === 'damageApplied').toBeTruthy()
    if (d0?.type === 'damageApplied' && d1?.type === 'damageApplied') expect(d1.amount).toBeGreaterThan(d0.amount)
  })

  it('防守向 buff 減少受到的傷害（對手 def buff → 玩家打更少）', () => {
    const plain = createBattleState([fastPlayer([STRIKE])], [dummyFoe()])
    const d0 = resolveTurn(plain, { type: 'ATTACK', slotIndex: 0, quality: 'normal' }, { rng: rngFrom('q') })
      .events.find((e) => e.type === 'damageApplied' && e.attackerSide === 'player')
    const guarded = createBattleState([fastPlayer([STRIKE])], [dummyFoe()])
    guarded.field.enemyStatuses = [{ stat: 'def', mult: 1.5, remaining: 3, source: 2001, label: 'x' }]
    const d1 = resolveTurn(guarded, { type: 'ATTACK', slotIndex: 0, quality: 'normal' }, { rng: rngFrom('q') })
      .events.find((e) => e.type === 'damageApplied' && e.attackerSide === 'player')
    if (d0?.type === 'damageApplied' && d1?.type === 'damageApplied') expect(d1.amount).toBeLessThan(d0.amount)
  })

  it('QTE 只影響回合數不影響成敗：perfect 比 weak 持續更久（兩者都生效）', () => {
    const mk = (q: 'perfect' | 'weak') => {
      const s = createBattleState([fastPlayer([STRIKE, ATK_BUFF])], [dummyFoe()])
      return resolveTurn(s, { type: 'ATTACK', slotIndex: 1, quality: q }, { rng: rngFrom('b') }).nextState
    }
    const perfect = mk('perfect').field.teamStatuses.find((s) => s.stat === 'atk') as StatusEffect
    const weak = mk('weak').field.teamStatuses.find((s) => s.stat === 'atk') as StatusEffect
    expect(perfect).toBeDefined()
    expect(weak).toBeDefined() // weak 仍成功施放（不變廢回合）
    expect(perfect.remaining).toBeGreaterThan(weak.remaining)
  })

  it('硬上限：同 stat 重複施放不疊乘（mult 維持 1.5、刷新回合）', () => {
    let s = createBattleState([fastPlayer([STRIKE, ATK_BUFF])], [dummyFoe()])
    s = resolveTurn(s, { type: 'ATTACK', slotIndex: 1, quality: 'normal' }, { rng: rngFrom('c1') }).nextState
    s = resolveTurn(s, { type: 'ATTACK', slotIndex: 1, quality: 'normal' }, { rng: rngFrom('c2') }).nextState
    const atkBuffs = s.field.teamStatuses.filter((x) => x.stat === 'atk')
    expect(atkBuffs.length).toBe(1) // 不重複堆疊
    expect(atkBuffs[0].mult).toBe(1.5) // 不超過硬上限
  })

  it('buff 回合末遞減、到期移除', () => {
    // weak → duration 4-1=3；跑 3 個回合後應移除（3→2→1→0 移除）
    let s = createBattleState([fastPlayer([STRIKE, ATK_BUFF])], [dummyFoe()])
    s = resolveTurn(s, { type: 'ATTACK', slotIndex: 1, quality: 'weak' }, { rng: rngFrom('d0') }).nextState
    const start = s.field.teamStatuses.find((x) => x.stat === 'atk')!.remaining
    for (let i = 0; i < start; i++) {
      s = resolveTurn(s, { type: 'ATTACK', slotIndex: 0, quality: 'normal' }, { rng: rngFrom(`d${i}`) }).nextState
    }
    expect(s.field.teamStatuses.some((x) => x.stat === 'atk')).toBe(false)
  })

  it('heal：回復 HP + statusApplied(heal) 帶 healAmount，不溢出 maxHp', () => {
    const wounded = fastPlayer([STRIKE, HEAL], { maxHp: 300, currentHp: 100 })
    const state = createBattleState([wounded], [dummyFoe()])
    const { nextState, events } = resolveTurn(state, { type: 'ATTACK', slotIndex: 1, quality: 'normal' }, { rng: rngFrom('h') })
    const heal = events.find((e) => e.type === 'statusApplied' && e.effectKind === 'heal')
    expect(heal && heal.type === 'statusApplied' && (heal.healAmount ?? 0)).toBeGreaterThan(0)
    expect(nextState.player.members[0].currentHp).toBeGreaterThan(100)
    expect(nextState.player.members[0].currentHp).toBeLessThanOrEqual(300)
  })

  it('terrain：設定 field.terrainEffects.current + statusApplied(terrain)', () => {
    const state = createBattleState([fastPlayer([STRIKE, TERRAIN])], [dummyFoe()])
    const { nextState, events } = resolveTurn(state, { type: 'ATTACK', slotIndex: 1, quality: 'normal' }, { rng: rngFrom('t') })
    expect(nextState.field.terrainEffects.current).toEqual(['grassland'])
    expect(events.some((e) => e.type === 'statusApplied' && e.effectKind === 'terrain')).toBe(true)
  })

  it('連鎖：變化招不斷鏈、貢獻減半支援值（chainGauge 推進但少於攻擊招）', () => {
    const ext = { damageHooks: [], turnEndTriggers: [], chain: CHAIN_MODULE.seams.chainResolve }
    const sAtk = createBattleState([fastPlayer([STRIKE, ATK_BUFF])], [dummyFoe()])
    const gAtk = resolveTurn(sAtk, { type: 'ATTACK', slotIndex: 0, quality: 'normal' }, { rng: rngFrom('e'), ext }).nextState.chainGauge
    const sStatus = createBattleState([fastPlayer([STRIKE, ATK_BUFF])], [dummyFoe()])
    const gStatus = resolveTurn(sStatus, { type: 'ATTACK', slotIndex: 1, quality: 'normal' }, { rng: rngFrom('e'), ext }).nextState.chainGauge
    expect(gStatus).toBeGreaterThan(0) // 變化招仍推進連鎖（支援值）
    expect(gStatus).toBeLessThan(gAtk) // 但少於攻擊招
  })
})
