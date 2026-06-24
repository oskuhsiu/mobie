// M11 連勝塔純邏輯測試（決定論 foe 生成 / 等級·難度·獎勵 scaling / boss 樓層）。
import { describe, it, expect } from 'vitest'
import { towerFoeTeam, floorReward, isBossFloor, baseLevelForFloor, ASCENSIONS, getAscension, towerExpMult } from './tower'
import { MAX_LEVEL } from './growth'
import { SPECIES } from '@/game/data/species'

describe('M11 連勝塔', () => {
  it('towerFoeTeam：決定論（同 seed/樓/階 → 同隊）', () => {
    const a = towerFoeTeam(3, 1, 'run-x')
    const b = towerFoeTeam(3, 1, 'run-x')
    expect(a).toEqual(b)
  })

  it('towerFoeTeam：3 隻、皆合法種族、末隻等級最高', () => {
    const team = towerFoeTeam(4, 0, 'r')
    expect(team).toHaveLength(3)
    expect(team.every((c) => SPECIES[c.speciesId])).toBe(true)
    expect(team[2].level).toBeGreaterThanOrEqual(team[0].level)
  })

  it('樓層 / ascension 越高，foe 等級越高（封頂 MAX_LEVEL）', () => {
    const low = towerFoeTeam(1, 0, 'r')[0].level
    const deep = towerFoeTeam(20, 0, 'r')[0].level
    const ascended = towerFoeTeam(1, 4, 'r')[0].level
    expect(deep).toBeGreaterThan(low)
    expect(ascended).toBeGreaterThan(low)
    expect(towerFoeTeam(50, 4, 'r')[0].level).toBeLessThanOrEqual(MAX_LEVEL)
  })

  it('boss 樓層（每 5 層）：用強敵池（種族值偏高）', () => {
    expect(isBossFloor(5)).toBe(true)
    expect(isBossFloor(10)).toBe(true)
    expect(isBossFloor(3)).toBe(false)
    const bstOf = (id: number) => { const b = SPECIES[id].baseStats; return b.hp + b.atk + b.def + b.spa + b.spd + b.spe }
    const bossAvg = towerFoeTeam(5, 0, 'r').reduce((s, c) => s + bstOf(c.speciesId), 0) / 3
    expect(bossAvg).toBeGreaterThan(440) // 強敵池應明顯高於平均（全 dex 平均 ~410）
  })

  it('baseLevelForFloor 單調遞增、封頂', () => {
    expect(baseLevelForFloor(1)).toBe(8)
    expect(baseLevelForFloor(5)).toBeGreaterThan(baseLevelForFloor(1))
    expect(baseLevelForFloor(200)).toBe(MAX_LEVEL)
  })

  it('floorReward：隨樓層/ascension 遞增、boss 加碼', () => {
    expect(floorReward(2, 0).sp).toBeGreaterThan(0)
    expect(floorReward(10, 0).sp).toBeGreaterThan(floorReward(2, 0).sp)
    expect(floorReward(10, 2).sp).toBeGreaterThan(floorReward(10, 0).sp)
    expect(floorReward(5, 0).sp).toBeGreaterThan(floorReward(4, 0).sp) // boss(5) 含加碼
  })

  it('ASCENSIONS：levelBonus 單調遞增；getAscension 夾界', () => {
    for (let i = 1; i < ASCENSIONS.length; i++) {
      expect(ASCENSIONS[i].levelBonus).toBeGreaterThan(ASCENSIONS[i - 1].levelBonus)
    }
    expect(getAscension(-1)).toEqual(ASCENSIONS[0])
    expect(getAscension(99)).toEqual(ASCENSIONS[ASCENSIONS.length - 1])
  })

  it('towerExpMult：隨樓層微升、封頂 2', () => {
    expect(towerExpMult(1)).toBeGreaterThanOrEqual(1)
    expect(towerExpMult(50)).toBeLessThanOrEqual(2)
    expect(towerExpMult(10)).toBeGreaterThan(towerExpMult(1))
  })
})
