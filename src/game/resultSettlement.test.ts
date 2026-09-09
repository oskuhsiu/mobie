import { describe, expect, it } from 'vitest'
import { createOwnedUnit } from '@/game/growth'
import {
  MemoryRosterGrowthPersistence,
  MemorySettlementJournal,
  ResultSettlementCoordinator,
  RosterGrowthDestination,
  ResultSettlementError,
  RESULT_MARKER_LIMIT,
  retainResultMarkers,
  type ResultIdentity,
  type RosterGrowthMarker,
} from './resultSettlement'

const identity: ResultIdentity = { resultId: 'battle-1', resultFingerprint: 'fp-1' }
const unit = createOwnedUnit('unit-1', 1, 15)
const payload = { unitIds: [unit.id], foeLevels: [30], ratio: 1, outcome: 'win' as const }

describe('roster result settlement', () => {
  it('applies growth/evolution once and returns the existing receipt on concurrent retry', async () => {
    const persistence = new MemoryRosterGrowthPersistence([unit])
    const destination = new RosterGrowthDestination(persistence, () => 100)

    const [first, second] = await Promise.all([
      destination.applyOnce(identity, payload),
      destination.applyOnce(identity, payload),
    ])

    expect(first.status).toBe('applied')
    expect(second.status).toBe('already-applied')
    expect(first).not.toHaveProperty('roster')
    expect(first.results[0]?.gained).toBeGreaterThan(0)
    expect(first.evolutions).toEqual([{ unitId: unit.id, fromSpecies: 1, toSpecies: 2, atLevel: 16 }])
    expect(second.results).toEqual(first.results)
    expect(persistence.saveCount).toBe(1)
    expect((await persistence.loadMarkers())[0]).toMatchObject({ status: 'settled', outcome: 'win' })
  })

  it('rejects an id reused with a different fingerprint without touching the roster', async () => {
    const persistence = new MemoryRosterGrowthPersistence([unit])
    const destination = new RosterGrowthDestination(persistence)
    await destination.applyOnce(identity, payload)
    const before = await persistence.loadRoster()

    await expect(destination.applyOnce(
      { resultId: identity.resultId, resultFingerprint: 'different-fp' },
      { ...payload, ratio: 0.15 },
    )).rejects.toMatchObject({ code: 'collision' })
    expect(await persistence.loadRoster()).toEqual(before)
  })

  it('reconciles a canonical write when the final receipt write fails', async () => {
    const persistence = new MemoryRosterGrowthPersistence([unit])
    const destination = new RosterGrowthDestination(persistence, () => 200)
    persistence.failMarker = true

    await expect(destination.applyOnce(identity, payload)).rejects.toMatchObject({ code: 'receipt' })
    expect(persistence.saveCount).toBe(1)
    persistence.failMarker = false

    const retry = await destination.applyOnce(identity, { ...payload, ratio: 0.15 })
    expect(retry.status).toBe('already-applied')
    // The retry finalized the pending marker and did not rewrite the roster.
    expect(persistence.saveCount).toBe(1)
    expect((await persistence.loadMarkers())[0]?.status).toBe('settled')
  })

  it('reconciles a child apply when the coordinator receipt write fails', async () => {
    const persistence = new MemoryRosterGrowthPersistence([unit])
    const destination = new RosterGrowthDestination(persistence, () => 300)
    const journal = new MemorySettlementJournal()
    journal.failOnSave = 2
    const coordinator = new ResultSettlementCoordinator(destination, journal, () => 300)

    await expect(coordinator.settle(identity, payload)).rejects.toMatchObject({ code: 'receipt' })
    expect(persistence.saveCount).toBe(1)

    journal.failOnSave = undefined
    const retry = await coordinator.settle(identity, { ...payload, ratio: 0.15 })
    expect(retry.status).toBe('already-applied')
    expect(persistence.saveCount).toBe(1)
    expect((await journal.load())[0]).toMatchObject({ status: 'settled', resultId: identity.resultId })

    const remount = await coordinator.settle(identity, { ...payload, ratio: 0.01 })
    expect(remount.status).toBe('already-applied')
    expect(persistence.saveCount).toBe(1)
  })
})

describe('result marker retention', () => {
  const settledMarker = (id: number, leftResultAt = id): RosterGrowthMarker => ({
    resultId: `battle-${id}`,
    resultFingerprint: `fp-${id}`,
    destination: 'roster-growth',
    status: 'settled',
    createdAt: id,
    settledAt: id,
    leftResultAt,
    updates: [],
    receipt: {
      resultId: `battle-${id}`,
      resultFingerprint: `fp-${id}`,
      results: [],
      evolutions: [],
      moveLearns: [],
      appliedAt: id,
    },
  })

  it('keeps the most recent 128 durable settled markers', () => {
    const retained = retainResultMarkers(
      Array.from({ length: RESULT_MARKER_LIMIT + 7 }, (_, index) => settledMarker(index + 1)),
    )
    expect(retained).toHaveLength(RESULT_MARKER_LIMIT)
    expect(retained.at(-1)?.resultId).toBe(`battle-${RESULT_MARKER_LIMIT + 7}`)
  })

  it('never prunes current or unsettled markers', () => {
    const current = settledMarker(999)
    const pending: RosterGrowthMarker = { ...settledMarker(1000), status: 'pending', leftResultAt: undefined }
    const retained = retainResultMarkers(
      [current, pending, ...Array.from({ length: RESULT_MARKER_LIMIT + 4 }, (_, index) => settledMarker(index + 1))],
      current,
    )
    expect(retained.some((marker) => marker.resultId === current.resultId)).toBe(true)
    expect(retained.some((marker) => marker.resultId === pending.resultId)).toBe(true)
    expect(retained.filter((marker) => marker.status === 'settled')).toHaveLength(RESULT_MARKER_LIMIT + 1)
  })
})

it('exposes a typed collision error for callers that need a recoverable UI state', () => {
  const error = new ResultSettlementError('collision', identity, 'collision')
  expect(error).toMatchObject({ code: 'collision', identity })
})
