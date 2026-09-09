import { describe, expect, it, vi } from 'vitest'
import { createOwnedUnit } from '@/game/growth'
import {
  MemoryRosterGrowthPersistence,
  MemoryMetaSettlementPersistence,
  MemorySkillPointsPersistence,
  MemorySettlementJournal,
  MetaSettlementDestination,
  MemoryIncubatorProgressionPersistence,
  MemoryTowerProgressionPersistence,
  IncubatorProgressionDestination,
  ResultSettlementCoordinator,
  RosterGrowthDestination,
  ResultSettlementError,
  RESULT_MARKER_LIMIT,
  SkillPointsDestination,
  TowerProgressionDestination,
  retainResultMarkers,
  type ResultIdentity,
  type RosterGrowthMarker,
} from './resultSettlement'
import { defaultMeta, bumpStat } from './meta'
import { addEgg, defaultIncubator } from './incubator'

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

  it('does not roll back a later roster change while reconciling a pending marker', async () => {
    const persistence = new MemoryRosterGrowthPersistence([unit])
    const destination = new RosterGrowthDestination(persistence, () => 250)
    persistence.failMarker = true
    await expect(destination.applyOnce(identity, payload)).rejects.toMatchObject({ code: 'receipt' })
    persistence.failMarker = false

    const settledUnit = persistence.roster[0]
    if (!settledUnit) throw new Error('expected canonical roster unit')
    persistence.roster = [{ ...settledUnit, exp: settledUnit.exp + 100, heldItemId: 'lifeorb' }]
    const retry = await destination.applyOnce(identity, payload)

    expect(retry.status).toBe('already-applied')
    expect(persistence.roster[0]).toMatchObject({ exp: settledUnit.exp + 100, heldItemId: 'lifeorb' })
    expect(persistence.saveCount).toBe(1)
  })

  it('reconciles a child apply when the coordinator receipt write fails', async () => {
    const persistence = new MemoryRosterGrowthPersistence([unit])
    const destination = new RosterGrowthDestination(persistence, () => 300)
    const hasApplied = vi.spyOn(destination, 'hasApplied')
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
    expect(hasApplied).toHaveBeenCalledTimes(1)

    const remount = await coordinator.settle(identity, { ...payload, ratio: 0.01 })
    expect(remount.status).toBe('already-applied')
    expect(persistence.saveCount).toBe(1)
    expect(hasApplied).toHaveBeenCalledTimes(2)
  })
})

