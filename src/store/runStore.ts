// M11 連勝塔 meta 進度（mobie.run.v1）——只存「歷史最高樓層 + 已解鎖 ascension」。
// 守鐵律：run 防火牆——進行中的 run 狀態（樓層/隊伍/HP）住 XState context 暫態、不逆寫 OwnedUnit；
// 本 slice 只存通關後的 meta 成就（持久），run 內結算的 EXP/SP 走既有 rosterStore/skillPointsStore。

import { create } from 'zustand'
import { ASCENSIONS } from '@/game/tower'
import type { TowerProgressionMarker } from '@/game/resultSettlement'

const KEY = 'mobie.run.v1'
const SETTLEMENT_FIELD = 'resultSettlements'
const SETTLEMENT_MIRROR_KEY = 'mobie.tower.settlement.v1'

export interface RunProgressState {
  bestFloor: number
  ascensionUnlocked: number
}

function normalize(raw: unknown): RunProgressState {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : {}
  return {
    bestFloor: typeof o.bestFloor === 'number' && o.bestFloor >= 0 ? Math.floor(o.bestFloor) : 0,
    ascensionUnlocked: typeof o.ascensionUnlocked === 'number'
      ? Math.max(0, Math.min(ASCENSIONS.length - 1, Math.floor(o.ascensionUnlocked)))
      : 0,
  }
}

function load(): RunProgressState {
  const def: RunProgressState = { bestFloor: 0, ascensionUnlocked: 0 }
  if (typeof localStorage === 'undefined') return def
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return def
    return normalize(JSON.parse(raw))
  } catch {
    return def
  }
}

/** Strict read used by the Result tower destination so malformed storage is recoverable. */
export function loadRunStrict(): RunProgressState {
  const def: RunProgressState = { bestFloor: 0, ascensionUnlocked: 0 }
  if (typeof localStorage === 'undefined') return def
  const raw = localStorage.getItem(KEY)
  if (raw === null) return def
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new Error(`讀取連勝塔進度失敗：${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('讀取連勝塔進度失敗：資料格式無效')
  }
  return normalize(parsed)
}

function existingSettlementMarkers(): unknown[] | undefined {
  if (typeof localStorage === 'undefined') return undefined
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const markers = (parsed as Record<string, unknown>)[SETTLEMENT_FIELD]
        if (Array.isArray(markers)) return markers
      }
    }
    const mirror = localStorage.getItem(SETTLEMENT_MIRROR_KEY)
    if (!mirror) return undefined
    const parsedMirror: unknown = JSON.parse(mirror)
    return Array.isArray(parsedMirror) ? parsedMirror : undefined
  } catch {
    return undefined
  }
}

function encode(p: RunProgressState, markers: unknown[] | undefined): string {
  return JSON.stringify({
    ...p,
    ...(markers ? { [SETTLEMENT_FIELD]: markers } : {}),
  })
}

function save(p: RunProgressState): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, encode(p, existingSettlementMarkers()))
  } catch {
    /* 配額/隱私模式：忽略 */
  }
}

/** Tower child-boundary write: canonical run progress and its markers share one envelope. */
export function saveRunWithSettlementMarkersStrict(
  state: RunProgressState,
  markers: TowerProgressionMarker[] | unknown[],
): void {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(KEY, encode(state, markers))
  } catch (cause) {
    throw new Error(`保存連勝塔結算資料失敗：${cause instanceof Error ? cause.message : String(cause)}`)
  }
}

// Compatibility name for persistence adapters and future callers.
export const saveRunStateWithSettlementMarkersStrict = saveRunWithSettlementMarkersStrict

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
