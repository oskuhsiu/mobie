// M10 — 成就（Achievements）。設計真相：plan/10 §3.3。
//
// 成就判定純由 meta（registered/stats）派生（computeAchievements）；領取狀態存 meta.achievements。
// 發獎走明確 action `claimAchievementReward(id)` → 產 egg（incubator 入口；plan/10 §3.3）——
// **不在圖鑑讀取時自動寫入**，副作用可測、可防重領。本檔只定義「成就 + 進度 + 獎勵描述」純資料/純函數；
// 實際把 egg 寫入 incubator 由 metaStore.claimAchievement 接 incubatorStore 完成。

import type { OwnedUnit } from '@/game/types'
import type { MetaState } from '@/game/meta'

/** 成就獎勵：一顆蛋（incubator 來源 'achievement'）。speciesPool＝可孵出的物種池。 */
export interface AchievementReward {
  kind: 'egg'
  label: string
  speciesPool: number[]
}

export interface AchievementDef {
  id: string
  name: string
  icon: string
  desc: string
  target: number
  /** 由 meta 取目前進度值（與 target 比較判定解鎖）。 */
  progress: (meta: MetaState) => number
  reward: AchievementReward
}

// 獎勵物種池（皆 ≤251、合法 dex；主題化但保持簡單）
const STARTERS = [1, 4, 7, 152, 155, 158]
const COMMON = [10, 13, 16, 19, 21, 25, 29, 32, 161, 163, 165, 167]
const STRONG = [59, 62, 68, 130, 142, 149]
const RARE = [144, 145, 146, 150, 151, 243, 244, 245, 249, 250, 251]

export const ACHIEVEMENTS: AchievementDef[] = [
  { id: 'firstcatch', name: '初次收服', icon: '🎯', desc: '收服第一隻寶可夢', target: 1, progress: (m) => m.stats.captures, reward: { kind: 'egg', label: '新手蛋', speciesPool: STARTERS } },
  { id: 'catch10', name: '收藏家', icon: '🧺', desc: '累計收服 10 隻', target: 10, progress: (m) => m.stats.captures, reward: { kind: 'egg', label: 'common 蛋', speciesPool: COMMON } },
  { id: 'dex25', name: '圖鑑見習', icon: '📘', desc: '圖鑑登錄 25 種', target: 25, progress: (m) => m.registered.length, reward: { kind: 'egg', label: '探索蛋', speciesPool: COMMON } },
  { id: 'dex60', name: '圖鑑達人', icon: '📗', desc: '圖鑑登錄 60 種', target: 60, progress: (m) => m.registered.length, reward: { kind: 'egg', label: '稀有蛋', speciesPool: RARE } },
  { id: 'win20', name: '百戰之路', icon: '⚔️', desc: '野外勝利 20 場', target: 20, progress: (m) => m.stats.wins, reward: { kind: 'egg', label: '勇者蛋', speciesPool: STRONG } },
  { id: 'evolve5', name: '進化見證', icon: '🧬', desc: '完成 5 次進化', target: 5, progress: (m) => m.stats.evolutions, reward: { kind: 'egg', label: '演化蛋', speciesPool: COMMON } },
  { id: 'shiny1', name: '幸運之星', icon: '✦', desc: '收服第一隻異色', target: 1, progress: (m) => m.stats.shinies, reward: { kind: 'egg', label: '閃耀蛋', speciesPool: RARE } },
]

export const getAchievement = (id: string): AchievementDef | undefined => ACHIEVEMENTS.find((a) => a.id === id)

export interface AchievementView {
  def: AchievementDef
  progress: number
  target: number
  unlocked: boolean
  claimed: boolean
}

/** 純函數：產每個成就的進度展示（unlocked＝progress≥target；claimed＝meta 有 claimedAt）。 */
export function computeAchievements(meta: MetaState, _roster: OwnedUnit[] = []): AchievementView[] {
  return ACHIEVEMENTS.map((def) => {
    const progress = Math.min(def.progress(meta), def.target)
    return {
      def,
      progress,
      target: def.target,
      unlocked: progress >= def.target,
      claimed: meta.achievements[def.id] !== undefined,
    }
  })
}

/** 可領取數（已解鎖但未領取），給入口紅點。 */
export function claimableCount(meta: MetaState): number {
  return computeAchievements(meta).filter((a) => a.unlocked && !a.claimed).length
}
