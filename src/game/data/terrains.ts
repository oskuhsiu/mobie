// 場域地形（M8，plan/11 §1）——手寫非產生檔（如 practiceRegion）。
// 鐵律：地形「只影響攻擊 power」，在 engine.resolveAttack 的屬性相剋之後乘一個注入的純倍率
// （與 QTE/damageMult 同位階）；reducer 不認識地形語意，只把 currentTerrains 的 id 交給注入的 resolver。
// 混合地形＝逐屬性相乘，再與單一地形共用同一 clamp [0.5,1.5]（防兩個 ×1.3 疊成 1.69 爆數值）。

import type { TypeName, TerrainId } from '@/game/types'
import { hashSeed } from '@/game/individual'
import { createLookup } from '@/game/ext/statPatch'

export interface TerrainDef {
  id: TerrainId
  name: string
  icon: string
  /** 招式屬性 → power 倍率（>1 增、<1 減）；未列出的屬性＝1（中性） */
  mods: Partial<Record<TypeName, number>>
}

/** 地形倍率夾限（單一/混合同一界，無例外）——plan/11 §1.1 */
export const TERRAIN_CLAMP_MIN = 0.5
export const TERRAIN_CLAMP_MAX = 1.5

/** 地形清單（~12 種，數值待玩測平衡）——plan/11 §1.5 */
export const TERRAINS: TerrainDef[] = [
  { id: 'grassland', name: '草原', icon: '🌿', mods: { grass: 1.3, bug: 1.2, ground: 1.1, fire: 0.8 } },
  { id: 'volcanic', name: '熔岩', icon: '🌋', mods: { fire: 1.4, rock: 1.1, ice: 0.6, water: 0.8 } },
  { id: 'coastal', name: '水濱', icon: '🌊', mods: { water: 1.3, ice: 1.1, electric: 1.1, fire: 0.7 } },
  { id: 'stormfield', name: '雷原', icon: '⚡', mods: { electric: 1.4, flying: 1.2, ground: 0.7 } },
  { id: 'cavern', name: '岩窟', icon: '🪨', mods: { rock: 1.3, ground: 1.3, fighting: 1.1, flying: 0.7 } },
  { id: 'haunt', name: '幽域', icon: '👻', mods: { ghost: 1.4, dark: 1.2, poison: 1.1, psychic: 0.7 } },
  { id: 'mystic', name: '靈域', icon: '🧚', mods: { psychic: 1.3, fairy: 1.3, dark: 0.7 } },
  { id: 'dragons-peak', name: '龍峰', icon: '🐉', mods: { dragon: 1.3, steel: 1.2, ice: 1.1, fairy: 0.8 } },
  { id: 'sandstorm', name: '沙暴', icon: '🏜️', mods: { rock: 1.2, ground: 1.2, steel: 1.1, water: 0.8 } },
  { id: 'snowfield', name: '雪原', icon: '❄️', mods: { ice: 1.4, water: 1.1, grass: 0.8, fire: 0.7 } },
  { id: 'flowerfield', name: '花海', icon: '🌸', mods: { fairy: 1.3, grass: 1.2, bug: 1.1, poison: 0.8 } },
  // ── M13 內容階段 1：天氣型地形（plan/13 §2.2，本傳 weather）──
  { id: 'sunny', name: '晴天', icon: '☀️', mods: { fire: 1.5, grass: 1.1, water: 0.6, ice: 0.85 } },
  { id: 'rain', name: '雨天', icon: '🌧️', mods: { water: 1.5, electric: 1.1, fire: 0.6 } },
  { id: 'fog', name: '濃霧', icon: '🌫️', mods: { ghost: 1.2, dark: 1.2, normal: 0.9, flying: 0.85 } },
  { id: 'strong-winds', name: '強風', icon: '🌪️', mods: { flying: 1.3, dragon: 1.1, ground: 0.8, rock: 0.85 } },
  // ── M13 內容階段 2：場地型地形（plan/13 §2.3，本傳 terrain）──
  { id: 'grassy-field', name: '草地場', icon: '🌱', mods: { grass: 1.3, ground: 0.85 } },
  { id: 'electric-field', name: '電氣場', icon: '🔌', mods: { electric: 1.3, dragon: 0.9 } },
  { id: 'psychic-field', name: '精神場', icon: '🔮', mods: { psychic: 1.3 } },
  { id: 'misty-field', name: '薄霧場', icon: '🌸', mods: { fairy: 1.3, dragon: 0.5 } },
  // ── M13 內容階段 3：特殊型地形（plan/13 §2.3 + 合體技灌注）──
  { id: 'swamp', name: '沼澤', icon: '🪻', mods: { ground: 1.2, water: 1.2, poison: 1.1, fire: 0.8, flying: 0.85 } },
  { id: 'steam', name: '蒸氣', icon: '♨️', mods: { fire: 1.2, water: 1.2, ice: 0.8 } },
  { id: 'holy-ground', name: '聖域', icon: '✨', mods: { psychic: 1.2, fairy: 1.2, dark: 0.7, ghost: 0.8 } },
  { id: 'neutral', name: '中性', icon: '⬜', mods: {} },
]

