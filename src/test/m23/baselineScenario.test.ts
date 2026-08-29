import { describe, expect, it } from 'vitest'
import {
  M23_BASELINE_SCENARIO_ID,
  M23_FIXED_PRODUCT_MODULES,
  runM23BaselineScenario,
} from './baselineScenario'

describe('M23 deterministic baseline scenario', () => {
  it('locks the current state, ordered events and canonical replay to a committed digest', () => {
    const first = runM23BaselineScenario()
    const second = runM23BaselineScenario()

    expect(second).toEqual(first)
    expect(first.digest).toBe('5621dba2')
    expect(first.cases.every((fixture) => fixture.canonicalReplay.length > 0)).toBe(true)
  })

  it('covers the required gameplay branches under the fixed product configuration', () => {
    const result = runM23BaselineScenario()
    const events = result.cases.flatMap((fixture) => fixture.steps.flatMap((step) => step.events))
    const damage = events.filter((event) => event.type === 'damageApplied')
    const activeChanged = events.filter((event) => event.type === 'activeChanged')
    const ended = events.filter((event) => event.type === 'battleEnded')

    expect(damage.some((event) => !event.missed && event.amount > 0)).toBe(true)
    expect(damage.some((event) => event.missed)).toBe(true)
    expect(damage.some((event) => event.effectiveness === 0)).toBe(true)
    expect(damage.some((event) => event.crit && event.effectiveness >= 2)).toBe(true)
    expect(events.some((event) => event.type === 'statusApplied' && event.effectKind === 'buff')).toBe(true)
    expect(events.some((event) => event.type === 'statusApplied' && event.effectKind === 'heal')).toBe(true)
    expect(events.some((event) => event.type === 'heal')).toBe(true)
    expect(events.some((event) => event.type === 'wildAccident' && event.kind === 'terrainShift')).toBe(true)
    expect(activeChanged.some((event) => !event.forced)).toBe(true)
    expect(activeChanged.some((event) => event.forced)).toBe(true)
    expect(events.some((event) => event.type === 'chainOpportunity')).toBe(true)
    expect(events.some((event) => event.type === 'chainHit')).toBe(true)
    expect(events.some((event) => event.type === 'comboCast')).toBe(true)
    expect(result.cases.some((fixture) => fixture.steps.some((step) => step.input.type === 'ATTACK' && step.input.starStrike))).toBe(true)
    expect(ended.some((event) => event.winner === 'player' && event.reason === undefined)).toBe(true)
    expect(ended.some((event) => event.winner === 'foe')).toBe(true)
    expect(ended.some((event) => event.reason === 'timeout')).toBe(true)

    expect(result.productConfiguration.modules).toEqual(M23_FIXED_PRODUCT_MODULES)
    expect(result.productConfiguration.modules.encounterSkills).toBe(false)
    expect(result.productConfiguration.scanner).toBe('absent')
    expect(result.productConfiguration.synergyModifiers.length).toBeGreaterThan(0)
    expect(result.productConfiguration.heldItemPatchedAttack).toBeGreaterThan(100)
    expect(result.productConfiguration.assignedAbilities.every(Boolean)).toBe(true)
    expect(result.productConfiguration.chainMaxHits).toBeGreaterThan(0)
    expect(result.productConfiguration.comboId).toBeTruthy()
    expect(result.productConfiguration.evolvedSpeciesId).toBe(2)
    expect(result.productConfiguration.partnerStatusCount).toBeGreaterThan(0)
    expect(result.productConfiguration.artworkFixtures).toEqual([
      'artwork-404',
      'decode-failure',
      'large-texture',
    ])
  })

  it('rejects unknown suite ids and accepts an explicit deterministic seed', () => {
    expect(() => runM23BaselineScenario({ scenarioId: 'unknown' })).toThrow(/Unknown M23 baseline scenario/)
    expect(runM23BaselineScenario({ scenarioId: M23_BASELINE_SCENARIO_ID, seed: 'other-seed' }).digest)
      .not.toBe(runM23BaselineScenario().digest)
  })
})
