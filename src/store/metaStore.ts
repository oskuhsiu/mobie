// M10 — 圖鑑/成就 meta store（mz.meta.v1）。在 canonical 事件點（看到/收服/勝利/進化）更新 meta，
// 獨立 store、**不寫 roster**（plan/10 §3.2）。claim 走明確 action（exactly-once、防重領）。

import { create } from 'zustand'
import type { OwnedUnit } from '@/game/types'
import {
  loadMeta,
  saveMetaState,
  defaultMeta,
  addRegistered,
  addSeen,
  bumpStat,
  markClaimed,
  currentlyOwnedSpecies,
  type MetaState,
} from '@/game/meta'
import { computeAchievements, getAchievement, type AchievementReward } from '@/game/achievements'

interface MetaStore {
  meta: MetaState
  loaded: boolean
  /** 載入 meta，並用當前 roster 回填 registered（起始隊伍/既有收藏計入「已捕」）。 */
  load: (roster: OwnedUnit[]) => void
  /** 遭遇/看到一批物種（未登錄者記為 seen）。 */
  recordSeen: (speciesIds: number[]) => void
  /** 收服一隻：registered + captures(+shiny)。 */
  recordCapture: (speciesId: number, shiny: boolean) => void
  /** 勝利：依 mode 累加 wins / arenaWins。 */
  recordWin: (mode: 'arena' | 'wild') => void
  /** 進化：登錄進化後物種 + evolutions 計數。 */
  recordEvolutions: (events: { toSpecies: number }[]) => void
  /** 領取成就獎勵（exactly-once）：已解鎖且未領取才標記+回傳 reward（給 incubator 產蛋）；否則 null。 */
  claimAchievement: (id: string) => AchievementReward | null
}

export const useMeta = create<MetaStore>((set, get) => {
  // 共用提交：meta 無變動（同參照）則略過存檔（純更新函數無新增時回原物件）
  const commit = (meta: MetaState) => {
    if (meta === get().meta) return
    saveMetaState(meta)
    set({ meta })
  }
  return {
    meta: defaultMeta(),
    loaded: false,

    load: (roster) => {
      const meta = addRegistered(loadMeta(), [...currentlyOwnedSpecies(roster)])
      saveMetaState(meta)
      set({ meta, loaded: true })
    },

    recordSeen: (speciesIds) => commit(addSeen(get().meta, speciesIds)),

    recordCapture: (speciesId, shiny) => {
      let meta = bumpStat(addRegistered(get().meta, [speciesId]), 'captures')
      if (shiny) meta = bumpStat(meta, 'shinies')
      commit(meta)
    },

    recordWin: (mode) => commit(bumpStat(get().meta, mode === 'arena' ? 'arenaWins' : 'wins')),

    recordEvolutions: (events) => {
      if (events.length === 0) return
      const meta = bumpStat(addRegistered(get().meta, events.map((e) => e.toSpecies)), 'evolutions', events.length)
      commit(meta)
    },

    claimAchievement: (id) => {
      const def = getAchievement(id)
      if (!def) return null
      const view = computeAchievements(get().meta).find((a) => a.def.id === id)
      if (!view || !view.unlocked || view.claimed) return null // 防重領 / 未解鎖
      commit(markClaimed(get().meta, id, Date.now()))
      return def.reward
    },
  }
})