describe('SP and Meta result settlement children', () => {
  it('apply each child once and reject same-id fingerprint collisions', async () => {
    const spPersistence = new MemorySkillPointsPersistence(4)
    const sp = new SkillPointsDestination(spPersistence, () => 400)
    const first = await sp.applyOnce(identity, { delta: 3 })
    const second = await sp.applyOnce(identity, { delta: 99 })
    expect(first).toMatchObject({ status: 'applied', before: 4, after: 7, delta: 3 })
    expect(second).toMatchObject({ status: 'already-applied', after: 7 })
    expect(spPersistence.points).toBe(7)
    await expect(sp.applyOnce({ ...identity, resultFingerprint: 'collision' }, { delta: 1 }))
      .rejects.toMatchObject({ code: 'collision' })

    const metaPersistence = new MemoryMetaSettlementPersistence(defaultMeta())
    const meta = new MetaSettlementDestination(metaPersistence, () => 401)
    const metaFirst = await meta.applyOnce(identity, { winMode: 'wild', evolutions: [{ toSpecies: 2 }] })
    const metaSecond = await meta.applyOnce(identity, { winMode: 'arena', evolutions: [{ toSpecies: 3 }] })
    expect(metaFirst).toMatchObject({ status: 'applied', winMode: 'wild', evolutionCount: 1 })
    expect(metaSecond).toMatchObject({ status: 'already-applied', meta: metaFirst.meta })
    expect(metaPersistence.meta.stats.wins).toBe(1)
    expect(metaPersistence.meta.stats.arenaWins).toBe(0)
    expect(metaPersistence.meta.stats.evolutions).toBe(1)
    await expect(meta.applyOnce({ ...identity, resultFingerprint: 'collision' }, { winMode: 'arena' }))
      .rejects.toMatchObject({ code: 'collision' })
  })

  it('reconciles canonical SP/meta writes after receipt failure without a second grant', async () => {
    const spPersistence = new MemorySkillPointsPersistence(2)
    const sp = new SkillPointsDestination(spPersistence, () => 410)
    spPersistence.failMarker = true
    await expect(sp.applyOnce(identity, { delta: 5 })).rejects.toMatchObject({ code: 'receipt' })
    expect(spPersistence.points).toBe(7)
    expect(await sp.hasApplied(identity)).toBe(true)
    // Spending the exact reward back to the old balance must not make retry
    // grant it a second time: the canonical envelope carries the marker.
    spPersistence.points = 2
    spPersistence.failMarker = false
    await expect(sp.applyOnce(identity, { delta: 50 })).resolves.toMatchObject({ status: 'already-applied', after: 7 })
    expect(spPersistence.saveCount).toBe(1)
    expect(spPersistence.points).toBe(2)

    const failedCanonical = new MemorySkillPointsPersistence(3)
    const failedDestination = new SkillPointsDestination(failedCanonical, () => 412)
    failedCanonical.failPending = true
    await expect(failedDestination.applyOnce({ resultId: 'battle-2', resultFingerprint: 'fp-2' }, { delta: 4 }))
      .rejects.toMatchObject({ code: 'storage' })
    failedCanonical.points += 2 // A legitimate later wallet grant.
    failedCanonical.failPending = false
    await expect(failedDestination.applyOnce({ resultId: 'battle-2', resultFingerprint: 'fp-2' }, { delta: 99 }))
      .resolves.toMatchObject({ status: 'already-applied', after: 7 })
    expect(failedCanonical.points).toBe(9)

    const metaPersistence = new MemoryMetaSettlementPersistence(defaultMeta())
    const meta = new MetaSettlementDestination(metaPersistence, () => 411)
    metaPersistence.failMarker = true
    await expect(meta.applyOnce(identity, { winMode: 'arena' })).rejects.toMatchObject({ code: 'receipt' })
    expect(metaPersistence.meta.stats.arenaWins).toBe(1)
    // A later capture write is preserved while the pending result receipt is reconciled.
    metaPersistence.meta = bumpStat(metaPersistence.meta, 'captures')
    metaPersistence.failMarker = false
    await expect(meta.applyOnce(identity, { winMode: 'wild' })).resolves.toMatchObject({ status: 'already-applied' })
    expect(metaPersistence.meta.stats.arenaWins).toBe(1)
    expect(metaPersistence.meta.stats.wins).toBe(0)
    expect(metaPersistence.meta.stats.captures).toBe(1)
    expect(metaPersistence.saveCount).toBe(1)

    const failedMetaPersistence = new MemoryMetaSettlementPersistence(defaultMeta())
    const failedMeta = new MetaSettlementDestination(failedMetaPersistence, () => 413)
    failedMetaPersistence.failPending = true
    const firstIdentity = { resultId: 'battle-3', resultFingerprint: 'fp-3' }
    await expect(failedMeta.applyOnce(firstIdentity, { winMode: 'wild' })).rejects.toMatchObject({ code: 'storage' })
    failedMetaPersistence.meta = bumpStat(failedMetaPersistence.meta, 'wins') // A later, unrelated Result win.
    failedMetaPersistence.failPending = false
    await expect(failedMeta.applyOnce(firstIdentity, { winMode: 'arena' })).resolves.toMatchObject({ status: 'already-applied' })
    expect(failedMetaPersistence.meta.stats.wins).toBe(2)
    expect(failedMetaPersistence.meta.stats.arenaWins).toBe(0)
  })

  it('retries only the failed child after a partial coordinator settlement', async () => {
    const rosterPersistence = new MemoryRosterGrowthPersistence([unit])
    const roster = new RosterGrowthDestination(rosterPersistence, () => 420)
    const spPersistence = new MemorySkillPointsPersistence(0)
    const sp = new SkillPointsDestination(spPersistence, () => 421)
    const metaPersistence = new MemoryMetaSettlementPersistence(defaultMeta())
    const meta = new MetaSettlementDestination(metaPersistence, () => 422)
    const journal = new MemorySettlementJournal()
    const coordinator = new ResultSettlementCoordinator(roster, journal, () => 423, { skillPoints: sp, meta })

    spPersistence.failMarker = true
    await expect(coordinator.settle(identity, {
      ...payload,
      skillPoints: { delta: 4 },
      meta: { winMode: 'arena' },
    })).rejects.toMatchObject({ code: 'receipt' })
    expect(rosterPersistence.saveCount).toBe(1)
    expect(spPersistence.points).toBe(4)
    expect(metaPersistence.meta.stats.arenaWins).toBe(0)

    spPersistence.failMarker = false
    const retry = await coordinator.settle(identity, {
      ...payload,
      ratio: 0.01,
      skillPoints: { delta: 99 },
      meta: { winMode: 'wild' },
    })
    expect(retry.status).toBe('already-applied')
    expect(retry.skillPoints).toMatchObject({ status: 'already-applied', after: 4 })
    expect(retry.meta).toMatchObject({ status: 'applied', winMode: 'wild' })
    expect(rosterPersistence.saveCount).toBe(1)
    expect(spPersistence.points).toBe(4)
    expect(metaPersistence.meta.stats.wins).toBe(1)
    expect(metaPersistence.meta.stats.arenaWins).toBe(0)
  })
})

