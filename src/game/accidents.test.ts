// M11 野外意外（plan/11 §3）：rareBoss / encounter 旗標 / 戰中 wildEvents hook 純邏輯測試。
import { describe, it, expect } from 'vitest'
import type { Card, Region } from '@/game/types'
import { maybeRareBoss, rollEncounterAccidents, makeWildEvents } from './accidents'
import { createBattleState, resolveTurn } from './battle/reducer'
import { mon } from './battle/testFixtures'

const wildRegion = { id: 'w', mode: 'wild' } as unknown as Region
const arenaRegion = { id: 'a', mode: 'arena' } as unknown as Region
const team = (): Card[] => [
  { cardId: 'a', speciesId: 1, level: 10 },
  { cardId: 'b', speciesId: 2, level: 12 },
  { cardId: 'c', speciesId: 3, level: 14 },
]
const seqRng = (vals: number[]) => { let i = 0; return () => vals[i++ % vals.length] }

describe('M11 稀有閃光 boss', () => {
  it('wild + 命中機率 → boss（末隻）升異色 + 高 IV，其餘不變', () => {
    const out = maybeRareBoss(team(), wildRegion, () => 0.05) // < RARE_BOSS_CHANCE
    expect(out[2].shiny).toBe(true)
    expect(out[2].ivs?.atk).toBe(30)
    expect(out[0].shiny).toBeUndefined() // 只動 boss
  })
  it('未命中機率 → 原封不動', () => {
    const out = maybeRareBoss(team(), wildRegion, () => 0.9)
    expect(out[2].shiny).toBeUndefined()
  })
  it('arena → 不觸發（即使 rng 命中）', () => {
    const out = maybeRareBoss(team(), arenaRegion, () => 0.0)
    expect(out[2].shiny).toBeUndefined()
  })
})

describe('M11 encounter 意外旗標', () => {
  it('決定論：同 region + foeTeam → 同結果', () => {
    const a = rollEncounterAccidents(wildRegion, team())
    const b = rollEncounterAccidents(wildRegion, team())
    expect(a).toEqual(b)
  })
  it('arena → 無意外（luckyExpMult=1、supply=null）', () => {
    const r = rollEncounterAccidents(arenaRegion, team())
    expect(r.luckyExpMult).toBe(1)
    expect(r.supply).toBeNull()
  })
  it('wild → luckyExpMult ∈ {1,1.5}、supply 為三選一或 null', () => {
    const r = rollEncounterAccidents(wildRegion, team())
    expect([1, 1.5]).toContain(r.luckyExpMult)
    expect(r.supply === null || r.supply.length === 3).toBe(true)
  })
})

describe('M11 戰中 wildEvents hook', () => {
  const baseState = () => createBattleState([mon({ maxHp: 100, currentHp: 100, spe: 99 })], [mon({ maxHp: 100, currentHp: 100 })])

  it('terrainShift：改 field.current + emit wildAccident(terrainShift)', () => {
    const hook = makeWildEvents({ terrainPool: ['volcanic'] })
    // rng：① 0.05<0.12 觸發 ② 0.3<0.5 shift ③ 0.0 取 pool[0]
    const state = { ...baseState(), turn: 3 }
    const events = hook({ state, rng: seqRng([0.05, 0.3, 0.0]) })
    expect(state.field.terrainEffects.current).toEqual(['volcanic'])
    expect(events[0]).toMatchObject({ type: 'wildAccident', kind: 'terrainShift', terrainId: 'volcanic' })
  })

  it('intrusion：非致命削血（留 ≥1 HP）+ emit wildAccident(intrusion)', () => {
    const hook = makeWildEvents({ terrainPool: [] }) // 無地形池 → 只能 intrusion
    const state = { ...baseState(), turn: 3 }
    state.player.members[0].currentHp = 5 // 低血驗非致命
    // rng：① 0.05 觸發 ② doShift=false（無池）③ 0.0 side=player
    const events = hook({ state, rng: seqRng([0.05, 0.9, 0.0]) })
    const ev = events[0]
    expect(ev.type).toBe('wildAccident')
    if (ev.type === 'wildAccident') {
      expect(ev.kind).toBe('intrusion')
      expect(state[ev.side!].members[ev.index!].currentHp).toBeGreaterThanOrEqual(1) // 非致命
    }
  })

  it('開場第 1 回合不觸發', () => {
    const hook = makeWildEvents({ terrainPool: ['volcanic'] })
    const state = { ...baseState(), turn: 1 }
    expect(hook({ state, rng: () => 0.0 })).toEqual([])
  })

  it('機率未命中 → 無意外', () => {
    const hook = makeWildEvents({ terrainPool: ['volcanic'] })
    const state = { ...baseState(), turn: 5 }
    expect(hook({ state, rng: () => 0.99 })).toEqual([])
  })

  it('注入 reducer：resolveTurn(wildEvents) 觸發 → events 含 wildAccident、地形 current 變', () => {
    const state = createBattleState([mon({ spe: 99 })], [mon({ maxHp: 999, currentHp: 999 })])
    const hook = makeWildEvents({ terrainPool: ['snowfield'] })
    // 推進到 turn≥2 再注入：先打一回合（不注入），再注入打第二回合
    const t1 = resolveTurn(state, { type: 'ATTACK', quality: 'normal' }, {})
    const { nextState, events } = resolveTurn(t1.nextState, { type: 'ATTACK', quality: 'normal' }, { wildEvents: ({ state: s, rng }) => hook({ state: s, rng }), rng: () => 0.01 })
    // rng=0.01 恆觸發；0.01<0.5 → shift；pool[0]=snowfield
    expect(events.some((e) => e.type === 'wildAccident')).toBe(true)
    expect(nextState.field.terrainEffects.current).toEqual(['snowfield'])
  })
})
