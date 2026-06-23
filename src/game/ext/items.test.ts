// M7 — 持有道具（S1/S3/S4）。設計真相：plan/09 §1。測試實際掛載的縫（HELD_ITEMS_MODULE.seams）。
import { describe, it, expect } from 'vitest'
import { mon } from '@/game/battle/testFixtures'
import { createBattleState } from '@/game/battle/reducer'
import { HELD_ITEMS_MODULE, getItem, ITEMS } from '@/game/ext/items'
import { assembleExt, assembleBattlePrep } from '@/store/ext'
import { defaultSettings, setModuleEnabledIn } from '@/game/settings'

const build = HELD_ITEMS_MODULE.seams.buildUnit!
const damage = HELD_ITEMS_MODULE.seams.damageHook!
const turnEnd = HELD_ITEMS_MODULE.seams.turnEndTrigger!
const ctx = (over: Parameters<typeof mon>[0] = {}, effectiveness = 1) => ({
  attacker: mon(over),
  defender: mon(),
  effectiveness,
})

describe('M7 道具表', () => {
  it('每個道具有 id/name/icon/desc + 合法 kind', () => {
    for (const d of ITEMS) {
      expect(d.id && d.name && d.icon && d.desc).toBeTruthy()
      expect(['statMod', 'damageHook', 'turnEnd']).toContain(d.kind)
    }
    expect(getItem('headband')?.kind).toBe('statMod')
    expect(getItem('nope')).toBeUndefined()
    expect(getItem(undefined)).toBeUndefined()
  })
})

describe('M7 道具 S1 buildUnit（statMod）', () => {
  it('力量頭帶 atk +30%、博士眼鏡 spa +30%、突擊背心 spd +50%、信念圍巾 spe +30%', () => {
    expect(build(mon({ heldItemId: 'headband', atk: 100 })).atk).toBe(130)
    expect(build(mon({ heldItemId: 'glasses', spa: 100 })).spa).toBe(130)
    expect(build(mon({ heldItemId: 'vest', spd: 100 })).spd).toBe(150)
    expect(build(mon({ heldItemId: 'scarf', spe: 100 })).spe).toBe(130)
  })

  it('非 statMod 道具 / 無道具：能力值不變', () => {
    expect(build(mon({ heldItemId: 'lifeorb', atk: 100 })).atk).toBe(100)
    expect(build(mon({ heldItemId: 'leftovers', atk: 100 })).atk).toBe(100)
    expect(build(mon({ atk: 100 })).atk).toBe(100)
  })
})

describe('M7 道具 S3 damageHook', () => {
  it('生命寶珠：所有傷害 ×1.3', () => {
    expect(damage(ctx({ heldItemId: 'lifeorb' }))).toBeCloseTo(1.3)
  })
  it('達人帶：只對效果絕佳（effectiveness≥2）×1.2，否則 ×1', () => {
    expect(damage(ctx({ heldItemId: 'expertbelt' }, 2))).toBeCloseTo(1.2)
    expect(damage(ctx({ heldItemId: 'expertbelt' }, 1))).toBe(1)
    expect(damage(ctx({ heldItemId: 'expertbelt' }, 0.5))).toBe(1)
  })
  it('無道具 / statMod 道具：傷害倍率 ×1（不誤觸）', () => {
    expect(damage(ctx({}))).toBe(1)
    expect(damage(ctx({ heldItemId: 'headband' }))).toBe(1)
  })
})

describe('M7 道具 S4 turnEnd（剩飯）', () => {
  it('持剩飯且未滿血：回 maxHp/16、就地改 HP、回報 heal event', () => {
    const state = createBattleState([mon({ heldItemId: 'leftovers', maxHp: 160, currentHp: 100 })], [mon()])
    const events = turnEnd({ state, rng: () => 0 })
    expect(events).toHaveLength(1)
    const e = events[0]
    expect(e.type).toBe('heal')
    if (e.type === 'heal') {
      expect(e.side).toBe('player')
      expect(e.amount).toBe(10) // 160/16
      expect(e.hpAfter).toBe(110)
    }
    expect(state.player.members[0].currentHp).toBe(110)
  })

  it('滿血 / 倒下 / 非持有者：不回血', () => {
    const full = createBattleState([mon({ heldItemId: 'leftovers', maxHp: 160, currentHp: 160 })], [mon()])
    expect(turnEnd({ state: full, rng: () => 0 })).toHaveLength(0)

    const fainted = createBattleState([mon({ heldItemId: 'leftovers', maxHp: 160, currentHp: 0 })], [mon()])
    expect(turnEnd({ state: fainted, rng: () => 0 })).toHaveLength(0)

    const none = createBattleState([mon({ maxHp: 160, currentHp: 80 })], [mon()])
    expect(turnEnd({ state: none, rng: () => 0 })).toHaveLength(0)
  })

  it('回血不溢出 maxHp', () => {
    const state = createBattleState([mon({ heldItemId: 'leftovers', maxHp: 32, currentHp: 31 })], [mon()])
    turnEnd({ state, rng: () => 0 })
    expect(state.player.members[0].currentHp).toBe(32)
  })
})

describe('M7 道具掛載閘控（可選式）', () => {
  it('關閉：ext/prep 不收道具縫（零殘留）', () => {
    const reg = [HELD_ITEMS_MODULE]
    const ext = assembleExt(defaultSettings(), reg)
    const prep = assembleBattlePrep(defaultSettings(), reg)
    expect(ext.damageHooks).toHaveLength(0)
    expect(ext.turnEndTriggers).toHaveLength(0)
    expect(prep.buildUnitHooks).toHaveLength(0)
  })

  it('開啟：S1 進 prep、S3/S4 進 ext', () => {
    const on = setModuleEnabledIn(defaultSettings(), 'heldItems', true)
    const reg = [HELD_ITEMS_MODULE]
    const ext = assembleExt(on, reg)
    const prep = assembleBattlePrep(on, reg)
    expect(ext.damageHooks).toHaveLength(1)
    expect(ext.turnEndTriggers).toHaveLength(1)
    expect(prep.buildUnitHooks).toHaveLength(1)
  })
})
