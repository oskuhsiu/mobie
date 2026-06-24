// M11 連勝塔 meta 進度（mobie.run.v1）——只存「歷史最高樓層 + 已解鎖 ascension」。
// 守鐵律：run 防火牆——進行中的 run 狀態（樓層/隊伍/HP）住 XState context 暫態、不逆寫 OwnedUnit；
// 本 slice 只存通關後的 meta 成就（持久），run 內結算的 EXP/SP 走既有 rosterStore/skillPointsStore。

import { create } from 'zustand'
import { ASCENSIONS } from '@/game/tower'

const KEY = 'mobie.run.v1'

interface Persisted {
  bestFloor: number
  ascensionUnlocked: number
}

function load(): Persisted {
  const def: Persisted = { bestFloor: 0, ascensionUnlocked: 0 }
  if (typeof localStorage === 'undefined') return def
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return def
    const o = JSON.parse(raw)
    return {
      bestFloor: typeof o?.bestFloor === 'number' && o.bestFloor >= 0 ? Math.floor(o.bestFloor) : 0,
      ascensionUnlocked: typeof o?.ascensionUnlocked === 'number' ? Math.max(0, Math.min(ASCENSIONS.length - 1, Math.floor(o.ascensionUnlocked))) : 0,
    }
  } catch {
    return def
  }
}

function save(p: Persisted): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, JSON.stringify(p))
  } catch {
    /* 配額/隱私模式：忽略 */
  }
}

interface RunStore {
  bestFloor: number
  ascensionUnlocked: number
  /** run 結束時記錄到達樓層（只增不減）。 */
  recordFloor: (floor: number) => void
  /** 通過 boss 樓層 → 解鎖下一 ascension 階（封頂 ASCENSIONS 末階）。 */
  unlockAscension: (lv: number) => void
}

export const useRun = create<RunStore>((set, get) => ({
  ...load(),

  recordFloor: (floor) => {
    if (floor <= get().bestFloor) return
    const next = { bestFloor: floor, ascensionUnlocked: get().ascensionUnlocked }
    set(next)
    save(next)
  },

  unlockAscension: (lv) => {
    const target = Math.min(ASCENSIONS.length - 1, lv)
    if (target <= get().ascensionUnlocked) return
    const next = { bestFloor: get().bestFloor, ascensionUnlocked: target }
    set(next)
    save(next)
  },
}))
