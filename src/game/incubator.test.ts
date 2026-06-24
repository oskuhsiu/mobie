// M10 — 孵化（incubator）測試。證明：egg 只存 seed/pool/progress（不存預生成結果）、決定論 id/seed、
// advance 夾頂、hatch 決定論產 canonical OwnedUnit（種類由 seed 定）、migrate 防壞檔。
import { describe, it, expect } from 'vitest'
import {
  defaultIncubator, addEgg, advanceAll, isHatchable, hatchEgg, migrateIncubator, HATCH_LEVEL,
} from './incubator'

describe('M10 孵化 — addEgg 決定論 / 防線', () => {
  it('新增蛋：id/seed 決定論遞增、progress 0、不存預生成結果', () => {
    let s = defaultIncubator()
    s = addEgg(s, { source: 'achievement', speciesPool: [1, 4, 7], label: '新手蛋' })
    expect(s.eggs).toHaveLength(1)
    const e = s.eggs[0]
    expect(e.id).toBe('egg-1')
    expect(e.seed).toBe('egg-1-achievement')
    expect(e.progress).toBe(0)
    expect(e).not.toHaveProperty('result') // 不預存孵化結果
    s = addEgg(s, { source: 'duplicate', speciesPool: [25], label: 'B' })
    expect(s.eggs[1].id).toBe('egg-2') // nextId 遞增
  })
  it('speciesPool 過濾後為空 → 不新增（回原 state）', () => {
    const s = defaultIncubator()
    expect(addEgg(s, { source: 'achievement', speciesPool: [0, -1], label: 'X' })).toBe(s)
  })
})

describe('M10 孵化 — advance / hatchable', () => {
  it('advanceAll 推進所有蛋、夾在 requiredProgress', () => {
    let s = defaultIncubator()
    s = addEgg(s, { source: 'tower', speciesPool: [1], label: 'T' }) // required=5
    s = advanceAll(s, 3)
    expect(s.eggs[0].progress).toBe(3)
    expect(isHatchable(s.eggs[0])).toBe(false)
    s = advanceAll(s, 10)
    expect(s.eggs[0].progress).toBe(5) // 夾頂
    expect(isHatchable(s.eggs[0])).toBe(true)
  })
  it('無蛋 / amount≤0 回原 state', () => {
    const s = defaultIncubator()
    expect(advanceAll(s, 5)).toBe(s)
    const s2 = addEgg(s, { source: 'tower', speciesPool: [1], label: 'T' })
    expect(advanceAll(s2, 0)).toBe(s2)
  })
})

describe('M10 孵化 — hatchEgg 決定論產 OwnedUnit', () => {
  it('種類由 seed 在 pool 內決定、起始等級 HATCH_LEVEL、同蛋同結果', () => {
    let s = defaultIncubator()
    s = addEgg(s, { source: 'achievement', speciesPool: [1, 4, 7, 25], label: 'X' })
    const egg = s.eggs[0]
    const u1 = hatchEgg(egg)
    const u2 = hatchEgg(egg)
    expect([1, 4, 7, 25]).toContain(u1.speciesId)
    expect(u1.level).toBe(HATCH_LEVEL)
    expect(u1).toEqual(u2) // 決定論：同蛋同個體
    expect(u1.seed).toBe(egg.seed)
  })
  it('單一物種池 → 必孵該種', () => {
    let s = defaultIncubator()
    s = addEgg(s, { source: 'duplicate', speciesPool: [143], label: '卡比獸蛋' })
    expect(hatchEgg(s.eggs[0]).speciesId).toBe(143)
  })
})

describe('M10 孵化 — migrate 防壞檔', () => {
  it('非物件回預設；過濾無 id/seed/pool 的壞蛋', () => {
    expect(migrateIncubator(null)).toEqual(defaultIncubator())
    const m = migrateIncubator({
      eggs: [
        { id: 'egg-1', seed: 's1', source: 'tower', speciesPool: [1], progress: 2, requiredProgress: 5, label: 'A' },
        { id: 'bad' }, // 缺 seed/pool → 丟棄
        { seed: 'x', speciesPool: [] }, // 空池 → 丟棄
      ],
      nextId: 9,
    })
    expect(m.eggs).toHaveLength(1)
    expect(m.nextId).toBe(9)
  })
})

// ── M12.c 蛋招繼承 ───────────────────────────────────────────────
import { teachableOf } from './learnset'
import { getSpecies } from './data/species'

describe('M12.c 蛋招繼承', () => {
  it('addEgg 帶 inheritedMoveId → 存進蛋；非法值不存', () => {
    let s = addEgg(defaultIncubator(), { source: 'duplicate', speciesPool: [1], label: 'x', inheritedMoveId: 2000 })
    expect(s.eggs[0].inheritedMoveId).toBe(2000)
    s = addEgg(s, { source: 'duplicate', speciesPool: [1], label: 'y', inheritedMoveId: -5 })
    expect(s.eggs[1].inheritedMoveId).toBeUndefined()
    s = addEgg(s, { source: 'duplicate', speciesPool: [1], label: 'z' })
    expect(s.eggs[2].inheritedMoveId).toBeUndefined()
  })

  it('hatch：可學的蛋招落入 learnedMoveIds；不可學的不落', () => {
    const teach = teachableOf(getSpecies(1))
    expect(teach.length).toBeGreaterThan(0)
    const learnable = teach[teach.length - 1] // 取一個高階可學招（孵化等級多半還沒學會）
    const eggOk = { id: 'egg-1', seed: 'egg-1-duplicate', source: 'duplicate' as const, speciesPool: [1], progress: 8, requiredProgress: 8, label: 'x', inheritedMoveId: learnable }
    const u = hatchEgg(eggOk)
    expect(u.speciesId).toBe(1)
    expect(u.learnedMoveIds).toContain(learnable)

    // 不可學的招（用一個不在 teachable 池的大 id）→ 不落
    const bogus = 9_999_999
    expect(teach.includes(bogus)).toBe(false)
    const eggBad = { ...eggOk, seed: 'egg-2-duplicate', inheritedMoveId: bogus }
    expect(hatchEgg(eggBad).learnedMoveIds).not.toContain(bogus)
  })
})
