// M11 連勝塔（plan/09 §13 / plan/14）——耐久連勝梯：連續 escalating 戰鬥，輸一場即結束，
// 依到達樓層給 SP/經驗，內建 Ascension 難度（靜態 levelBonus pre-bake 進 foe 等級）。
//
// 守鐵律：①只存 canonical OwnedUnit（塔 run 是 XState context 暫態、meta 進度另 slice）
// ②foe 生成決定論（seed）③reducer/engine 零分叉——塔戰鬥就是一般戰鬥（foe 等級由此模組算）。
//
// 註：完整 roguelike 地圖節點（商店/營火/分支）為日後擴充；本版聚焦「連勝 + 難度階 + 深度獎勵」核心。

import type { Card } from '@/game/types'
import { SPECIES } from '@/game/data/species'
import { hashSeed, mulberry32 } from '@/game/individual'
import { MAX_LEVEL } from '@/game/growth'

/** 難度階（Ascension）：靜態 levelBonus 加在 foe 等級上（pre-bake，不走 ext、不新增戰鬥規則）。 */
export interface AscensionTier {
  level: number
  name: string
  levelBonus: number
}
export const ASCENSIONS: AscensionTier[] = [
  { level: 0, name: '見習', levelBonus: 0 },
  { level: 1, name: '熟練', levelBonus: 6 },
  { level: 2, name: '精英', levelBonus: 14 },
  { level: 3, name: '大師', levelBonus: 24 },
  { level: 4, name: '傳說', levelBonus: 36 },
]
export const getAscension = (lv: number): AscensionTier => ASCENSIONS[Math.max(0, Math.min(ASCENSIONS.length - 1, lv))]

const bstOf = (id: number): number => {
  const b = SPECIES[id].baseStats
  return b.hp + b.atk + b.def + b.spa + b.spd + b.spe
}
const ALL_IDS = Object.keys(SPECIES).map(Number)
// boss 樓層的強敵池（種族值前 40 強）
const HIGH_BST_IDS = [...ALL_IDS].sort((a, b) => bstOf(b) - bstOf(a)).slice(0, 40)

/** 樓層基礎等級（每層 +3，封頂 MAX_LEVEL）。 */
export const baseLevelForFloor = (floor: number): number => Math.min(MAX_LEVEL, 8 + (floor - 1) * 3)

/** 樓層類型：每 5 層為 boss 關（強敵池 + 稍高等級）。 */
export const isBossFloor = (floor: number): boolean => floor % 5 === 0

/**
 * 生成某樓層的對手隊伍（3 隻，決定論依 seed）。等級＝樓層基礎 + ascension levelBonus；
 * boss 關用強敵池 + 末隻再加成。塔 run 內每樓 seed 穩定（同一 run 重看相同）。
 */
export function towerFoeTeam(floor: number, ascension: number, runSeed: string): Card[] {
  const rng = mulberry32(hashSeed(`tower|${runSeed}|${floor}|${ascension}`))
  const tier = getAscension(ascension)
  const boss = isBossFloor(floor)
  const lvl = Math.min(MAX_LEVEL, baseLevelForFloor(floor) + tier.levelBonus)
  const pool = boss ? HIGH_BST_IDS : ALL_IDS
  return Array.from({ length: 3 }, (_, i) => {
    const sid = pool[Math.floor(rng() * pool.length)]
    const memberLvl = Math.min(MAX_LEVEL, lvl + (i === 2 ? (boss ? 4 : 2) : 0)) // 末隻最強
    return { cardId: `TOWER-${runSeed}-${floor}-${ascension}-${sid}-${i}`, speciesId: sid, level: memberLvl }
  })
}

/** 通過某樓層的 SP 獎勵（boss 關加碼；ascension 越高越多）。 */
export function floorReward(floor: number, ascension: number): { sp: number } {
  const base = Math.max(1, Math.floor(floor / 2))
  const bossBonus = isBossFloor(floor) ? 3 : 0
  return { sp: base + bossBonus + ascension }
}

/** 結算經驗倍率：塔內擊敗較強敵，給比一般稍高的經驗倍率（依樓層微升，封頂）。 */
export function towerExpMult(floor: number): number {
  return Math.min(2, 1 + floor * 0.04)
}
