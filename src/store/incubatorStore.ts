// M10 — 孵化 store（mz.incubator.v1）。獨立 slice；孵化才產 canonical OwnedUnit（一次性、決定論）。
// 來源：成就領取（addRewardEgg）/ 重複捕獲轉化（addDuplicateEgg）/ 塔（M11，留 source）。
// 進度：每場戰鬥推進（advance）。孵化＝移蛋 + 入 roster + 登錄圖鑑。

import { create } from 'zustand'
import type { OwnedUnit } from '@/game/types'
import {
  loadIncubator, saveIncubatorState, defaultIncubator,
  addEgg, advanceAll, hatchEgg, isHatchable,
  type IncubatorState, type Egg,
} from '@/game/incubator'
import type { AchievementReward } from '@/game/achievements'
import { useRoster } from '@/store/rosterStore'
import { useMeta } from '@/store/metaStore'

interface IncubatorStore {
  state: IncubatorState
  loaded: boolean
  load: () => void
  /** 成就獎勵 → 蛋（plan/10 §3.3 發獎 action 的副作用入口）。 */
  addRewardEgg: (reward: AchievementReward) => void
  /** 重複捕獲轉化（overflow policy）→ 同種蛋；絕不刪既有個體（plan/10 §5.3.1）。 */
  addDuplicateEgg: (speciesId: number, label?: string) => void
  /** 每場有效戰鬥完成 → 推進所有蛋的孵化進度。 */
  advance: (amount: number) => void
  /** 孵化一顆蛋（達進度才可）：產 OwnedUnit 入 roster + 登錄圖鑑，移除該蛋。回傳孵出個體。 */
  hatch: (eggId: string) => Promise<OwnedUnit | null>
}

export const useIncubator = create<IncubatorStore>((set, get) => {
  const persist = (state: IncubatorState) => { saveIncubatorState(state); set({ state }) }
  return {
    state: defaultIncubator(),
    loaded: false,

    load: () => set({ state: loadIncubator(), loaded: true }),

    addRewardEgg: (reward) => {
      if (reward.kind !== 'egg') return
      persist(addEgg(get().state, { source: 'achievement', speciesPool: reward.speciesPool, label: reward.label }))
    },

    addDuplicateEgg: (speciesId, label = '重複轉化蛋') => {
      persist(addEgg(get().state, { source: 'duplicate', speciesPool: [speciesId], label }))
    },

    advance: (amount) => {
      const next = advanceAll(get().state, amount)
      if (next !== get().state) persist(next)
    },

    hatch: async (eggId) => {
      const egg = get().state.eggs.find((e) => e.id === eggId)
      if (!egg || !isHatchable(egg)) return null
      const unit = hatchEgg(egg)
      const added = await useRoster.getState().addUnit(unit)
      // 先移蛋再回報（exactly-once：同一顆蛋不重複孵化）
      persist({ ...get().state, eggs: get().state.eggs.filter((e: Egg) => e.id !== eggId) })
      if (added) useMeta.getState().recordCapture(added.speciesId, added.shiny)
      return added
    },
  }
})
