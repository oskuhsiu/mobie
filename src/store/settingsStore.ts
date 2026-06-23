// M6.0 — 設定 store：載入 mz.settings.v1、暴露逐系統開關，並把「已啟用模組」組成 ext 注入戰鬥。
// BattleScreen 讀 `ext` 傳給 resolveTurn；M6 註冊表為空＝ext 為 EMPTY_EXT＝零行為改變。
// 切換模組時同步寫回 localStorage 並重組 ext（低頻事件，走一般 state）。

import { create } from 'zustand'
import {
  loadSettings,
  saveSettings,
  setModuleEnabledIn,
  type GameSettings,
} from '@/game/settings'
import type { ModuleId, ExtBundle, PostGrowthHook } from '@/game/ext/seams'
import { assembleExt, assembleBattlePrep, assemblePostGrowth, type BattlePrep } from '@/store/ext'

interface SettingsStore {
  settings: GameSettings
  /** 由 settings 組好的戰中注入能力包（S3/S4/S5；模組關閉時為 EMPTY_EXT） */
  ext: ExtBundle
  /** 由 settings 組好的戰前注入包（S1/S2；模組關閉時為 EMPTY_PREP） */
  prep: BattlePrep
  /** 由 settings 組好的戰後縫（S6 進化；模組關閉時為 []） */
  postGrowth: PostGrowthHook[]
  setModuleEnabled: (id: ModuleId, on: boolean) => void
}

export const useSettings = create<SettingsStore>((set, get) => {
  const settings = loadSettings()
  return {
    settings,
    ext: assembleExt(settings),
    prep: assembleBattlePrep(settings),
    postGrowth: assemblePostGrowth(settings),
    setModuleEnabled: (id, on) => {
      const next = setModuleEnabledIn(get().settings, id, on)
      saveSettings(next)
      set({ settings: next, ext: assembleExt(next), prep: assembleBattlePrep(next), postGrowth: assemblePostGrowth(next) })
    },
  }
})
