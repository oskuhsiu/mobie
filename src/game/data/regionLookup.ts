import type { Region } from '@/game/types'
import { REGIONS } from './regions'
import { PRACTICE_REGION } from './practiceRegion'

/** 全部可選區域（產生器產生的 8 主題區 + 手動維護的練習場） */
export const ALL_REGIONS: Region[] = [...REGIONS, PRACTICE_REGION]

/** 依 id 取區域（含練習場）；查無拋錯。取代各處對 regions.getRegion 的直接呼叫。 */
export function lookupRegion(id: string): Region {
  const r = ALL_REGIONS.find((x) => x.id === id)
  if (!r) throw new Error(`Unknown region id: ${id}`)
  return r
}

/** 是否為練習場（結算/UI 區分用） */
export const isPracticeRegion = (id: string | null): boolean => id === PRACTICE_REGION.id
