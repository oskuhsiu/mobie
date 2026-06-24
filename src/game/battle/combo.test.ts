// M12.d — 合體技（plan/12 §4）reducer + matcher 測試。
// 證明：① matchCombo 純配對（屬性/種族/去重/未用過）② 連鎖提交符合配對 → comboCast + 施放效果寫 fieldState
//       ③ 合成大招直接傷害 ④ 每組合每場一次（usedComboKeys）⑤ 合體模組關閉零殘留 ⑥ 純函數。
import { describe, it, expect } from 'vitest'
import { createBattleState, resolveTurn, type BattleState, type ChainHit } from './reducer'
import type { ExtBundle } from '@/game/ext/seams'
import { matchCombo, COMBO_DEFS, COMBO_RULES, type ComboDef } from '@/game/ext/combo'
import { move, mon } from './testFixtures'

const RNG = () => 0.5

/** 連鎖+合體都開的 ext。 */
const comboExt = (): ExtBundle => ({
  damageHooks: [],
  turnEndTriggers: [],
  chain: { maxHits: 3, gaugeFull: 100, gainBase: 50 },
  combo: COMBO_RULES,
})
const full = (s: BattleState): BattleState => ({ ...s, chainGauge: 100 })

// 一隊：slot0 火、slot1 水（→ steam-burst），slot2 一般。對手肉盾撐多回合。
const fireMon = () => mon({ nameZh: '火', types: ['fire'], move: move('fire', 60), spe: 100 })
const waterMon = () => mon({ nameZh: '水', types: ['water'], move: move('water', 60) })
const plainMon = () => mon({ nameZh: '般', types: ['normal'] })
const tank = () => mon({ nameZh: '盾', maxHp: 9999, spe: 1, def: 999 })

const HITS: ChainHit[] = [
  { attackerIndex: 0, quality: 'good' },
  { attackerIndex: 1, quality: 'good' },
  { attackerIndex: 2, quality: 'good' },
]

describe('matchCombo（純配對）', () => {
  it('火＋水參與 → 命中 steam-burst', () => {
    const def = matchCombo([fireMon(), waterMon()], COMBO_DEFS, [])
    expect(def?.id).toBe('steam-burst')
  })
  it('少於 2 名參與 → null', () => {
    expect(matchCombo([fireMon()], COMBO_DEFS, [])).toBeNull()
  })
  it('已用過的 key 跳過', () => {
    expect(matchCombo([fireMon(), waterMon()], COMBO_DEFS, ['steam-burst'])).toBeNull()
  })
  it('種族配對：speciesPair 皆參與才命中', () => {
    const defs: ComboDef[] = [{ id: 'sp', name: 'SP', icon: '✦', requires: { speciesPair: [3, 6] }, power: 2, cast: { kind: 'teamBuff', stat: 'atk', mult: 1.3, turns: 2 } }]
    expect(matchCombo([mon({ speciesId: 3 }), mon({ speciesId: 6 })], defs, [])?.id).toBe('sp')
    expect(matchCombo([mon({ speciesId: 3 }), mon({ speciesId: 9 })], defs, [])).toBeNull()
  })
})

describe('合體技 reducer 整合', () => {
  it('連鎖提交火＋水 → comboCast（enemyDebuff）+ usedComboKeys + 合成大招傷害', () => {
    const s = full(createBattleState([fireMon(), waterMon(), plainMon()], [tank(), tank(), tank()]))
    const { nextState, events } = resolveTurn(s, { type: 'SUBMIT_CHAIN_RESULT', hits: HITS }, { rng: RNG, ext: comboExt() })
    const cast = events.find((e) => e.type === 'comboCast')
    expect(cast).toMatchObject({ type: 'comboCast', key: 'steam-burst', castKind: 'enemyDebuff' })
    expect(nextState.usedComboKeys).toContain('steam-burst')
    // enemyDebuff 寫進 enemyStatuses + 展示標記
    expect(nextState.field.enemyStatuses.some((st) => st.stat === 'atk' && st.mult < 1)).toBe(true)
    expect(nextState.field.comboCastEffects.some((m) => m.key === 'steam-burst')).toBe(true)
    // 合成大招（source=combo-…）多一次 damageApplied
    expect(events.some((e) => e.type === 'damageApplied' && e.attackerSide === 'player')).toBe(true)
  })

  it('每組合每場一次：第二次同配對連鎖不再 comboCast', () => {
    let s = full(createBattleState([fireMon(), waterMon(), plainMon()], [tank(), tank(), tank()]))
    const ext = comboExt()
    const r1 = resolveTurn(s, { type: 'SUBMIT_CHAIN_RESULT', hits: HITS }, { rng: RNG, ext })
    s = full(r1.nextState) // 重新填滿連鎖槽
    const r2 = resolveTurn(s, { type: 'SUBMIT_CHAIN_RESULT', hits: HITS }, { rng: RNG, ext })
    expect(r1.events.some((e) => e.type === 'comboCast')).toBe(true)
    expect(r2.events.some((e) => e.type === 'comboCast')).toBe(false)
  })

  it('合體模組關閉（無 ext.combo）→ 連鎖不升級、零殘留', () => {
    const s = full(createBattleState([fireMon(), waterMon(), plainMon()], [tank(), tank(), tank()]))
    const { nextState, events } = resolveTurn(s, { type: 'SUBMIT_CHAIN_RESULT', hits: HITS }, { rng: RNG, ext: { damageHooks: [], turnEndTriggers: [], chain: { maxHits: 3, gaugeFull: 100, gainBase: 50 } } })
    expect(events.some((e) => e.type === 'comboCast')).toBe(false)
    expect(nextState.usedComboKeys).toHaveLength(0)
    expect(nextState.field.comboCastEffects).toHaveLength(0)
  })

  it('純函數：不改原 state（usedComboKeys/comboCastEffects 不外洩）', () => {
    const s = full(createBattleState([fireMon(), waterMon(), plainMon()], [tank(), tank(), tank()]))
    resolveTurn(s, { type: 'SUBMIT_CHAIN_RESULT', hits: HITS }, { rng: RNG, ext: comboExt() })
    expect(s.usedComboKeys).toHaveLength(0)
    expect(s.field.comboCastEffects).toHaveLength(0)
  })
})
