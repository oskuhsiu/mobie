// M12.d — 合體技（Combo，plan/12 §4）。連鎖系統（M9）的升級變體：連鎖提交時若參與隊友
// 符合某 ComboDef 的條件（屬性配對 / 種族配對）→ 觸發一發「合成大招」＋施放效果（灌注地形 /
// 全隊增益 / 敵方弱化），每組合每場一次（usedComboKeys 限流）。
//
// 守不變式：
//   ① 純 reducer——合體規則如 rng 般注入（ext.combo），reducer 不認識「哪些配對能合體」，只認識
//      一個純 matcher + 套用既有 fieldState 詞彙（terrain/teamStatuses/enemyStatuses，同 M19.d）。
//   ② 直接傷害僅「專屬招 + 合體技/星擊」家族允許（plan/12 §0）——合體大招透過既有 performAttack 灌 damageMult。
//   ③ usedComboKeys 戰鬥內暫態（住 BattleState，不回寫 OwnedUnit）。
//   ④ 可選掛載——combo 模組關閉＝ext.combo undefined＝連鎖不升級、零殘留。

import type { BattleMobie, TerrainId, TypeName } from '@/game/types'
import type { ExtensionModule } from '@/game/ext/seams'

export type ComboStat = 'atk' | 'def' | 'spa' | 'spd'

/** 合體施放效果三類（plan/12 §4.2），命中後生效 N 回合、寫進 fieldState。 */
export type ComboCastEffect =
  | { kind: 'infuseTerrain'; terrainId: TerrainId; turns: number }
  | { kind: 'teamBuff'; stat: ComboStat; mult: number; turns: number }
  | { kind: 'enemyDebuff'; stat: ComboStat; mult: number; turns: number }

export interface ComboDef {
  /** 也是 usedComboKeys 的 key（每場一次）。 */
  id: string
  name: string
  icon: string
  /** 觸發條件：屬性配對（兩屬性皆出現在參與者身上）或種族配對（兩 speciesId 皆參與）。 */
  requires: { typePair?: [TypeName, TypeName]; speciesPair?: [number, number] }
  /** 合成大招的傷害倍率（領銜者的招式 × 此倍率；直接傷害僅此家族允許）。 */
  power: number
  cast: ComboCastEffect
}

/**
 * 小樣本 catalog（手寫可平衡，plan/12 §8「縱向先打穿」）：以元素配對為主 + 一組御三家種族配對示例。
 * 數值為示意、待玩測平衡。地形只引用既有 data/terrains.ts 的 id（不新增地形）。
 */
export const COMBO_DEFS: ComboDef[] = [
  { id: 'steam-burst', name: '蒸氣爆破', icon: '♨️', requires: { typePair: ['fire', 'water'] }, power: 2.6, cast: { kind: 'enemyDebuff', stat: 'atk', mult: 0.7, turns: 3 } },
  { id: 'verdant-surge', name: '青翠奔流', icon: '🌿', requires: { typePair: ['grass', 'water'] }, power: 2.4, cast: { kind: 'infuseTerrain', terrainId: 'grassland', turns: 4 } },
  { id: 'thunderstorm', name: '雷暴連擊', icon: '⛈️', requires: { typePair: ['electric', 'water'] }, power: 2.5, cast: { kind: 'infuseTerrain', terrainId: 'stormfield', turns: 4 } },
  { id: 'magma-quake', name: '熔岩震', icon: '🌋', requires: { typePair: ['fire', 'ground'] }, power: 2.6, cast: { kind: 'infuseTerrain', terrainId: 'volcanic', turns: 4 } },
  { id: 'frost-veil', name: '霜霰護幕', icon: '❄️', requires: { typePair: ['ice', 'steel'] }, power: 2.4, cast: { kind: 'teamBuff', stat: 'def', mult: 1.4, turns: 3 } },
  { id: 'starter-bond', name: '御三家羈絆', icon: '✨', requires: { speciesPair: [3, 6] }, power: 2.8, cast: { kind: 'teamBuff', stat: 'atk', mult: 1.4, turns: 3 } },
]

/** 注入 reducer 的合體能力（純 matcher + defs）。reducer 透過 match 取結果、套用既有 fieldState 詞彙。 */
export interface ComboRules {
  /** 由參與隊友找出第一個「符合條件且本場未用過」的合體；無則 null。純函式。 */
  match: (participants: BattleMobie[], usedKeys: string[]) => ComboDef | null
}

/** 純 matcher：≥2 名參與者，依屬性聯集 / 種族集合比對未用過的 ComboDef。 */
export function matchCombo(participants: BattleMobie[], defs: ComboDef[], usedKeys: string[]): ComboDef | null {
  if (participants.length < 2) return null
  const types = new Set<TypeName>(participants.flatMap((p) => p.types))
  const speciesIds = participants.map((p) => p.speciesId)
  for (const def of defs) {
    if (usedKeys.includes(def.id)) continue
    const r = def.requires
    if (r.typePair && r.typePair.every((t) => types.has(t))) return def
    if (r.speciesPair && r.speciesPair.every((id) => speciesIds.includes(id))) return def
  }
  return null
}

/** 預設合體規則（綁定內建 catalog）。assembleExt 在 combo 模組開啟時注入。 */
export const COMBO_RULES: ComboRules = {
  match: (participants, usedKeys) => matchCombo(participants, COMBO_DEFS, usedKeys),
}

/**
 * 合體技模組：只掛 combo 縫（S5b）。停用＝assembleExt 不收＝ext.combo undefined＝連鎖不升級＝零殘留。
 * 依賴連鎖模組（combo 在 SUBMIT_CHAIN_RESULT 後段判定）；單開 combo 不開 chain＝無連鎖可升級。
 */
export const COMBO_MODULE: ExtensionModule = {
  id: 'combo',
  seams: { combo: COMBO_RULES },
}
