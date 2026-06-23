// M10 — 圖鑑/成就 meta（三層語義）測試。證明 registered 單調（進化不倒退）、seen/owned 分離、
// stats 累計、claim 防重領、migrate 防壞檔；achievements 純派生進度。
import { describe, it, expect } from 'vitest'
import {
  defaultMeta, addRegistered, addSeen, bumpStat, markClaimed,
  currentlyOwnedSpecies, dexStateOf, migrateMeta,
} from './meta'
import { computeAchievements, claimableCount } from './achievements'
import type { OwnedUnit } from '@/game/types'

const unit = (speciesId: number): OwnedUnit => ({
  id: `u${speciesId}`, speciesId, level: 5, exp: 125,
  ivs: { hp: 10, atk: 10, def: 10, spa: 10, spd: 10, spe: 10 }, nature: 0, seed: `u${speciesId}`, shiny: false,
})

describe('M10 meta — registered 單調 / seen / owned 三層', () => {
  it('addRegistered 去重排序、無新增回原物件', () => {
    const m0 = defaultMeta()
    const m1 = addRegistered(m0, [3, 1, 2, 1])
    expect(m1.registered).toEqual([1, 2, 3])
    expect(addRegistered(m1, [1, 2])).toBe(m1) // 無新增 → 同參照（store 據此略過存檔）
  })
  it('進化不讓圖鑑倒退：登錄低階 + 進化後高階，兩者都留在 registered', () => {
    let m = addRegistered(defaultMeta(), [1]) // 曾捕妙蛙種子
    m = addRegistered(m, [3]) // 進化成妙蛙花 → 登錄 3
    expect(m.registered).toContain(1) // 1 不被移除（單調）
    expect(m.registered).toContain(3)
  })
  it('addSeen 不記已 registered 者', () => {
    let m = addRegistered(defaultMeta(), [5])
    m = addSeen(m, [5, 6])
    expect(m.seen).toEqual([6]) // 5 已 registered → 不重複記 seen
  })
  it('dexStateOf：owned > registered > seen > unseen', () => {
    let m = addRegistered(defaultMeta(), [10])
    m = addSeen(m, [20])
    const owned = currentlyOwnedSpecies([unit(30)])
    expect(dexStateOf(30, m, owned)).toBe('owned')
    expect(dexStateOf(10, m, owned)).toBe('registered')
    expect(dexStateOf(20, m, owned)).toBe('seen')
    expect(dexStateOf(99, m, owned)).toBe('unseen')
  })
})

describe('M10 meta — stats / claim / migrate', () => {
  it('bumpStat 累加', () => {
    const m = bumpStat(bumpStat(defaultMeta(), 'captures'), 'captures', 4)
    expect(m.stats.captures).toBe(5)
  })
  it('markClaimed 防重領（已領取回原物件）', () => {
    const m1 = markClaimed(defaultMeta(), 'firstcatch', 100)
    expect(m1.achievements.firstcatch).toBe(100)
    expect(markClaimed(m1, 'firstcatch', 200)).toBe(m1) // 不覆蓋已領取
  })
  it('migrateMeta 防壞檔：非物件回預設、過濾非數字、夾欄位', () => {
    expect(migrateMeta(null)).toEqual(defaultMeta())
    const m = migrateMeta({ registered: [1, 'x', 2, 2], seen: 'bad', stats: { wins: 3, junk: 9 }, achievements: { a: 5, b: 'no' } })
    expect(m.registered).toEqual([1, 2])
    expect(m.seen).toEqual([])
    expect(m.stats.wins).toBe(3)
    expect(m.achievements).toEqual({ a: 5 })
  })
})

describe('M10 成就 — 進度派生 / 可領取', () => {
  it('未達標 unlocked=false、達標=true；claimed 反映 meta', () => {
    let m = defaultMeta()
    let views = computeAchievements(m)
    const first = views.find((v) => v.def.id === 'firstcatch')!
    expect(first.unlocked).toBe(false)
    m = bumpStat(m, 'captures')
    views = computeAchievements(m)
    expect(views.find((v) => v.def.id === 'firstcatch')!.unlocked).toBe(true)
    m = markClaimed(m, 'firstcatch', 1)
    expect(computeAchievements(m).find((v) => v.def.id === 'firstcatch')!.claimed).toBe(true)
  })
  it('progress 夾在 target（不超過）', () => {
    const m = bumpStat(defaultMeta(), 'captures', 999)
    const first = computeAchievements(m).find((v) => v.def.id === 'firstcatch')!
    expect(first.progress).toBe(first.target)
  })
  it('claimableCount＝已解鎖未領取數', () => {
    let m = bumpStat(defaultMeta(), 'captures', 10) // 解鎖 firstcatch + catch10
    expect(claimableCount(m)).toBe(2)
    m = markClaimed(m, 'firstcatch', 1)
    expect(claimableCount(m)).toBe(1)
  })
})
