// M19.e 招式訓練所 + SP 經濟：learnset 訓練助手 + SP 錢包純邏輯測試。
import { describe, it, expect } from 'vitest'
import { effectiveLearnedMoves, newlyLearned, teachableNotLearned, learnedAtLevel, teachableOf } from './learnset'
import { getSpecies } from '@/game/data/species'
import { useSkillPoints } from '@/store/skillPointsStore'

const bulba = getSpecies(1) // grass/poison，特攻向 → L24 學瞑想
const pika = getSpecies(25) // electric，物理向 → L24 學劍舞

describe('M19.e learnset 訓練助手', () => {
  it('effectiveLearnedMoves：缺省 learnedMoveIds → 依等級派生領悟', () => {
    const eff = effectiveLearnedMoves({ learnedMoveIds: undefined, level: 30 }, bulba)
    expect(eff).toEqual(learnedAtLevel(bulba, 30))
  })

  it('effectiveLearnedMoves：已物化 learnedMoveIds → 直接回該集', () => {
    const set = [bulba.moveId, 9999]
    const eff = effectiveLearnedMoves({ learnedMoveIds: set, level: 5 }, bulba)
    expect(eff).toEqual(set)
  })

  it('newlyLearned：升級跨領悟點 → 回新招差集；同級 → 空', () => {
    const gained = newlyLearned(bulba, 1, 40)
    expect(gained.length).toBeGreaterThan(0)
    // 差集：低級已會的不應出現
    const before = new Set(learnedAtLevel(bulba, 1))
    expect(gained.every((id) => !before.has(id))).toBe(true)
    expect(newlyLearned(bulba, 40, 40)).toEqual([])
    expect(newlyLearned(bulba, 50, 40)).toEqual([]) // 不降級
  })

  it('newlyLearned：含變化招（L20 自我再生 / L24 增益）', () => {
    const gained = newlyLearned(bulba, 1, 30)
    // 變化招 id 2000+ 應在 1→30 的新領悟中
    expect(gained.some((id) => id >= 2000)).toBe(true)
  })

  it('teachableNotLearned：低級單位有「可學未學」的高階招、且不含已學', () => {
    const lowUnit = { learnedMoveIds: undefined, level: 5 }
    const notLearned = teachableNotLearned(lowUnit, pika)
    const learned = new Set(learnedAtLevel(pika, 5))
    expect(notLearned.every((id) => !learned.has(id))).toBe(true)
    expect(notLearned.every((id) => teachableOf(pika).includes(id))).toBe(true)
    expect(notLearned.length).toBeGreaterThan(0)
  })
})

describe('M19.e SP 錢包（mobie.skillpoints.v1）', () => {
  it('add 累加、spend 足額扣款、不足回 false 不扣', () => {
    const sp = useSkillPoints.getState()
    const start = sp.sp
    sp.add(10)
    expect(useSkillPoints.getState().sp).toBe(start + 10)
    expect(useSkillPoints.getState().spend(4)).toBe(true)
    expect(useSkillPoints.getState().sp).toBe(start + 6)
    const before = useSkillPoints.getState().sp
    expect(useSkillPoints.getState().spend(before + 1)).toBe(false) // 餘額不足
    expect(useSkillPoints.getState().sp).toBe(before) // 不扣
  })

  it('add 非正值忽略、spend(0) 視為成功', () => {
    const sp = useSkillPoints.getState()
    const start = sp.sp
    sp.add(-5)
    sp.add(0)
    expect(useSkillPoints.getState().sp).toBe(start)
    expect(useSkillPoints.getState().spend(0)).toBe(true)
  })
})
