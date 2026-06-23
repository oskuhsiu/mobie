// M9 — 連鎖攻擊（plan/09 §3）reducer 核心測試。
// 證明：① 連鎖模組關閉零殘留（gauge 恆 0、不 emit）② 連鎖槽依 QTE 表現累積、滿則 emit chainOpportunity
//       ③ SUBMIT_CHAIN_RESULT 多段對同一 active 敵、吃速度 ④ 重驗（死亡攻擊者跳過 / 目標倒下截斷 / 領銜者被 KO 發不出）
//       ⑤ 連鎖消耗連鎖槽 ⑥ 純函數 / 決定論。
import { describe, it, expect } from 'vitest'
import { createBattleState, resolveTurn, type BattleState, type ChainHit } from './reducer'
import type { ExtBundle } from '@/game/ext/seams'
import { move, mon } from './testFixtures'

/** 定值 rng：50 → 必命中、無暴擊、變異 0.925；速度同值時 foe 先（0.5 不 <0.5）。 */
const RNG = () => 0.5

/** 連鎖開啟的 ext（gainBase 50：normal 品質一回合 +50，兩回合集滿 100）。 */
const chainExt = (over: Partial<ExtBundle['chain']> = {}): ExtBundle => ({
  damageHooks: [],
  turnEndTriggers: [],
  chain: { maxHits: 3, gaugeFull: 100, gainBase: 50, ...over },
})

/** 預填連鎖槽到滿，省去多回合鋪陳。 */
const full = (s: BattleState): BattleState => ({ ...s, chainGauge: 100 })

const HITS3: ChainHit[] = [
  { attackerIndex: 0, quality: 'good' },
  { attackerIndex: 1, quality: 'good' },
  { attackerIndex: 2, quality: 'good' },
]

const trio = () => [mon({ spe: 100 }), mon({ nameZh: 'B' }), mon({ nameZh: 'C' })]
const tank = () => mon({ maxHp: 999, spe: 50 })

describe('M9 連鎖 — 模組關閉零殘留', () => {
  it('不傳 ext.chain：連鎖槽恆 0、永不 emit chainOpportunity', () => {
    let s = createBattleState([mon({ spe: 100 })], [tank()])
    for (let i = 0; i < 5; i++) {
      const r = resolveTurn(s, { type: 'ATTACK', quality: 'perfect' }, { rng: RNG })
      expect(r.events.some((e) => e.type === 'chainOpportunity')).toBe(false)
      s = r.nextState
    }
    expect(s.chainGauge).toBe(0)
  })
})

describe('M9 連鎖 — 連鎖槽累積 + chainOpportunity', () => {
  it('玩家普攻命中依品質累積；達 gaugeFull 才 emit', () => {
    const ext = chainExt()
    const s0 = createBattleState([mon({ spe: 100 })], [tank()])
    const r1 = resolveTurn(s0, { type: 'ATTACK', quality: 'normal' }, { rng: RNG, ext })
    expect(r1.nextState.chainGauge).toBe(50)
    expect(r1.events.some((e) => e.type === 'chainOpportunity')).toBe(false)

    const r2 = resolveTurn(r1.nextState, { type: 'ATTACK', quality: 'normal' }, { rng: RNG, ext })
    expect(r2.nextState.chainGauge).toBe(100)
    expect(r2.events.some((e) => e.type === 'chainOpportunity')).toBe(true)
  })

  it('落空（沒命中）不累積連鎖槽', () => {
    const ext = chainExt()
    // 命中率 0 的招式 → accuracyRoll(0.5)*100 >= 0 → miss
    const s0 = createBattleState([mon({ spe: 100, move: move('normal', 60, 0) })], [tank()])
    const r = resolveTurn(s0, { type: 'ATTACK', quality: 'normal' }, { rng: RNG, ext })
    expect(r.nextState.chainGauge).toBe(0)
  })

  it('星擊不續連鎖槽（已是 finisher）', () => {
    const ext = chainExt()
    const s0 = createBattleState([mon({ spe: 100 })], [tank()])
    const r = resolveTurn(s0, { type: 'ATTACK', starStrike: true }, { rng: RNG, ext })
    expect(r.nextState.chainGauge).toBe(0)
  })

  it('eligibleIndices：active 在前 + 存活隊友、最多 maxHits；倒下者不列入', () => {
    const ext = chainExt({ maxHits: 3 })
    const opp = (members: ReturnType<typeof mon>[]) => {
      const r = resolveTurn(full(createBattleState(members, [tank()])), { type: 'ATTACK', quality: 'normal' }, { rng: RNG, ext })
      const e = r.events.find((ev) => ev.type === 'chainOpportunity')
      return e && e.type === 'chainOpportunity' ? e.eligibleIndices : null
    }
    expect(opp(trio())).toEqual([0, 1, 2])
    // 隊友 index1 倒下 → 排除
    expect(opp([mon({ spe: 100 }), mon({ currentHp: 0 }), mon()])).toEqual([0, 2])
  })

  it('maxHits 上限：eligibleIndices 截到 maxHits', () => {
    const ext = chainExt({ maxHits: 2 })
    const r = resolveTurn(full(createBattleState(trio(), [tank()])), { type: 'ATTACK', quality: 'normal' }, { rng: RNG, ext })
    const e = r.events.find((ev) => ev.type === 'chainOpportunity')
    expect(e && e.type === 'chainOpportunity' ? e.eligibleIndices : null).toEqual([0, 1])
  })
})

