// M6.0 — 設定 store：載入 mobie.settings.v1、暴露逐系統開關，並把「已啟用模組」組成 ext 注入戰鬥。
// BattleScreen 讀 `ext` 傳給 resolveTurn；M6 註冊表為空＝ext 為 EMPTY_EXT＝零行為改變。
// 切換模組時同步寫回 localStorage 並重組 ext（低頻事件，走一般 state）。

import { create } from 'zustand'
import {
  loadSettings,
  saveSettings,
  setModuleEnabledIn,
  setInteractModeIn,
  setReplayRecordingIn,
  setAttackInputVariantIn,
  setJuiceIn,
  setHapticsIn,
  type GameSettings,
  type InteractMode,
  type AttackInputVariant,
  type JuiceLevel,
} from '@/game/settings'
import type { ModuleId, ExtBundle, PostGrowthHook } from '@/game/ext/seams'
import { assembleExt, assembleBattlePrep, assemblePostGrowth, type BattlePrep } from '@/store/ext'
import { setHapticsEnabled } from '@/input/haptics'
import { hapticsEnabledOf } from '@/game/settings'

interface SettingsStore {
  settings: GameSettings
  /** 由 settings 組好的戰中注入能力包（S3/S4/S5；模組關閉時為 EMPTY_EXT） */
  ext: ExtBundle
  /** 由 settings 組好的戰前注入包（S1/S2；模組關閉時為 EMPTY_PREP） */
  prep: BattlePrep
  /** 由 settings 組好的戰後縫（S6 進化；模組關閉時為 []） */
  postGrowth: PostGrowthHook[]
  setModuleEnabled: (id: ModuleId, on: boolean) => void
  /** M22 增強互動性 mode（UX 偏好，不參與 ext/prep/postGrowth 注入；低頻、走一般 state） */
  setInteractMode: (mode: InteractMode) => void
  /** M14 是否錄製戰鬥回放（不參與戰鬥注入；低頻、走一般 state） */
  setReplayRecording: (on: boolean) => void
  /** M22.g 攻擊輸入變體（連打/節奏；UX 偏好，不參與戰鬥注入） */
  setAttackInputVariant: (variant: AttackInputVariant) => void
  /** EXT.1 打擊感強度（UX 偏好，純 display；不參與戰鬥注入） */
  setJuice: (juice: JuiceLevel) => void
  /** EXT.1 觸覺回饋開關（UX 偏好，純 display；不參與戰鬥注入） */
  setHaptics: (on: boolean) => void
}

export const useSettings = create<SettingsStore>((set, get) => {
  const settings = loadSettings()
  setHapticsEnabled(hapticsEnabledOf(settings)) // EXT.1：開機即同步觸覺總開關到 haptics 模組
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
    setInteractMode: (mode) => {
      // prefs 不參與戰鬥注入 → 不重組 ext/prep/postGrowth，只更新 settings + 寫回 localStorage。
      const next = setInteractModeIn(get().settings, mode)
      saveSettings(next)
      set({ settings: next })
    },
    setReplayRecording: (on) => {
      const next = setReplayRecordingIn(get().settings, on)
      saveSettings(next)
      set({ settings: next })
    },
    setAttackInputVariant: (variant) => {
      const next = setAttackInputVariantIn(get().settings, variant)
      saveSettings(next)
      set({ settings: next })
    },
    setJuice: (juice) => {
      const next = setJuiceIn(get().settings, juice)
      saveSettings(next)
      set({ settings: next })
    },
    setHaptics: (on) => {
      const next = setHapticsIn(get().settings, on)
      saveSettings(next)
      setHapticsEnabled(hapticsEnabledOf(next)) // 同步到 haptics 模組（off 時全程 no-op）
      set({ settings: next })
    },
  }
})
