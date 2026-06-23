// M6.0 — 掛載地基 + 回合相位契約（plan/09 §0）的 reducer 縫測試。
// 證明：ext 預設零行為改變、S3 傷害鉤注入、S4 回合末觸發器在 timeout「之前」跑、starStrike 是 ATTACK mode。
import { describe, it, expect } from 'vitest'
import { createBattleState, resolveTurn, MAX_TURNS, type BattleEvent } from './reducer'
import type { ExtBundle, TurnEndTrigger, DamageHook } from '@/game/ext/seams'
import { move, mon } from './testFixtures'

/** 定值 rng：50 → 必命中、無暴擊、變異 0.925 */
const RNG = () => 0.5

const FAST_HITTER = { atk: 80, move: move('normal', 90), spe: 100 }

const dmgOf = (events: BattleEvent[], side: 'player' | 'foe'): number => {
  const d = events.find((e) => e.type === 'damageApplied' && e.attackerSide === side)
  return d && d.type === 'damageApplied' ? d.amount : -1
}

describe('M6.0 ext 注入 — 預設零行為改變', () => {
  it('不傳 ext 與傳空 ext 傷害一致', () => {
    const build = () => createBattleState([mon(FAST_HITTER)], [mon({ maxHp: 500 })])
    const a = resolveTurn(build(), { type: 'ATTACK' }, { rng: RNG })
    const b = resolveTurn(build(), { type: 'ATTACK' }, { rng: RNG, ext: { damageHooks: [], turnEndTriggers: [] } })
    expect(dmgOf(b.events, 'player')).toBe(dmgOf(a.events, 'player'))
  })
})

describe('M6.0 S3 damageHook 注入', () => {
  const build = () => createBattleState([mon(FAST_HITTER)], [mon({ maxHp: 500 })])
  const withHook = (hook: DamageHook) =>
    resolveTurn(build(), { type: 'ATTACK' }, { rng: RNG, ext: { damageHooks: [hook], turnEndTriggers: [] } })

  it('×1.0 鉤等同無鉤（同位階相乘）', () => {
    const base = dmgOf(resolveTurn(build(), { type: 'ATTACK' }, { rng: RNG }).events, 'player')
    expect(dmgOf(withHook(() => 1).events, 'player')).toBe(base)
  })

  it('×1.5 增傷、×0.5 減傷', () => {
    const base = dmgOf(resolveTurn(build(), { type: 'ATTACK' }, { rng: RNG }).events, 'player')
    expect(dmgOf(withHook(() => 1.5).events, 'player')).toBeGreaterThan(base)
    expect(dmgOf(withHook(() => 0.5).events, 'player')).toBeLessThan(base)
  })

  it('鉤可依 ctx 自我過濾（剋制目標才生效）', () => {
    // 對非剋制目標（normal vs normal，eff=1）回 1；對剋制（eff>1）才 ×1.5
    const conditional: DamageHook = (ctx) => (ctx.effectiveness > 1 ? 1.5 : 1)
    const base = dmgOf(resolveTurn(build(), { type: 'ATTACK' }, { rng: RNG }).events, 'player')
    expect(dmgOf(withHook(conditional).events, 'player')).toBe(base) // 非剋制 → 不生效
  })
})

describe('M6.0 S4 turnEndTrigger — 在 timeout 判定之前（contract D）', () => {
  // normal 招對 ghost 完全無效 → 雙方 0 傷、無人倒下，只剩 timeout 依剩餘血量比例判勝。
  const ghost = (over = {}) => mon({ types: ['ghost'], move: move('normal', 90), ...over })

  function runToTimeout(ext?: ExtBundle) {
    // 玩家血少（10/100）、對手血多（90/100）：無 trigger 時 timeout 判對手勝。
    let state = createBattleState([ghost({ currentHp: 10 })], [ghost({ currentHp: 90 })])
    for (let i = 0; i < MAX_TURNS; i++) {
      state = resolveTurn(state, { type: 'ATTACK' }, { rng: RNG, ext }).nextState
    }
    return state
  }

  it('無 trigger：玩家血少 → 對手 timeout 勝', () => {
    expect(runToTimeout().winner).toBe('foe')
  })

  it('回合末 heal trigger 拉高玩家血量 → 翻轉 timeout 為玩家勝（S4 在 timeout 前跑）', () => {
    const heal: TurnEndTrigger = ({ state }) => {
      const a = state.player.members[state.player.activeIndex]
      a.currentHp = a.maxHp
      return []
    }
    expect(runToTimeout({ damageHooks: [], turnEndTriggers: [heal] }).winner).toBe('player')
  })
})

describe('M6.0 相位契約 §0.4 — starStrike 是 ATTACK 的 mode（非獨立 action）', () => {
  it('{ type:ATTACK, starStrike:true } 走 ATTACK 相位、必定會心、傷害遠高於普攻', () => {
    const s = createBattleState([mon(FAST_HITTER)], [mon({ maxHp: 999 })])
    const normal = resolveTurn(s, { type: 'ATTACK' }, { rng: RNG })
    const star = resolveTurn(s, { type: 'ATTACK', starStrike: true }, { rng: RNG })
    expect(dmgOf(star.events, 'player')).toBeGreaterThan(dmgOf(normal.events, 'player'))
    const crit = star.events.find((e) => e.type === 'random' && e.event.type === 'crit')
    expect(crit && crit.type === 'random' ? crit.event.outcome : null).toBe('crit')
  })
})
