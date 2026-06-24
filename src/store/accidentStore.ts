// M11 野外意外的 per-battle reward 旗標（暫態，不持久化、不進 OwnedUnit）。
// encounter 層 roll/補給選擇寫入，ResultScreen 讀取套用（額外經驗 / 捕獲加成）。
// 守鐵律：意外只當 reward modifier，canonical roster 由既有 grantBattleExp/captureUnit 決定論落地。

import { create } from 'zustand'

interface AccidentStore {
  /** 本場勝利額外經驗倍率（luckyBonus 自動 / 補給選 exp）；1＝無加成 */
  expMult: number
  /** 本場捕獲率倍率（補給選 capture）；1＝無加成 */
  captureMult: number
  setExpMult: (m: number) => void
  setCaptureMult: (m: number) => void
  /** 新遭遇重置（避免上一場意外殘留） */
  reset: () => void
}

export const useAccidents = create<AccidentStore>((set) => ({
  expMult: 1,
  captureMult: 1,
  setExpMult: (m) => set({ expMult: m }),
  setCaptureMult: (m) => set({ captureMult: m }),
  reset: () => set({ expMult: 1, captureMult: 1 }),
}))
