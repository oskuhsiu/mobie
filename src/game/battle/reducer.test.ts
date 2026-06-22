import { describe, it, expect } from 'vitest'
import {
  createBattleState,
  resolveTurn,
  type BattleEvent,
  type Side,
} from './reducer'
import { move, mon } from './testFixtures'

/** 定值 rng：50 → 必命中、無暴擊、變異 0.925；速度不同時不消耗 rng */
const RNG = () => 0.5

const STRONG = { atk: 80, move: move('normal', 90), spe: 100 }
const WEAK = { atk: 10, move: move('normal', 10), spe: 10 }

const find = (events: BattleEvent[], type: BattleEvent['type']) =>
  events.filter((e) => e.type === type)

describe('resolveTurn — 先後手', () => {
  it('速度高者先攻（player 快）', () => {
    const s = createBattleState([mon({ spe: 100 })], [mon({ spe: 50 })])
    const { events } = resolveTurn(s, { type: 'ATTACK' }, { rng: RNG })
    const dmg = find(events, 'damageApplied')
    expect(dmg[0]).toMatchObject({ type: 'damageApplied', attackerSide: 'player' })
  })

  it('速度高者先攻（foe 快）', () => {
    const s = createBattleState([mon({ spe: 50 })], [mon({ spe: 100 })])
    const { events } = resolveTurn(s, { type: 'ATTACK' }, { rng: RNG })
    const dmg = find(events, 'damageApplied')
    expect(dmg[0]).toMatchObject({ type: 'damageApplied', attackerSide: 'foe' })
  })
})

describe('resolveTurn — ATTACK 3v3 依序 KO 與全滅判定', () => {
  it('player 依序擊倒對手 3 隻 → 強制換 → 全滅獲勝', () => {
    const players = [mon(STRONG), mon(STRONG), mon(STRONG)]
    const foes = [mon({ ...WEAK, maxHp: 1 }), mon({ ...WEAK, maxHp: 1 }), mon({ ...WEAK, maxHp: 1 })]
    let state = createBattleState(players, foes)
    const all: BattleEvent[] = []

    for (let i = 0; i < 3; i++) {
      const r = resolveTurn(state, { type: 'ATTACK' }, { rng: RNG })
      all.push(...r.events)
      state = r.nextState
    }

    // 三隻都被打倒
    expect(find(all, 'memberFainted')).toHaveLength(3)
    // 前兩次倒下各觸發一次強制換（forced），最後一次無人可換
    const forced = find(all, 'activeChanged').filter((e) => e.type === 'activeChanged' && e.forced)
    expect(forced).toHaveLength(2)
    expect(forced[0]).toMatchObject({ side: 'foe', fromIndex: 0, toIndex: 1, forced: true })
    expect(forced[1]).toMatchObject({ side: 'foe', fromIndex: 1, toIndex: 2, forced: true })
    // 結束且 player 勝
    expect(find(all, 'battleEnded')).toEqual([{ type: 'battleEnded', winner: 'player' }])
    expect(state.winner).toBe('player')
    // player 全程不被攻擊（對手每回合被秒、第二攻擊者略過）
    expect(state.player.members[0].currentHp).toBe(players[0].maxHp)
  })

  it('全滅另一向：foe 較強 → player 落敗', () => {
    const players = [mon({ ...WEAK, maxHp: 1 }), mon({ ...WEAK, maxHp: 1 }), mon({ ...WEAK, maxHp: 1 })]
    const foes = [mon(STRONG), mon(STRONG), mon(STRONG)]
    let state = createBattleState(players, foes)
    const all: BattleEvent[] = []

    for (let i = 0; i < 3; i++) {
      const r = resolveTurn(state, { type: 'ATTACK' }, { rng: RNG })
      all.push(...r.events)
      state = r.nextState
    }

    expect(state.winner).toBe('foe')
    expect(find(all, 'battleEnded')).toEqual([{ type: 'battleEnded', winner: 'foe' }])
    // player 的 active 每回合先被秒 → 自己這回合攻擊被略過，全程沒打出傷害
    const playerHits = find(all, 'damageApplied').filter(
      (e) => e.type === 'damageApplied' && e.attackerSide === 'player',
    )
    expect(playerHits).toHaveLength(0)
  })
})