describe('Tower and incubator result settlement children', () => {
  it('applies tower floor and boss unlock once, then rejects fingerprint collision', async () => {
    const persistence = new MemoryTowerProgressionPersistence()
    const destination = new TowerProgressionDestination(persistence, () => 500)

    const first = await destination.applyOnce(identity, { floor: 5, ascension: 1, outcome: 'win' })
    const second = await destination.applyOnce(identity, { floor: 9, ascension: 3, outcome: 'win' })

    expect(first).toMatchObject({ status: 'applied', floor: 5, ascension: 1, outcome: 'win' })
    expect(first.after).toEqual({ bestFloor: 5, ascensionUnlocked: 2 })
    expect(second).toMatchObject({ status: 'already-applied', after: first.after })
    expect(persistence.run).toEqual(first.after)
    expect(persistence.saveCount).toBe(1)
    await expect(destination.applyOnce({ ...identity, resultFingerprint: 'tower-collision' }, {
      floor: 5,
      ascension: 1,
      outcome: 'win',
    })).rejects.toMatchObject({ code: 'collision' })
  })

  it('reconciles tower canonical progress after its receipt write fails without a second mutation', async () => {
    const persistence = new MemoryTowerProgressionPersistence()
    const destination = new TowerProgressionDestination(persistence, () => 510)
    persistence.failMarker = true

    await expect(destination.applyOnce(identity, { floor: 10, ascension: 0, outcome: 'win' }))
      .rejects.toMatchObject({ code: 'receipt' })
    expect(persistence.run).toEqual({ bestFloor: 10, ascensionUnlocked: 1 })
    expect(await destination.hasApplied(identity)).toBe(true)

    persistence.failMarker = false
    const retry = await destination.applyOnce(identity, { floor: 1, ascension: 4, outcome: 'lose' })
    expect(retry).toMatchObject({ status: 'already-applied', after: { bestFloor: 10, ascensionUnlocked: 1 } })
    expect(persistence.saveCount).toBe(1)
  })

  it('advances only existing supported eggs and validates an explicit source guard', async () => {
    let state = addEgg(defaultIncubator(), { source: 'achievement', speciesPool: [1], label: 'A' })
    state = addEgg(state, { source: 'duplicate', speciesPool: [4], label: 'D' })
    state = addEgg(state, { source: 'tower', speciesPool: [7], label: 'legacy tower' })
    const persistence = new MemoryIncubatorProgressionPersistence(state)
    const destination = new IncubatorProgressionDestination(persistence, () => 520)

    const first = await destination.applyOnce(identity, { amount: 2 })
    const second = await destination.applyOnce(identity, { amount: 99 })

    expect(first).toMatchObject({ status: 'applied', amount: 2 })
    expect(first.updates.map((update) => update.source)).toEqual(['achievement', 'duplicate'])
    expect(persistence.state.eggs.map((egg) => egg.progress)).toEqual([2, 2, 0])
    expect(second).toMatchObject({ status: 'already-applied', amount: 2 })
    expect(persistence.saveCount).toBe(1)
    await expect(destination.applyOnce({ ...identity, resultFingerprint: 'incubator-collision' }, { amount: 1 }))
      .rejects.toMatchObject({ code: 'collision' })
    await expect(destination.applyOnce({ resultId: 'invalid-source', resultFingerprint: 'fp' }, { amount: 1, source: 'tower' }))
      .rejects.toMatchObject({ code: 'invalid-source' })
  })

  it('reconciles incubator progress after receipt failure and preserves later egg changes', async () => {
    const state = addEgg(defaultIncubator(), { source: 'duplicate', speciesPool: [1], label: 'D' })
    const persistence = new MemoryIncubatorProgressionPersistence(state)
    const destination = new IncubatorProgressionDestination(persistence, () => 530)
    persistence.failMarker = true

    await expect(destination.applyOnce(identity, { amount: 2 })).rejects.toMatchObject({ code: 'receipt' })
    expect(persistence.state.eggs[0]?.progress).toBe(2)
    persistence.state.eggs[0] = { ...persistence.state.eggs[0]!, progress: 3 }
    persistence.state = addEgg(persistence.state, { source: 'achievement', speciesPool: [4], label: 'later' })
    persistence.failMarker = false

    const retry = await destination.applyOnce(identity, { amount: 99 })
    expect(retry.status).toBe('already-applied')
    expect(persistence.state.eggs.map((egg) => egg.progress)).toEqual([3, 0])
    expect(persistence.saveCount).toBe(1)
  })

  it('retries only the incomplete tower or incubator child after a partial coordinator failure', async () => {
    const rosterPersistence = new MemoryRosterGrowthPersistence([unit])
    const roster = new RosterGrowthDestination(rosterPersistence, () => 540)
    const towerPersistence = new MemoryTowerProgressionPersistence()
    const tower = new TowerProgressionDestination(towerPersistence, () => 541)
    const incubatorPersistence = new MemoryIncubatorProgressionPersistence(
      addEgg(defaultIncubator(), { source: 'achievement', speciesPool: [1], label: 'A' }),
    )
    const incubator = new IncubatorProgressionDestination(incubatorPersistence, () => 542)
    const journal = new MemorySettlementJournal()
    const coordinator = new ResultSettlementCoordinator(roster, journal, () => 543, { tower, incubator })
    towerPersistence.failMarker = true

    await expect(coordinator.settle(identity, {
      ...payload,
      tower: { floor: 5, ascension: 0, outcome: 'win' },
      incubator: { amount: 2 },
    })).rejects.toMatchObject({ code: 'receipt' })
    expect(rosterPersistence.saveCount).toBe(1)
    expect(towerPersistence.saveCount).toBe(1)
    expect(incubatorPersistence.saveCount).toBe(0)

    towerPersistence.failMarker = false
    const retry = await coordinator.settle(identity, {
      ...payload,
    })
    expect(retry.status).toBe('already-applied')
    expect(retry.tower).toMatchObject({ status: 'already-applied' })
    expect(retry.incubator).toMatchObject({ status: 'applied', amount: 2 })
    expect(rosterPersistence.saveCount).toBe(1)
    expect(towerPersistence.saveCount).toBe(1)
    expect(incubatorPersistence.saveCount).toBe(1)
    expect(incubatorPersistence.state.eggs[0]?.progress).toBe(2)
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
    before: [],
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