/** 依 id 取地形定義；查無回 undefined（未知 id 視為無效，倍率計算自動略過）。共用 createLookup（同 items/abilities）。 */
export const lookupTerrain = createLookup(TERRAINS)

/** 解析一組地形 id 為「有效且非中性」的 TerrainDef（UI 揭示/徽章共用，過濾未知與 neutral）。 */
export const terrainDefsOf = (terrainIds: TerrainId[]): TerrainDef[] =>
  terrainIds.map(lookupTerrain).filter((d): d is TerrainDef => d !== undefined && d.id !== 'neutral')

/**
 * 純函數：某招式屬性在當前地形（可多個＝混合）下的最終 power 倍率。
 * 混合＝逐屬性相乘，再夾 [0.5,1.5]（單一/混合同一界）。空地形＝1。
 */
export function terrainMultiplier(moveType: TypeName, terrains: TerrainDef[]): number {
  let m = 1
  for (const t of terrains) m *= t.mods[moveType] ?? 1
  return Math.min(TERRAIN_CLAMP_MAX, Math.max(TERRAIN_CLAMP_MIN, m))
}

/**
 * reducer 注入用：把 currentTerrains 的 id 陣列解析成某招式屬性的倍率（id → def → mult）。
 * 未知 id 略過。reducer/engine 不 import 本檔——由 store/BattleScreen 把這支函數當「能力包」注入（如 rng）。
 */
export function resolveTerrainMult(moveType: TypeName, terrainIds: TerrainId[]): number {
  const defs = terrainIds
    .map(lookupTerrain)
    .filter((d): d is TerrainDef => d !== undefined)
  return terrainMultiplier(moveType, defs)
}

/**
 * 隨機地形：由 seed 從地形池決定論抽 1 個（沿用 individual.ts 的 hashSeed）。
 * 空池→中性。plan/11 §1.3「開場從地形池決定論抽」。
 */
export function rollRandomTerrain(pool: TerrainId[], seed: string): TerrainId {
  if (pool.length === 0) return 'neutral'
  return pool[hashSeed(seed) % pool.length]
}

/**
 * 由 Region 解析該場開場地形 id（供 battle setup 注入 fieldState.terrainEffects.initial）：
 * - arena / 無 terrains → 中性（空＝無倍率）。
 * - randomTerrain → 從 terrains 池決定論抽 1 個。
 * - 否則 → 直接用 terrains（固定，含混合）。
 */
export function resolveBattleTerrains(
  region: { mode: 'arena' | 'wild'; terrains?: TerrainId[]; randomTerrain?: boolean },
  seed: string,
): TerrainId[] {
  if (region.mode === 'arena') return []
  const pool = region.terrains ?? []
  if (pool.length === 0) return []
  if (region.randomTerrain) return [rollRandomTerrain(pool, seed)]
  return pool
}
