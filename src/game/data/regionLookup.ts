import type { Region } from '@/game/types'
import { REGIONS } from './regions'
import { PRACTICE_REGION } from './practiceRegion'

/** 全部可選區域（產生器產生的 8 主題區 + 手動維護的練習場） */
export const ALL_REGIONS: Region[] = [...REGIONS, PRACTICE_REGION]

/** 依 id 取區域（含競技場）；查無拋錯。取代各處對 regions.getRegion 的直接呼叫。 */
export function lookupRegion(id: string): Region {
  const r = ALL_REGIONS.find((x) => x.id === id)
  if (!r) throw new Error(`Unknown region id: ${id}`)
  return r
}

/**
 * 此區域是否可捕獲（M6 模式 contract）。捕獲資格集中由 mode 決定，不散落 isPracticeRegion、
 * 也不讓 OwnedUnit 帶戰鬥臨時資訊（plan/11 §2.2）。查無區域（如尚未選）→ 不可捕獲。
 */
export function canCaptureIn(id: string | null): boolean {
  if (!id) return false
  try {
    return lookupRegion(id).mode === 'wild'
  } catch {
    return false
  }
}
