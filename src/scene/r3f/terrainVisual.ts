// EXT.3 地形/天氣視覺對照表（plan/EXT.3）——純 display，不影響戰鬥資料。
// 鐵律：本檔只把 `TerrainId` 對應到「畫面長相」（地板色調/環境光/霧/天氣粒子原型），
// 不認識 power 倍率（那住 data/terrains.ts）。reducer/engine 不 import 本檔。
//
// 設計（四方圓桌定案，session-20260630-220524）：
//   8 個 emitter 原型 ＋ 每 terrain 一份 palette；辨識度靠 palette 上色（同 emitter 不同色）。
//   neutral palette ＝ 現有 hardcode 基線（ArenaFloor #0a0e22 / hemisphere sky #bcd0ff），
//   故「無地形/competitive arena」畫面與 M22 一字不差。

import type { TerrainId } from '@/game/types'

/** WeatherCanvas 持續粒子原型（8 種，不擴張）。`none`＝無持續 emitter（仍可畫靜態 overlay 如 god-ray）。 */
export type WeatherEmitter =
  | 'rain' | 'snow' | 'sand' | 'ember' | 'electric' | 'wind-petal' | 'mist' | 'none'

/** WeatherCanvas 的靜態 overlay 旗標（非粒子原型）。目前僅 sunny 的斜向 god-ray 光柱。 */
export type WeatherOverlay = 'godray'

export const TERRAIN_ARCHETYPES = [
  'arena',
  'meadow',
  'wetlands',
  'volcanic',
  'cavern',
  'storm',
  'spectral',
  'sanctuary',
] as const
export type TerrainArchetype = (typeof TERRAIN_ARCHETYPES)[number]

/** Palette/weather changes settle after the field outline, without a masking flash. */
export const TERRAIN_WORLD_TRANSITION_MS = 400

export interface TerrainPalette {
  /** Reusable procedural silhouette family. */
  archetype: TerrainArchetype
  /** R3F 地板色調（ArenaFloor base color）。 */
  groundTint: string
  /** R3F 遠景色調。 */
  horizonTint: string
  /** R3F 地標／輪廓強調色。 */
  featureTint: string
  /** R3F 環境光色（hemisphere 天空色）。 */
  ambient: string
  /** 可選霧 `{color, near, far}`（three fog）；省略＝不設霧。 */
  fog?: { color: string; near: number; far: number }
  /** WeatherCanvas 持續粒子原型。 */
  emitter: WeatherEmitter
  /** 粒子主色。 */
  particleColor: string
  /** 可選：極稀疏點綴色（如 psychic/electric-field 的電弧點）。 */
  sparkAccent?: string
  /** 可選：靜態 overlay（sunny god-ray）。 */
  overlay?: WeatherOverlay
}

export interface TerrainAccent {
  terrainId: TerrainId
  archetype: TerrainArchetype
  color: string
}

export interface ResolvedTerrainWorld {
  primaryId: TerrainId
  primary: TerrainPalette
  /** A composite field may add one sparse geometry accent, never a second weather emitter. */
  secondaryAccent?: TerrainAccent
}

/** neutral／arena 基線：對齊 sceneParts 現有 hardcode（ArenaFloor #0a0e22、hemisphere sky #bcd0ff）。 */
const NEUTRAL: TerrainPalette = {
  archetype: 'arena',
  groundTint: '#0a0e22',
  horizonTint: '#111a36',
  featureTint: '#526aa8',
  ambient: '#bcd0ff',
  emitter: 'none',
  particleColor: '#ffffff',
}

/**
 * 22 種 terrain（＋neutral）→ palette。對照表 LOCKED（圓桌結論 §C）：
 *   rain ← rain,coastal,steam,swamp ・ snow ← snowfield ・ sand ← sandstorm
 *   ember ← volcanic,dragons-peak ・ electric ← stormfield,electric-field
 *   wind-petal ← flowerfield,grassland,grassy-field,strong-winds,misty-field
 *   mist ← fog,haunt,mystic,cavern,holy-ground,psychic-field(+sparkAccent)
 *   none ← sunny(+godray),neutral
 */
