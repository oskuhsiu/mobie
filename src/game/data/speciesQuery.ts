import type { Species } from '@/game/types'
import { SPECIES } from './species'

// 種族清單/搜尋的共用工具（ModelManager、卡庫新增卡等 UI 共用，避免各自重建與比對邏輯漂移）。
// species.ts 是產生檔不可手改，故另置於此手寫模組。

/** 依全國編號排序的種族清單（模組層建一次）。 */
export const SPECIES_SORTED: Species[] = Object.values(SPECIES).sort((a, b) => a.id - b.id)

/** 名稱（中/英）或編號的寬鬆比對，給搜尋框共用。query 為空視為全部符合。 */
export function matchesSpecies(sp: Species, query: string): boolean {
  const s = query.trim().toLowerCase()
  if (!s) return true
  return sp.nameZh.includes(s) || sp.name.toLowerCase().includes(s) || String(sp.id) === s
}