describe('resolveTurn — SWITCH 主動換人 + 防禦 QTE', () => {
  it('換人觸發對手一擊與防禦抵減事件，順序正確', () => {
    const players = [mon(), mon({ name: '替補', maxHp: 200 }), mon()]
    const foes = [mon(STRONG)]
    const state = createBattleState(players, foes)
    const { events, nextState } = resolveTurn(
      state,
      { type: 'SWITCH', index: 1, defenseQuality: 'good' },
      { rng: RNG },
    )

    const dom = events.filter((e) => e.type !== 'random')
    const types = dom.map((e) => e.type)
    expect(types).toEqual(['activeChanged', 'switchDefenseResolved', 'damageApplied'])
    expect(dom[0]).toMatchObject({ side: 'player', fromIndex: 0, toIndex: 1, forced: false })
    expect(dom[1]).toMatchObject({ side: 'player', index: 1, defenseQuality: 'good', damageMult: 0.4 })
    expect(dom[2]).toMatchObject({ attackerSide: 'foe', targetSide: 'player', targetIndex: 1 })
    expect(nextState.player.activeIndex).toBe(1)
    expect(nextState.winner).toBeNull()
  })

  it('防禦 QTE 品質越好、受傷越少（perfect < weak）', () => {
    const build = () => createBattleState([mon(), mon({ maxHp: 300 }), mon()], [mon(STRONG)])

    const perfect = resolveTurn(build(), { type: 'SWITCH', index: 1, defenseQuality: 'perfect' }, { rng: RNG })
    const weak = resolveTurn(build(), { type: 'SWITCH', index: 1, defenseQuality: 'weak' }, { rng: RNG })

    const dmgOf = (r: { events: BattleEvent[] }) => {
      const d = r.events.find((e) => e.type === 'damageApplied')
      return d && d.type === 'damageApplied' ? d.amount : -1
    }
    const dPerfect = dmgOf(perfect)
    const dWeak = dmgOf(weak)
    expect(dPerfect).toBeGreaterThan(0)
    expect(dPerfect).toBeLessThan(dWeak)
  })

  it('換上即倒 → 立即強制換到下一個存活隊友', () => {
    // index0 是被換下的原 active（滿血），脆皮 index1 換上即倒；
    // 強制換依序挑第一個存活者 → 接回 index0，戰鬥續行。
    const players = [mon({ name: '原將' }), mon({ name: '脆皮', maxHp: 1 }), mon({ name: '後援' })]
    const foes = [mon(STRONG)]
    const state = createBattleState(players, foes)
    const { events, nextState } = resolveTurn(
      state,
      { type: 'SWITCH', index: 1, defenseQuality: 'weak' },
      { rng: RNG },
    )

    const dom = events.filter((e) => e.type !== 'random')
    const types = dom.map((e) => e.type)
    expect(types).toEqual([
      'activeChanged', // 主動換上 index 1
      'switchDefenseResolved',
      'damageApplied', // 對手一擊把脆皮打倒
      'memberFainted',
      'activeChanged', // 立即強制換到第一個存活者
    ])
    expect(dom[3]).toMatchObject({ side: 'player', index: 1 })
    expect(dom[4]).toMatchObject({ side: 'player', fromIndex: 1, toIndex: 0, forced: true })
    expect(nextState.player.activeIndex).toBe(0)
    expect(nextState.winner).toBeNull()
  })

  it('非法換人（同隻 / 倒下 / 越界）拋錯', () => {
    const s = createBattleState([mon(), mon({ maxHp: 1, currentHp: 0 }), mon()], [mon()])
    expect(() => resolveTurn(s, { type: 'SWITCH', index: 0 }, { rng: RNG })).toThrow() // 同隻
    expect(() => resolveTurn(s, { type: 'SWITCH', index: 1 }, { rng: RNG })).toThrow() // 已倒下
    expect(() => resolveTurn(s, { type: 'SWITCH', index: 9 }, { rng: RNG })).toThrow() // 越界
  })
})

describe('resolveTurn — 純函數與終局守衛', () => {
  it('不改動傳入的 state（HP / activeIndex 不變）', () => {
    const players = [mon(STRONG), mon(STRONG)]
    const foes = [mon({ ...WEAK, maxHp: 1 }), mon({ ...WEAK, maxHp: 1 })]
    const state = createBattleState(players, foes)
    const snapshotHp = state.foe.members[0].currentHp
    const snapshotActive = state.foe.activeIndex

    resolveTurn(state, { type: 'ATTACK' }, { rng: RNG })

    expect(state.foe.members[0].currentHp).toBe(snapshotHp)
    expect(state.foe.activeIndex).toBe(snapshotActive)
    expect(state.turn).toBe(1)
    expect(state.winner).toBeNull()
  })

  it('回合數每次 +1', () => {
    const s = createBattleState([mon(STRONG)], [mon({ maxHp: 500 })])
    const r1 = resolveTurn(s, { type: 'ATTACK' }, { rng: RNG })
    expect(r1.nextState.turn).toBe(2)
    const r2 = resolveTurn(r1.nextState, { type: 'ATTACK' }, { rng: RNG })
    expect(r2.nextState.turn).toBe(3)
  })

  it('已分勝負後再呼叫為 no-op', () => {
    const ended = { ...createBattleState([mon()], [mon()]), winner: 'player' as Side }
    const r = resolveTurn(ended, { type: 'ATTACK' }, { rng: RNG })
    expect(r.events).toEqual([])
    expect(r.nextState).toBe(ended)
  })
})
