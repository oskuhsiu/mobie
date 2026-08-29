// Runtime preference store. Fixed battle capabilities live in game/ext/productRuntime.

import { create } from 'zustand'
import {
  loadSettings,
  saveSettings,
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
import { setHapticsEnabled } from '@/input/haptics'
import { hapticsEnabledOf } from '@/game/settings'

interface SettingsStore {
  settings: GameSettings
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
    setInteractMode: (mode) => {
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
