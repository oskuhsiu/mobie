import type { Grade } from '@/game/grade'
import type { DexState } from '@/game/meta'
import type { Species } from '@/game/types'
import { SPECIES_SORTED, matchesSpecies } from '@/game/data/speciesQuery'

/** The generated national dex is deliberately bounded to the canonical range. */
export const DEX_TOTAL = 1025
/** Keep the rendered page small enough for the accessibility tree and image work. */
export const DEX_PAGE_SIZE = 60

export type DexFilter = 'all' | 'registered' | 'owned' | 'shining'

export interface DexFilterOptions {
  query?: string
  filter?: DexFilter
  registered: ReadonlySet<number>
  owned: ReadonlySet<number>
  gradeBySpecies?: ReadonlyMap<number, Grade>
}

export interface DexPage<T> {
  items: T[]
  page: number
  pageCount: number
  total: number
  start: number
  end: number
}

function normalizedPageSize(pageSize: number): number {
  if (!Number.isInteger(pageSize) || pageSize <= 0) return DEX_PAGE_SIZE
  return Math.min(DEX_PAGE_SIZE, pageSize)
}

/** Validate the generated catalog at a UI/data boundary before rendering it. */
export function validateDexCatalog(catalog: readonly Species[]): readonly Species[] {
  if (catalog.length !== DEX_TOTAL) {
    throw new Error(`圖鑑資料應有 ${DEX_TOTAL} 筆，實際取得 ${catalog.length} 筆`)
  }
  for (const [index, species] of catalog.entries()) {
    const expectedId = index + 1
    if (!species || species.id !== expectedId) {
      throw new Error(`圖鑑資料缺少第 ${expectedId} 筆`)
    }
    if (!species.nameZh.trim() || !species.name.trim() || species.types.length === 0 || !species.artworkUrl.trim()) {
      throw new Error(`圖鑑第 ${expectedId} 筆資料不完整`)
    }
  }
  return catalog
}

/** Read the generated national dex; callers can turn a broken read into a recoverable UI state. */
export function loadDexCatalog(injectFailure = false): readonly Species[] {
  if (injectFailure) throw new Error('測試用圖鑑資料錯誤')
  return validateDexCatalog(SPECIES_SORTED)
}

/** Derive the four discovery/ownership states without persisting a second projection. */
export function dexStateForSpecies(
  speciesId: number,
  registered: ReadonlySet<number>,
  owned: ReadonlySet<number>,
  seen: ReadonlySet<number> = new Set(),
): DexState {
  if (owned.has(speciesId)) return 'owned'
  if (registered.has(speciesId)) return 'registered'
  return seen.has(speciesId) ? 'seen' : 'unseen'
}

/** Filter the full canonical data set; only the subsequent pagination is rendered. */
export function filterDexSpecies(catalog: readonly Species[], options: DexFilterOptions): Species[] {
  const query = options.query ?? ''
  const filter = options.filter ?? 'all'
  return catalog.filter((species) => {
    if (!matchesSpecies(species, query)) return false
    if (filter === 'registered') return options.registered.has(species.id) || options.owned.has(species.id)
    if (filter === 'owned') return options.owned.has(species.id)
    if (filter === 'shining') {
      const grade = options.gradeBySpecies?.get(species.id)
      return options.owned.has(species.id) && grade !== undefined && grade >= 5
    }
    return true
  })
}

export function pageCountFor(total: number, pageSize = DEX_PAGE_SIZE): number {
  const size = normalizedPageSize(pageSize)
  return Math.max(1, Math.ceil(Math.max(0, total) / size))
}

/** Return a clamped, bounded page slice. Empty results still have a legal page 1. */
export function paginateDex<T>(items: readonly T[], requestedPage: number, pageSize = DEX_PAGE_SIZE): DexPage<T> {
  const size = normalizedPageSize(pageSize)
  const pageCount = pageCountFor(items.length, size)
  const page = Number.isFinite(requestedPage)
    ? Math.min(pageCount, Math.max(1, Math.floor(requestedPage)))
    : 1
  const start = items.length === 0 ? 0 : (page - 1) * size
  const pageItems = items.slice(start, start + size)
  return {
    items: pageItems,
    page,
    pageCount,
    total: items.length,
    start,
    end: start + pageItems.length,
  }
}
