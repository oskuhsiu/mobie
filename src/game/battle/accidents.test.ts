import { describe, it, expect } from 'vitest'
import {
  rollBall, getBall, captureChanceWithBall, BALLS,
  chargeTier, attackQteMultiplier, qteMultiplier,
} from './engine'
import {
  createBattleState, resolveTurn, supportOutcome, SUPPORT_EVERY, STAR_STRIKE_MULT,
  type BattleEvent, type RandomEvent,
} from './reducer'
import { mon } from './testFixtures'

const randoms = (events: BattleEvent[]): RandomEvent[] =>
  events.flatMap((e) => (e.type === 'random' ? [e.event] : []))

describe('捕獲球輪盤', () => {
  it('球種倍率：精靈<超級<高級', () => {
    expect(getBall('poke').mult).toBeLessThan(getBall('great').mult)
    expect(getBall('great').mult).toBeLessThan(getBall('ultra').mult)
    expect(BALLS).toHaveLength(3)
  })

  it('rollBall 決定論（依亂數分區）', () => {
    expect(rollBall(() => 0.1)).toBe('poke')
    expect(rollBall(() => 0.7)).toBe('great')
    expect(rollBall(() => 0.95)).toBe('ultra')
  })

  it('captureChanceWithBall 隨球倍率提高、封頂 0.98', () => {
    const wild = mon({ level: 8 })
    const poke = captureChanceWithBall(wild, getBall('poke').mult)
    const ultra = captureChanceWithBall(wild, getBall('ultra').mult)
    expect(ultra).toBeGreaterThan(poke)
    expect(ultra).toBeLessThanOrEqual(0.98)
  })
})

describe('攻擊 QTE 連打蓄力', () => {
  it('色階隨連打次數提升（red→rainbow）', () => {
    expect(chargeTier(0).mult).toBe(1)
    expect(chargeTier(1).label).toBe('RED')
    expect(chargeTier(5).label).toBe('BLUE')
    expect(chargeTier(24).label).toBe('RAINBOW')
    // 單調不減
    let prev = 0
    for (let m = 0; m <= 30; m++) {
      expect(chargeTier(m).mult).toBeGreaterThanOrEqual(prev)
      prev = chargeTier(m).mult
    }
  })

  it('attackQteMultiplier = timing 品質 × 連打色階', () => {
    expect(attackQteMultiplier('perfect', 0)).toBeCloseTo(qteMultiplier('perfect'))
    expect(attackQteMultiplier('perfect', 24)).toBeCloseTo(qteMultiplier('perfect') * chargeTier(24).mult)
  })
})

describe('支援輪盤 supportOutcome', () => {
  it('亂數分區 → 獎項', () => {
    expect(supportOutcome(0.1)).toBe('attackUp')
    expect(supportOutcome(0.4)).toBe('crit')
    expect(supportOutcome(0.7)).toBe('ally')
    expect(supportOutcome(0.9)).toBe('dud')
  })
})

describe('reducer 隨機點走統一 RandomEvent', () => {
  it('每次攻擊都吐 accuracy（命中）RandomEvent，雙方各一', () => {
    const s = createBattleState([mon({ spe: 100 })], [mon({ spe: 50 })])
    const { events } = resolveTurn(s, { type: 'ATTACK' }, { rng: () => 0.5 })
    const acc = randoms(events).filter((r) => r.type === 'accuracy')
    expect(acc.length).toBe(2)
    expect(acc.map((r) => r.actorId).sort()).toEqual(['foe:0', 'player:0'])
    expect(acc.every((r) => r.outcome === 'hit')).toBe(true)
  })

  it(`第 ${SUPPORT_EVERY} 回合觸發支援輪盤、第 1 回合不觸發`, () => {
    const build = () => createBattleState([mon({ spe: 100 }), mon()], [mon({ spe: 50, maxHp: 999 })])

    const turn1 = resolveTurn(build(), { type: 'ATTACK' }, { rng: () => 0.1 })
    expect(randoms(turn1.events).some((r) => r.type === 'supportRoulette')).toBe(false)

    const atTurn3 = { ...build(), turn: SUPPORT_EVERY }
    const r3 = resolveTurn(atTurn3, { type: 'ATTACK' }, { rng: () => 0.1 })
    const sup = randoms(r3.events).find((r) => r.type === 'supportRoulette')
    expect(sup).toBeDefined()
    expect(sup!.outcome).toBe('attackUp') // roll 0.1
  })

  it('支援輪盤「補刀」讓待命隊友多打一刀（attackerIndex≠active）', () => {
    const atTurn3 = { ...createBattleState([mon({ spe: 100 }), mon()], [mon({ maxHp: 999, spe: 1 })]), turn: SUPPORT_EVERY }
    const { events } = resolveTurn(atTurn3, { type: 'ATTACK' }, { rng: () => 0.7 }) // 0.7 → ally
    const playerHits = events.filter(
      (e): e is Extract<BattleEvent, { type: 'damageApplied' }> =>
        e.type === 'damageApplied' && e.attackerSide === 'player',
    )
    // 補刀(idx1) + 主攻(idx0)
    expect(playerHits.some((h) => h.attackerIndex === 1)).toBe(true)
    expect(playerHits.some((h) => h.attackerIndex === 0)).toBe(true)
  })
})

describe('星擊 Finisher', () => {
  const firstPlayerHit = (events: BattleEvent[]) =>
    events.find(
      (e): e is Extract<BattleEvent, { type: 'damageApplied' }> =>
        e.type === 'damageApplied' && e.attackerSide === 'player',
    )

  it('星擊傷害遠高於普攻、且必定會心', () => {
    const build = () => createBattleState([mon({ atk: 80, spe: 100 })], [mon({ maxHp: 9999, def: 40 })])
    const normal = resolveTurn(build(), { type: 'ATTACK', quality: 'normal' }, { rng: () => 0.5 })
    const star = resolveTurn(build(), { type: 'ATTACK', starStrike: true }, { rng: () => 0.5 })

    const nHit = firstPlayerHit(normal.events)!
    const sHit = firstPlayerHit(star.events)!
    expect(sHit.crit).toBe(true)
    // 星擊 ×STAR_STRIKE_MULT(3) × 會心(1.5) ≈ 遠大於普攻
    expect(sHit.amount).toBeGreaterThan(nHit.amount * STAR_STRIKE_MULT)
  })

  it('星擊回合跳過支援輪盤', () => {
    const atTurn3 = { ...createBattleState([mon(), mon()], [mon({ maxHp: 9999 })]), turn: SUPPORT_EVERY }
    const { events } = resolveTurn(atTurn3, { type: 'ATTACK', starStrike: true }, { rng: () => 0.1 })
    expect(randoms(events).some((r) => r.type === 'supportRoulette')).toBe(false)
  })
})
