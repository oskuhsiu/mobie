import { describe, expect, it } from 'vitest'
import {
  DEX_PAGE_SIZE,
  DEX_TOTAL,
  dexStateForSpecies,
  filterDexSpecies,
  paginateDex,
} from './dex'
import { SPECIES_SORTED } from './data/speciesQuery'

describe('bounded Dex projection', () => {
  it('keeps the generated 1–1025 catalog complete and pages at most 60 entries', () => {
    expect(SPECIES_SORTED).toHaveLength(DEX_TOTAL)

    const first = paginateDex(SPECIES_SORTED, 1)
    const last = paginateDex(SPECIES_SORTED, 999)

    expect(first.page).toBe(1)
    expect(first.items).toHaveLength(DEX_PAGE_SIZE)
    expect(first.items[0].id).toBe(1)
    expect(last.page).toBe(18)
    expect(last.items).toHaveLength(5)
    expect(last.items.at(-1)?.id).toBe(DEX_TOTAL)
    expect(paginateDex(SPECIES_SORTED, 0).page).toBe(1)
    expect(paginateDex(SPECIES_SORTED, 999).page).toBe(last.page)
    expect(paginateDex([], 3).items).toEqual([])
  })

  it('composes name/number search with registered, owned and Grade S/SS filters', () => {
    const registered = new Set([1, 4])
    const owned = new Set([25])
    const gradeBySpecies = new Map([[25, 5 as const]])
    const options = { registered, owned, gradeBySpecies }

    expect(filterDexSpecies(SPECIES_SORTED, options)).toHaveLength(DEX_TOTAL)
    expect(filterDexSpecies(SPECIES_SORTED, { ...options, query: '#001' }).map((species) => species.id)).toEqual([1])
    expect(filterDexSpecies(SPECIES_SORTED, { ...options, filter: 'registered' }).map((species) => species.id)).toEqual([1, 4, 25])
    expect(filterDexSpecies(SPECIES_SORTED, { ...options, filter: 'owned' }).map((species) => species.id)).toEqual([25])
    expect(filterDexSpecies(SPECIES_SORTED, { ...options, filter: 'shining' }).map((species) => species.id)).toEqual([25])
    expect(filterDexSpecies(SPECIES_SORTED, { ...options, query: 'does-not-exist' })).toEqual([])
  })

  it('keeps ownership precedence over registered and seen state', () => {
    expect(dexStateForSpecies(1, new Set([1]), new Set(), new Set([1]))).toBe('registered')
    expect(dexStateForSpecies(1, new Set([1]), new Set([1]), new Set())).toBe('owned')
    expect(dexStateForSpecies(1, new Set(), new Set(), new Set([1]))).toBe('seen')
    expect(dexStateForSpecies(1, new Set(), new Set(), new Set())).toBe('unseen')
  })
})
