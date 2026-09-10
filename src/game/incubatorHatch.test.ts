import { describe, expect, it, vi } from 'vitest'
import { addEgg, advanceAll, defaultIncubator } from './incubator'
import { defaultMeta } from './meta'
import {
  HatchCoordinator,
  HatchError,
  HatchMetaDestination,
  HatchRosterDestination,
  MemoryHatchIncubatorPersistence,
  MemoryHatchMetaPersistence,
  MemoryHatchRosterPersistence,
  hatchFingerprintFor,
  hatchOperationIdFor,
  prepareHatchPayload,
} from './incubatorHatch'

function readyEgg(source: 'achievement' | 'duplicate' = 'achievement') {
  let state = addEgg(defaultIncubator(), { source, speciesPool: [1], label: `${source} egg` })
  state = advanceAll(state, source === 'achievement' ? 6 : 8)
  return { state, egg: state.eggs[0]! }
}

function makeCoordinator(state = readyEgg().state) {
  const incubator = new MemoryHatchIncubatorPersistence(state)
  const rosterPersistence = new MemoryHatchRosterPersistence()
  const metaPersistence = new MemoryHatchMetaPersistence(defaultMeta())
  const roster = new HatchRosterDestination(rosterPersistence, () => 100)
  const meta = new HatchMetaDestination(metaPersistence, () => 101)
  const coordinator = new HatchCoordinator({ incubator, roster, meta }, () => 102)
  return { incubator, rosterPersistence, metaPersistence, roster, meta, coordinator }
}

describe('M24 Ticket 41 hatch identity and payload', () => {
  it('derives one stable operation/fingerprint pair from a ready supported egg', () => {
    const { egg } = readyEgg()
    const first = prepareHatchPayload(egg)
    const second = prepareHatchPayload({ ...egg, progress: egg.requiredProgress + 10 })
    expect(first.hatchOperationId).toBe(hatchOperationIdFor(egg))
    expect(first.hatchFingerprint).toBe(hatchFingerprintFor(egg))
    expect(second).toEqual(first)
    expect(first.eggId).toBe(egg.id)
    expect(first.unit.seed).toBe(egg.seed)
  })

  it('rejects an unready egg and a legacy Tower source without creating a payload', () => {
    const incubating = addEgg(defaultIncubator(), { source: 'achievement', speciesPool: [1], label: 'not ready' }).eggs[0]!
    expect(() => prepareHatchPayload(incubating)).toThrowError(HatchError)
    const tower = { ...readyEgg('achievement').egg, source: 'tower' as const }
    expect(() => prepareHatchPayload(tower)).toThrowError(expect.objectContaining({ code: 'invalid-source' }))
    const forged = { ...readyEgg('achievement').egg, seed: 'model-derived-seed' }
    expect(() => prepareHatchPayload(forged)).toThrowError(expect.objectContaining({ code: 'invalid-source' }))
  })
})

describe('M24 Ticket 41 durable hatch boundaries', () => {
  it('writes an incubator outbox first and applies roster/meta exactly once on duplicate click', async () => {
    const { incubator, rosterPersistence, metaPersistence, roster, meta, coordinator } = makeCoordinator()
    const hasRoster = vi.spyOn(roster, 'hasApplied')
    const hasMeta = vi.spyOn(meta, 'hasApplied')
    const eggId = incubator.state.eggs[0]!.id

    const [first, second] = await Promise.all([coordinator.hatchOnce(eggId), coordinator.hatchOnce(eggId)])

    expect(first.status).toBe('applied')
    expect(second.status).toBe('already-applied')
    expect(rosterPersistence.roster).toHaveLength(1)
    expect(metaPersistence.meta.registered).toContain(1)
    expect(metaPersistence.meta.stats.captures).toBe(1)
    expect(incubator.state.eggs).toHaveLength(0)
    expect(incubator.state.hatchOutbox).toMatchObject([{ status: 'settled', eggId }])
    expect(incubator.savePendingCount).toBe(1)
    expect(incubator.saveFinalCount).toBe(1)
    expect(rosterPersistence.savePendingCount).toBe(1)
    expect(metaPersistence.savePendingCount).toBe(1)
    expect(hasRoster).toHaveBeenCalledTimes(1)
    expect(hasMeta).toHaveBeenCalledTimes(1)
  })

  it('retries only the failed Meta child after roster success', async () => {
    const deps = makeCoordinator()
    const eggId = deps.incubator.state.eggs[0]!.id
    deps.metaPersistence.failPending = true

    await expect(deps.coordinator.hatchOnce(eggId)).rejects.toMatchObject({ code: 'storage' })
    expect(deps.rosterPersistence.roster).toHaveLength(1)
    expect(deps.rosterPersistence.savePendingCount).toBe(1)
    expect(deps.metaPersistence.meta.stats.captures).toBe(0)
    expect(deps.incubator.state.eggs).toHaveLength(1)
    expect(deps.incubator.state.hatchOutbox?.[0]).toMatchObject({ status: 'pending', eggId })

    deps.metaPersistence.failPending = false
    const retry = await deps.coordinator.hatchOnce(eggId)
    expect(retry.status).toBe('already-applied')
    expect(deps.rosterPersistence.savePendingCount).toBe(1)
    expect(deps.metaPersistence.savePendingCount).toBe(1)
    expect(deps.metaPersistence.meta.stats.captures).toBe(1)
    expect(deps.incubator.state.eggs).toHaveLength(0)
    expect(deps.incubator.state.hatchOutbox?.[0]?.status).toBe('settled')
  })

  it('reconciles children when the final incubator receipt write fails', async () => {
    const deps = makeCoordinator()
    const eggId = deps.incubator.state.eggs[0]!.id
    deps.incubator.failFinal = true

    await expect(deps.coordinator.hatchOnce(eggId)).rejects.toMatchObject({ code: 'receipt' })
    expect(deps.rosterPersistence.roster).toHaveLength(1)
    expect(deps.metaPersistence.meta.stats.captures).toBe(1)
    expect(deps.rosterPersistence.savePendingCount).toBe(1)
    expect(deps.metaPersistence.savePendingCount).toBe(1)
    expect(deps.incubator.state.eggs).toHaveLength(1)
    expect(deps.incubator.state.hatchOutbox?.[0]?.status).toBe('pending')

    deps.incubator.failFinal = false
    const retry = await deps.coordinator.recoverPending()
    expect(retry).toMatchObject({ attempted: 1, completed: 1, errors: [] })
    expect(deps.rosterPersistence.savePendingCount).toBe(1)
    expect(deps.metaPersistence.savePendingCount).toBe(1)
    expect(deps.incubator.state.eggs).toHaveLength(0)
    expect(deps.incubator.state.hatchOutbox?.[0]?.status).toBe('settled')
  })

  it('rejects operation reuse with a different fingerprint without touching the roster', async () => {
    const deps = makeCoordinator()
    const egg = deps.incubator.state.eggs[0]!
    const payload = prepareHatchPayload(egg)
    await deps.roster.applyOnce(payload, payload)
    await expect(deps.roster.applyOnce(
      { ...payload, hatchFingerprint: `${payload.hatchFingerprint}:collision` },
      payload,
    )).rejects.toMatchObject({ code: 'collision' })
    expect(deps.rosterPersistence.roster).toHaveLength(1)
    expect(deps.rosterPersistence.savePendingCount).toBe(1)
  })
})
