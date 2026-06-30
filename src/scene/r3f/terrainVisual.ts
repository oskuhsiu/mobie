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

export interface TerrainPalette {
  /** R3F 地板色調（ArenaFloor base color）。 */
  groundTint: string
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

/** neutral／arena 基線：對齊 sceneParts 現有 hardcode（ArenaFloor #0a0e22、hemisphere sky #bcd0ff）。 */
const NEUTRAL: TerrainPalette = {
  groundTint: '#0a0e22',
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
  rain: { emitter: 'rain', particleColor: '#9fc8ff', groundTint: '#0a0e1a', ambient: '#8fb0e0', fog: { color: '#1a2436', near: 7, far: 24 } },
  coastal: { emitter: 'rain', particleColor: '#7fd4ff', groundTint: '#08131f', ambient: '#8fc8ff', fog: { color: '#143049', near: 8, far: 28 } },
  steam: { emitter: 'rain', particleColor: '#e6d8c8', groundTint: '#16120e', ambient: '#d8c0b0', fog: { color: '#2e2620', near: 5, far: 17 } },
  swamp: { emitter: 'rain', particleColor: '#9ab87a', groundTint: '#0e140a', ambient: '#8a9a6a', fog: { color: '#1c2814', near: 5, far: 18 } },
  // ── snow ──
  snowfield: { emitter: 'snow', particleColor: '#eaf4ff', groundTint: '#0e141c', ambient: '#cfe4ff', fog: { color: '#243446', near: 8, far: 28 } },
  // ── sand ──
  sandstorm: { emitter: 'sand', particleColor: '#d8b878', groundTint: '#1a140a', ambient: '#d8c090', fog: { color: '#3a2c14', near: 5, far: 18 } },
  // ── ember ──
  volcanic: { emitter: 'ember', particleColor: '#ff7a32', groundTint: '#1f0c08', ambient: '#ff9a6a', fog: { color: '#3a1208', near: 7, far: 24 } },
  'dragons-peak': { emitter: 'ember', particleColor: '#b8c8dc', groundTint: '#0c1016', ambient: '#90a4c0', fog: { color: '#161e2a', near: 7, far: 24 } },
  // ── electric ──
  stormfield: { emitter: 'electric', particleColor: '#c9b8ff', groundTint: '#0a0c1e', ambient: '#9a8cff', fog: { color: '#1a1a3a', near: 7, far: 24 }, sparkAccent: '#fff7a0' },
  'electric-field': { emitter: 'electric', particleColor: '#ffe46a', groundTint: '#0e0e16', ambient: '#d8d04a', fog: { color: '#1c1c10', near: 8, far: 26 }, sparkAccent: '#fff7c0' },
  // ── wind-petal ──
  flowerfield: { emitter: 'wind-petal', particleColor: '#ff9ecb', groundTint: '#141016', ambient: '#ffc8d8', fog: { color: '#3a2030', near: 10, far: 34 } },
  grassland: { emitter: 'wind-petal', particleColor: '#7ed957', groundTint: '#0c1a10', ambient: '#9fe0a0', fog: { color: '#1a3a22', near: 9, far: 30 } },
  'grassy-field': { emitter: 'wind-petal', particleColor: '#8fe07a', groundTint: '#0c1a0e', ambient: '#a8e89a', fog: { color: '#1c3a22', near: 10, far: 32 } },
  'strong-winds': { emitter: 'wind-petal', particleColor: '#cfe4ff', groundTint: '#0c1016', ambient: '#bcd0e8', fog: { color: '#1e2836', near: 9, far: 30 } },
  'misty-field': { emitter: 'wind-petal', particleColor: '#ffc8e8', groundTint: '#141018', ambient: '#e0c0e8', fog: { color: '#2e2238', near: 7, far: 24 } },
  // ── mist ──
  fog: { emitter: 'mist', particleColor: '#cfd2d8', groundTint: '#101216', ambient: '#b8bcc4', fog: { color: '#2a2e36', near: 4, far: 16 } },
  haunt: { emitter: 'mist', particleColor: '#9a6ad0', groundTint: '#0f0a16', ambient: '#6c4b8f', fog: { color: '#1d1726', near: 6, far: 24 } },
  mystic: { emitter: 'mist', particleColor: '#ff9ee0', groundTint: '#160f1c', ambient: '#d9a0ff', fog: { color: '#2a1a3a', near: 7, far: 26 } },
  cavern: { emitter: 'mist', particleColor: '#8a8276', groundTint: '#12100c', ambient: '#7d7468', fog: { color: '#1c1812', near: 5, far: 20 } },
  'holy-ground': { emitter: 'mist', particleColor: '#fff4d0', groundTint: '#16140e', ambient: '#ffeec0', fog: { color: '#3a3424', near: 10, far: 34 } },
  'psychic-field': { emitter: 'mist', particleColor: '#c89eff', groundTint: '#120e1c', ambient: '#a888e0', fog: { color: '#241a36', near: 6, far: 24 }, sparkAccent: '#ff9ee0' },
  // ── none ──
  sunny: { emitter: 'none', particleColor: '#fff0b0', groundTint: '#14120a', ambient: '#ffe9a8', overlay: 'godray' },
  neutral: NEUTRAL,
}

/**
 * 由一組 terrain id（可混合）解析該場「視覺 palette」：取第一個非 neutral 的 terrain；
 * 全空/全 neutral → NEUTRAL（＝ M22 基線）。純決定論、無 RNG。
 */
export function resolveTerrainPalette(terrains: TerrainId[]): TerrainPalette {
  for (const id of terrains) {
    const p = TERRAIN_PALETTES[id]
    if (p && id !== 'neutral') return p
  }
  return NEUTRAL
}
