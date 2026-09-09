import type { Region, TerrainId } from '@/game/types'
import { canCaptureIn } from '@/game/data/regionLookup'
import { PRACTICE_REGION } from '@/game/data/practiceRegion'
import { REGIONS } from '@/game/data/regions'
import { lookupTerrain, terrainDefsOf } from '@/game/data/terrains'

export const REGION_HUB_REGION_COUNT = 16

export interface RegionHubCatalog {
  practice: Region
  regions: readonly Region[]
}

export type RegionHubCatalogResult =
  | { status: 'ready'; catalog: RegionHubCatalog }
  | { status: 'error'; message: string }

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function validateRegion(region: Region, source: string): void {
  if (!isNonEmptyString(region.id) || !isNonEmptyString(region.name) || !isNonEmptyString(region.blurb)) {
    throw new Error(`${source} 缺少 id、名稱或描述`)
  }
  if (region.mode !== 'arena' && region.mode !== 'wild') {
    throw new Error(`${source} 的 mode 無效`)
  }
  if (!Array.isArray(region.gradient) || region.gradient.length !== 2 || region.gradient.some((color) => !isNonEmptyString(color))) {
    throw new Error(`${source} 的主題色資料無效`)
  }
  if (!isNonEmptyString(region.icon) || !Array.isArray(region.encounters) || region.encounters.length === 0) {
    throw new Error(`${source} 缺少圖示或遭遇資料`)
  }
  if (region.terrains !== undefined) {
    if (!Array.isArray(region.terrains) || region.terrains.some((terrainId) => typeof terrainId !== 'string' || !lookupTerrain(terrainId as TerrainId))) {
      throw new Error(`${source} 的地形資料無效`)
    }
  }
  if (region.randomTerrain !== undefined && typeof region.randomTerrain !== 'boolean') {
    throw new Error(`${source} 的隨機地形旗標無效`)
  }
  if (region.randomTerrain && (region.terrains?.length ?? 0) === 0) {
    throw new Error(`${source} 的隨機地形缺少地形池`)
  }
  for (const [index, encounter] of region.encounters.entries()) {
    if (!encounter || typeof encounter !== 'object') {
      throw new Error(`${source} 的第 ${index + 1} 筆遭遇資料無效`)
    }
    const { speciesId, weight, minLevel, maxLevel } = encounter
    if (
      !Number.isInteger(speciesId) || speciesId <= 0
      || !Number.isFinite(weight) || weight <= 0
      || !Number.isInteger(minLevel) || minLevel <= 0
      || !Number.isInteger(maxLevel) || maxLevel < minLevel
    ) {
      throw new Error(`${source} 的第 ${index + 1} 筆遭遇資料無效`)
    }
  }
}

/**
 * Validate the generated region catalog at the UI boundary. A broken generated
 * module must produce a recoverable screen rather than an empty hub.
 */
export function readRegionHubCatalog(injectFailure = false): RegionHubCatalogResult {
  try {
    if (injectFailure) throw new Error('測試用區域資料錯誤')
    if (REGIONS.length !== REGION_HUB_REGION_COUNT) {
      throw new Error(`應有 ${REGION_HUB_REGION_COUNT} 個野外區域，實際取得 ${REGIONS.length} 個`)
    }
    const ids = new Set<string>()
    for (const region of REGIONS) {
      validateRegion(region, `區域 ${region.id || '(unknown)'}`)
      if (ids.has(region.id)) throw new Error(`區域 id 重複：${region.id}`)
      ids.add(region.id)
      if (region.mode !== 'wild') throw new Error(`野外 atlas 含有非 wild 區域：${region.id}`)
    }
    validateRegion(PRACTICE_REGION, '競技場')
    if (PRACTICE_REGION.mode !== 'arena' || ids.has(PRACTICE_REGION.id)) {
      throw new Error('競技場資料與野外區域衝突')
    }
    return { status: 'ready', catalog: { practice: PRACTICE_REGION, regions: REGIONS } }
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return {
      status: 'error',
      message: `區域資料目前不完整：${detail}。請重新嘗試；若仍無法載入，可返回首頁。`,
    }
  }
}

export function regionModeLabel(region: Pick<Region, 'mode'>): string {
  return region.mode === 'wild' ? '野外區域' : '競技場'
}

export function regionCaptureLabel(region: Pick<Region, 'id'>): string {
  return canCaptureIn(region.id) ? '可捕獲首領' : '不可捕獲 · 純經驗'
}

export function regionTerrainLabel(region: Pick<Region, 'terrains' | 'randomTerrain'>): string {
  const definitions = terrainDefsOf(region.terrains ?? [])
  const names = definitions.map((terrain) => `${terrain.icon} ${terrain.name}`)
  if (region.randomTerrain) return names.length > 0 ? `隨機 · ${names.join('／')}` : '隨機地形'
  if (names.length > 1) return `混合 · ${names.join('／')}`
  return names[0] ?? '中性地形'
}

export function regionLevelLabel(region: Pick<Region, 'encounters'>): string {
  const levels = region.encounters.flatMap(({ minLevel, maxLevel }) => [minLevel, maxLevel])
  if (levels.length === 0) return '遭遇等級未定'
  return `遭遇 Lv.${Math.min(...levels)}–${Math.max(...levels)}`
}

export function shouldInjectRegionHubFailure(): boolean {
  if (!import.meta.env.DEV || typeof window === 'undefined') return false
  const query = new URLSearchParams(window.location.search)
  return query.get('m24RegionFixture') === 'missing' || query.get('regionFixture') === 'missing'
}
