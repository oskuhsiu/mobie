import { beforeEach, describe, expect, it } from 'vitest'
import { useAccidents } from './accidentStore'

describe('accident encounter lifecycle', () => {
  beforeEach(() => useAccidents.getState().reset())

  it('keeps one supply choice across an Encounter remount and resets for a new encounter', () => {
    useAccidents.getState().beginEncounter('region:encounter-a', 1)
    useAccidents.getState().chooseSupply('sp')

    useAccidents.getState().beginEncounter('region:encounter-a', 1)
    expect(useAccidents.getState().supplyKind).toBe('sp')
    useAccidents.getState().chooseSupply('exp')
    expect(useAccidents.getState().supplyKind).toBe('sp')

    useAccidents.getState().beginEncounter('region:encounter-b', 1)
    expect(useAccidents.getState().supplyKind).toBeNull()
    expect(useAccidents.getState().expMult).toBe(1)
  })

  it('keeps the lucky bonus when the experience supply is selected', () => {
    useAccidents.getState().beginEncounter('region:encounter-a', 1.5)
    useAccidents.getState().chooseSupply('exp')
    expect(useAccidents.getState().expMult).toBe(1.5)
    expect(useAccidents.getState().supplyKind).toBe('exp')
  })
})
