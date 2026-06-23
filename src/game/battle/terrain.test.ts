import { describe, it, expect } from 'vitest'
import { createBattleState, resolveTurn, type BattleEvent, type Side } from './reducer'
import { resolveAttack } from './engine'
import { resolveTerrainMult } from '@/game/data/terrains'
import { move, mon } from './testFixtures'

/** 定值 rng：0.5 → 必命中、無暴擊、變異 0.925；速度不同時不消耗 rng、turn=1 不觸發支援輪盤 */
const RNG = () => 0.5

const playerDamage = (events: BattleEvent[]): number => {
  const e = events.find((x) => x.type === 'damageApplied' && (x as { attackerSide: Side }).attackerSide === 'player')
  return e ? (e as { amount: number }).amount : -1
}

describe('engine.resolveAttack — terrainMult', () => {
  it('terrainMult 在屬性相剋後乘，等比放大傷害', () => {
    const atk = mon({ types: ['grass'], move: move('grass', 80), atk: 80 })
    const def = mon({ types: ['normal'], maxHp: 9999 })
    const base = resolveAttack(atk, def, { rng: RNG }).damage
    const boosted = resolveAttack(atk, def, { rng: RNG, terrainMult: 1.3 }).damage
    expect(boosted).toBeGreaterThan(base)
    expect(boosted / base).toBeCloseTo(1.3, 1)
  })
  it('terrainMult 預設 1＝行為不變', () => {
    const atk = mon({ move: move('normal', 60) })
    const def = mon({ maxHp: 9999 })
    expect(resolveAttack(atk, def, { rng: RNG }).damage)
      .toBe(resolveAttack(atk, def, { rng: RNG, terrainMult: 1 }).damage)
  })
})

describe('resolveTurn — 地形注入', () => {
  const players = () => [mon({ types: ['grass'], move: move('grass', 80), atk: 80, spe: 100 })]
  const foes = () => [mon({ types: ['normal'], maxHp: 9999, spe: 10, move: move('normal', 1) })]

  it('增益地形（grassland: grass×1.3）放大同屬攻擊傷害', () => {
    const withT = resolveTurn(createBattleState(players(), foes(), ['grassland']),
      { type: 'ATTACK' }, { rng: RNG, terrainMultiplier: resolveTerrainMult })
    const without = resolveTurn(createBattleState(players(), foes()),
      { type: 'ATTACK' }, { rng: RNG, terrainMultiplier: resolveTerrainMult })
    expect(playerDamage(withT.events)).toBeGreaterThan(playerDamage(without.events))
    expect(playerDamage(withT.events) / playerDamage(without.events)).toBeGreaterThan(1.2)
  })

  it('減益地形（grassland: fire×0.8）降低 fire 攻擊傷害', () => {
    const fireP = () => [mon({ types: ['fire'], move: move('fire', 80), atk: 80, spe: 100 })]
    const withT = resolveTurn(createBattleState(fireP(), foes(), ['grassland']),
      { type: 'ATTACK' }, { rng: RNG, terrainMultiplier: resolveTerrainMult })
    const without = resolveTurn(createBattleState(fireP(), foes()),
      { type: 'ATTACK' }, { rng: RNG, terrainMultiplier: resolveTerrainMult })
    expect(playerDamage(withT.events)).toBeLessThan(playerDamage(without.events))
  })

  it('未注入 terrainMultiplier＝無地形＝行為等同 M1.x', () => {
    const injected = resolveTurn(createBattleState(players(), foes()),
      { type: 'ATTACK' }, { rng: RNG, terrainMultiplier: resolveTerrainMult })
    const legacy = resolveTurn(createBattleState(players(), foes()),
      { type: 'ATTACK' }, { rng: RNG })
    expect(playerDamage(injected.events)).toBe(playerDamage(legacy.events))
  })

  it('讀的是 current 不是 initial（模擬 M11 地形突變）', () => {
    // initial=grassland(fire×0.8)、current=volcanic(fire×1.4)：fire 攻擊應採 current
    const s = createBattleState(
      [mon({ types: ['fire'], move: move('fire', 80), atk: 80, spe: 100 })],
      foes(), ['grassland'])
    s.field.terrainEffects.current = ['volcanic']
    const r = resolveTurn(s, { type: 'ATTACK' }, { rng: RNG, terrainMultiplier: resolveTerrainMult })
    const neutral = resolveTurn(createBattleState(
      [mon({ types: ['fire'], move: move('fire', 80), atk: 80, spe: 100 })], foes()),
      { type: 'ATTACK' }, { rng: RNG, terrainMultiplier: resolveTerrainMult })
    expect(playerDamage(r.events)).toBeGreaterThan(playerDamage(neutral.events)) // volcanic 增益而非 grassland 減益
  })

  it('createBattleState 預設 field 為空地形（不破壞既有 state 形狀）', () => {
    const s = createBattleState([mon()], [mon()])
    expect(s.field.terrainEffects).toEqual({ initial: [], current: [] })
  })
})