export const TERRAIN_PALETTES: Record<TerrainId, TerrainPalette> = {
  // ── rain emitter ──
  rain: { archetype: 'wetlands', emitter: 'rain', particleColor: '#9fc8ff', groundTint: '#0a0e1a', horizonTint: '#17283c', featureTint: '#5f8fb8', ambient: '#8fb0e0', fog: { color: '#1a2436', near: 7, far: 24 } },
  coastal: { archetype: 'wetlands', emitter: 'rain', particleColor: '#7fd4ff', groundTint: '#08131f', horizonTint: '#0d3548', featureTint: '#43b6cf', ambient: '#8fc8ff', fog: { color: '#143049', near: 8, far: 28 } },
  steam: { archetype: 'volcanic', emitter: 'rain', particleColor: '#e6d8c8', groundTint: '#16120e', horizonTint: '#35251c', featureTint: '#d58d62', ambient: '#d8c0b0', fog: { color: '#2e2620', near: 5, far: 17 } },
  swamp: { archetype: 'wetlands', emitter: 'rain', particleColor: '#9ab87a', groundTint: '#0e140a', horizonTint: '#21351d', featureTint: '#718f42', ambient: '#8a9a6a', fog: { color: '#1c2814', near: 5, far: 18 } },
  // ── snow ──
  snowfield: { archetype: 'sanctuary', emitter: 'snow', particleColor: '#eaf4ff', groundTint: '#0e141c', horizonTint: '#293f5a', featureTint: '#b8def4', ambient: '#cfe4ff', fog: { color: '#243446', near: 8, far: 28 } },
  // ── sand ──
  sandstorm: { archetype: 'cavern', emitter: 'sand', particleColor: '#d8b878', groundTint: '#1a140a', horizonTint: '#49351b', featureTint: '#c28d42', ambient: '#d8c090', fog: { color: '#3a2c14', near: 5, far: 18 } },
  // ── ember ──
  volcanic: { archetype: 'volcanic', emitter: 'ember', particleColor: '#ff7a32', groundTint: '#1f0c08', horizonTint: '#4b1108', featureTint: '#dc3c12', ambient: '#ff9a6a', fog: { color: '#3a1208', near: 7, far: 24 } },
  'dragons-peak': { archetype: 'storm', emitter: 'ember', particleColor: '#b8c8dc', groundTint: '#0c1016', horizonTint: '#202c3f', featureTint: '#7184a0', ambient: '#90a4c0', fog: { color: '#161e2a', near: 7, far: 24 } },
  // ── electric ──
  stormfield: { archetype: 'storm', emitter: 'electric', particleColor: '#c9b8ff', groundTint: '#0a0c1e', horizonTint: '#17183d', featureTint: '#7463d7', ambient: '#9a8cff', fog: { color: '#1a1a3a', near: 7, far: 24 }, sparkAccent: '#fff7a0' },
  'electric-field': { archetype: 'storm', emitter: 'electric', particleColor: '#ffe46a', groundTint: '#0e0e16', horizonTint: '#2b2b16', featureTint: '#d6bd28', ambient: '#d8d04a', fog: { color: '#1c1c10', near: 8, far: 26 }, sparkAccent: '#fff7c0' },
  // ── wind-petal ──
  flowerfield: { archetype: 'meadow', emitter: 'wind-petal', particleColor: '#ff9ecb', groundTint: '#141016', horizonTint: '#3e2132', featureTint: '#df6ca7', ambient: '#ffc8d8', fog: { color: '#3a2030', near: 10, far: 34 } },
  grassland: { archetype: 'meadow', emitter: 'wind-petal', particleColor: '#7ed957', groundTint: '#0c1a10', horizonTint: '#173d22', featureTint: '#4faa42', ambient: '#9fe0a0', fog: { color: '#1a3a22', near: 9, far: 30 } },
  'grassy-field': { archetype: 'meadow', emitter: 'wind-petal', particleColor: '#8fe07a', groundTint: '#0c1a0e', horizonTint: '#1b4524', featureTint: '#64c24e', ambient: '#a8e89a', fog: { color: '#1c3a22', near: 10, far: 32 } },
  'strong-winds': { archetype: 'meadow', emitter: 'wind-petal', particleColor: '#cfe4ff', groundTint: '#0c1016', horizonTint: '#24344a', featureTint: '#8db4d7', ambient: '#bcd0e8', fog: { color: '#1e2836', near: 9, far: 30 } },
  'misty-field': { archetype: 'spectral', emitter: 'wind-petal', particleColor: '#ffc8e8', groundTint: '#141018', horizonTint: '#34233d', featureTint: '#c58aca', ambient: '#e0c0e8', fog: { color: '#2e2238', near: 7, far: 24 } },
  // ── mist ──
  fog: { archetype: 'spectral', emitter: 'mist', particleColor: '#cfd2d8', groundTint: '#101216', horizonTint: '#30353d', featureTint: '#858b94', ambient: '#b8bcc4', fog: { color: '#2a2e36', near: 4, far: 16 } },
  haunt: { archetype: 'spectral', emitter: 'mist', particleColor: '#9a6ad0', groundTint: '#0f0a16', horizonTint: '#26143b', featureTint: '#7543aa', ambient: '#6c4b8f', fog: { color: '#1d1726', near: 6, far: 24 } },
  mystic: { archetype: 'spectral', emitter: 'mist', particleColor: '#ff9ee0', groundTint: '#160f1c', horizonTint: '#42234e', featureTint: '#d969bd', ambient: '#d9a0ff', fog: { color: '#2a1a3a', near: 7, far: 26 } },
  cavern: { archetype: 'cavern', emitter: 'mist', particleColor: '#8a8276', groundTint: '#12100c', horizonTint: '#2f291f', featureTint: '#756b59', ambient: '#7d7468', fog: { color: '#1c1812', near: 5, far: 20 } },
  'holy-ground': { archetype: 'sanctuary', emitter: 'mist', particleColor: '#fff4d0', groundTint: '#16140e', horizonTint: '#4a422a', featureTint: '#ead083', ambient: '#ffeec0', fog: { color: '#3a3424', near: 10, far: 34 } },
  'psychic-field': { archetype: 'spectral', emitter: 'mist', particleColor: '#c89eff', groundTint: '#120e1c', horizonTint: '#32204d', featureTint: '#9e69dd', ambient: '#a888e0', fog: { color: '#241a36', near: 6, far: 24 }, sparkAccent: '#ff9ee0' },
  // ── none ──
  sunny: { archetype: 'sanctuary', emitter: 'none', particleColor: '#fff0b0', groundTint: '#14120a', horizonTint: '#493d1c', featureTint: '#e8bd45', ambient: '#ffe9a8', overlay: 'godray' },
  neutral: NEUTRAL,
}

/**
 * 由一組 terrain id（可混合）解析該場「視覺 palette」：取第一個非 neutral 的 terrain；
 * 全空/全 neutral → NEUTRAL（＝ M22 基線）。純決定論、無 RNG。
 */
export function resolveTerrainPalette(terrains: TerrainId[]): TerrainPalette {
  return resolveTerrainWorld(terrains).primary
}

/** Resolve one primary procedural world and, for mixed terrain, one sparse secondary accent. */
export function resolveTerrainWorld(terrains: readonly TerrainId[]): ResolvedTerrainWorld {
  const distinct = terrains.filter((id, index): id is TerrainId => (
    id !== 'neutral'
    && Object.prototype.hasOwnProperty.call(TERRAIN_PALETTES, id)
    && terrains.indexOf(id) === index
  ))
  const primaryId = distinct[0] ?? 'neutral'
  const secondaryId = distinct[1]
  const secondary = secondaryId ? TERRAIN_PALETTES[secondaryId] : undefined

  return {
    primaryId,
    primary: TERRAIN_PALETTES[primaryId],
    ...(secondary ? {
      secondaryAccent: {
        terrainId: secondaryId,
        archetype: secondary.archetype,
        color: secondary.featureTint,
      },
    } : {}),
  }
}