describe('M9 連鎖 — SUBMIT_CHAIN_RESULT 結算', () => {
  const ext = chainExt()

  it('三隻全存活 → 3 段 chainHit + 3 次玩家傷害，皆命中同一 active 敵；連鎖消耗連鎖槽', () => {
    const s = full(createBattleState(trio(), [tank()]))
    const r = resolveTurn(s, { type: 'SUBMIT_CHAIN_RESULT', hits: HITS3 }, { rng: RNG, ext })
    const chainHits = r.events.filter((e) => e.type === 'chainHit')
    expect(chainHits.length).toBe(3)
    expect(chainHits.map((e) => (e.type === 'chainHit' ? e.comboCount : 0))).toEqual([1, 2, 3])
    const pdmg = r.events.filter((e) => e.type === 'damageApplied' && e.attackerSide === 'player')
    expect(pdmg.length).toBe(3)
    expect(pdmg.every((e) => e.type === 'damageApplied' && e.targetSide === 'foe' && e.targetIndex === 0)).toBe(true)
    expect(r.nextState.chainGauge).toBe(0)
  })

  it('maxHits 上限截斷：給 3 隻但 maxHits=2 → 只結算 2 段', () => {
    const ext2 = chainExt({ maxHits: 2 })
    const r = resolveTurn(full(createBattleState(trio(), [tank()])), { type: 'SUBMIT_CHAIN_RESULT', hits: HITS3 }, { rng: RNG, ext: ext2 })
    expect(r.events.filter((e) => e.type === 'chainHit').length).toBe(2)
  })

  it('目標倒下即截斷剩餘 hits（不追擊新上場的敵）', () => {
    const s = full(createBattleState(trio(), [mon({ currentHp: 1, spe: 50 }), mon({ nameZh: '替補' })]))
    const r = resolveTurn(s, { type: 'SUBMIT_CHAIN_RESULT', hits: HITS3 }, { rng: RNG, ext })
    // 玩家較快 → 連鎖先手；第一段就 KO foe active → 截斷
    expect(r.events.filter((e) => e.type === 'chainHit').length).toBe(1)
    expect(r.nextState.foe.activeIndex).toBe(1) // 已強制換到替補
    const pdmg = r.events.filter((e) => e.type === 'damageApplied' && e.attackerSide === 'player')
    expect(pdmg.length).toBe(1)
  })

  it('重驗：hits 含已倒下隊友 → 該段跳過、不計連段', () => {
    const s = full(createBattleState([mon({ spe: 100 }), mon({ currentHp: 0 }), mon({ nameZh: 'C' })], [tank()]))
    const r = resolveTurn(s, { type: 'SUBMIT_CHAIN_RESULT', hits: HITS3 }, { rng: RNG, ext })
    const chainHits = r.events.filter((e) => e.type === 'chainHit')
    expect(chainHits.length).toBe(2)
    expect(chainHits.map((e) => (e.type === 'chainHit' ? e.attackerIndex : -1))).toEqual([0, 2])
    expect(chainHits.map((e) => (e.type === 'chainHit' ? e.comboCount : -1))).toEqual([1, 2])
  })

  it('§0.4 B 吃速度：玩家較慢且領銜者被敵先手 KO → 連鎖發不出', () => {
    const a = mon({ spe: 1, currentHp: 5, maxHp: 100, types: ['grass'] })
    const foe = mon({ spe: 200, atk: 140, move: move('fire', 100) }) // 快 + 剋制 → 一擊 KO
    const s = full(createBattleState([a, mon(), mon()], [foe]))
    const r = resolveTurn(s, { type: 'SUBMIT_CHAIN_RESULT', hits: [{ attackerIndex: 0, quality: 'good' }] }, { rng: RNG, ext })
    expect(r.events.some((e) => e.type === 'memberFainted' && e.side === 'player')).toBe(true)
    expect(r.events.filter((e) => e.type === 'chainHit').length).toBe(0)
    expect(r.events.some((e) => e.type === 'damageApplied' && e.attackerSide === 'player')).toBe(false)
  })

  it('提交後即使連鎖未發出也消耗連鎖槽', () => {
    const a = mon({ spe: 1, currentHp: 5, maxHp: 100, types: ['grass'] })
    const foe = mon({ spe: 200, atk: 140, move: move('fire', 100) })
    const s = full(createBattleState([a, mon(), mon()], [foe]))
    const r = resolveTurn(s, { type: 'SUBMIT_CHAIN_RESULT', hits: [{ attackerIndex: 0, quality: 'good' }] }, { rng: RNG, ext })
    expect(r.nextState.chainGauge).toBe(0)
  })
})

describe('M9 連鎖 — 純函數 / 決定論', () => {
  const ext = chainExt()
  it('不改動原 state', () => {
    const s = full(createBattleState(trio(), [tank()]))
    const snapshot = JSON.stringify(s)
    resolveTurn(s, { type: 'SUBMIT_CHAIN_RESULT', hits: HITS3 }, { rng: RNG, ext })
    expect(JSON.stringify(s)).toBe(snapshot)
  })
  it('同輸入 → 同結果', () => {
    const s = full(createBattleState(trio(), [tank()]))
    const a = resolveTurn(s, { type: 'SUBMIT_CHAIN_RESULT', hits: HITS3 }, { rng: () => 0.5, ext })
    const b = resolveTurn(s, { type: 'SUBMIT_CHAIN_RESULT', hits: HITS3 }, { rng: () => 0.5, ext })
    expect(a.nextState).toEqual(b.nextState)
    expect(a.events).toEqual(b.events)
  })
})
