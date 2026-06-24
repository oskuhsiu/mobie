// M10 — 進化（Evolution，S6 postGrowth）。設計真相：plan/09 §4、plan/14（M10）。
//
// 等級達 species.evolveLevel → 改 OwnedUnit.speciesId（**個體欄位全保留**：IV/EXP/nature/seed/shiny/heldItemId
// 不變，只換種族＝新 base stats/artwork，由 buildBattleMobie 重算）。守 plan/09 §4.3：
//   ① 只改 canonical speciesId（仍只存 canonical）。
//   ② 招式維持單一專屬（進化不解鎖新招——moveId 由 species 決定，換種族自然換招但仍是單招）。
//   ③ 可連跳多階（一場打到 level 36 的綿綿可一次 → 鐵殼 → 巴大蝶）。
// 停用＝不掛 S6＝升級永不進化＝純 M1.x 成長（零殘留）。

import type { OwnedUnit } from '@/game/types'
import { SPECIES } from '@/game/data/species'
import type { ExtensionModule, PostGrowthHook } from '@/game/ext/seams'

/**
 * 依目前等級算「應進化到的最終 speciesId」（可連跳多階）；不需進化則回 null。
 * 純函數（只讀 SPECIES 靜態進化欄）；guard 防壞資料成環。
 */
export function evolvedSpeciesId(unit: OwnedUnit): number | null {
  let id = unit.speciesId
  let changed = false
  for (let guard = 0; guard < 5; guard++) {
    const sp = SPECIES[id]
    if (!sp || sp.evolvesTo === undefined || sp.evolveLevel === undefined) break
    if (unit.level < sp.evolveLevel) break
    id = sp.evolvesTo
    changed = true
  }
  return changed ? id : null
}

/** S6 postGrowth：等級達標→換 speciesId（個體欄位全保留）；不變則原樣返回。 */
const evolutionPostGrowth: PostGrowthHook = (unit) => {
  const to = evolvedSpeciesId(unit)
  return to !== null ? { ...unit, speciesId: to } : unit
}

/**
 * 進化模組：只掛 S6（postGrowth）。
 * 停用＝assemblePostGrowth 不收此縫＝升級不檢查進化＝純 M1.x 成長。
 */
export const EVOLUTION_MODULE: ExtensionModule = {
  id: 'evolution',
  seams: { postGrowth: evolutionPostGrowth },
}
