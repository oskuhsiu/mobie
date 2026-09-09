// M11 野外意外的 per-battle reward 旗標（暫態，不持久化、不進 OwnedUnit）。
// encounter 層 roll/補給選擇寫入，ResultScreen 讀取套用（額外經驗 / 捕獲加成）。
// 守鐵律：意外只當 reward modifier，canonical roster 由既有 grantBattleExp/captureUnit 決定論落地。

import { create } from 'zustand'
import type { SupplyKind } from '@/game/accidents'

interface AccidentStore {
  /** 本場勝利額外經驗倍率（luckyBonus 自動 / 補給選 exp）；1＝無加成 */
  expMult: number
  /** 本場捕獲率倍率（補給選 capture）；1＝無加成 */
  captureMult: number
  /** Stable identity for the active encounter; lets Encounter remount without re-granting supply. */
  encounterKey: string | null
  /** The one supply choice completed for the active encounter, if any. */
  supplyKind: SupplyKind | null
  setExpMult: (m: number) => void
  setCaptureMult: (m: number) => void
  beginEncounter: (key: string, luckyExpMult: number) => void
  chooseSupply: (kind: SupplyKind) => void
  /** 新遭遇重置（避免上一場意外殘留） */
  reset: () => void
}

export const useAccidents = create<AccidentStore>((set) => ({
  expMult: 1,
  captureMult: 1,
  encounterKey: null,
  supplyKind: null,
  setExpMult: (m) => set({ expMult: m }),
  setCaptureMult: (m) => set({ captureMult: m }),
  beginEncounter: (key, luckyExpMult) => set((state) => state.encounterKey === key
    ? state
    : { encounterKey: key, supplyKind: null, expMult: luckyExpMult, captureMult: 1 }),
  chooseSupply: (kind) => set((state) => {
    if (state.supplyKind !== null) return state
    if (kind === 'sp') return { supplyKind: kind }
    if (kind === 'exp') return { supplyKind: kind, expMult: Math.max(state.expMult, 1.5) }
    return { supplyKind: kind, captureMult: 1.3 }
  }),
  reset: () => set({ expMult: 1, captureMult: 1, encounterKey: null, supplyKind: null }),
}))
