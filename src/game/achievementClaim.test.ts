import { describe, expect, it, vi } from 'vitest'
import { bumpStat, defaultMeta } from './meta'
import { defaultIncubator } from './incubator'
import {
  AchievementClaimCoordinator,
  AchievementEggDestination,
  AchievementSpDestination,
  AchievementClaimError,
  MemoryAchievementEggPersistence,
  MemoryAchievementMetaPersistence,
  MemoryAchievementSpPersistence,
  identityFor,
} from './achievementClaim'

function dependencies(metaPersistence: MemoryAchievementMetaPersistence, eggPersistence: MemoryAchievementEggPersistence) {
  return {
    meta: metaPersistence,
    egg: new AchievementEggDestination(eggPersistence, () => 100),
  }
}

describe('M24 Achievement claim durable boundaries', () => {
  it('writes Meta outbox first and claims one achievement egg under double click', async () => {
    const metaPersistence = new MemoryAchievementMetaPersistence(bumpStat(defaultMeta(), 'captures'))
    const eggPersistence = new MemoryAchievementEggPersistence(defaultIncubator())
    const coordinator = new AchievementClaimCoordinator(dependencies(metaPersistence, eggPersistence), () => 100)

    const [first, second] = await Promise.all([
      coordinator.claimOnce('firstcatch'),
      coordinator.claimOnce('firstcatch'),
    ])

    expect(first.status).toBe('applied')
    expect(second.status).toBe('already-applied')
    expect(eggPersistence.state.eggs).toHaveLength(1)
    expect(eggPersistence.state.eggs[0]?.source).toBe('achievement')
    expect(metaPersistence.meta.achievements.firstcatch).toBe(100)
    expect(metaPersistence.meta.achievementClaims).toMatchObject([{
      claimOperationId: 'achievement-claim:v1:firstcatch',
      status: 'settled',
      reward: { kind: 'egg' },
    }])
  })

  it('reconciles reward success when Meta finalize fails without regranting the egg', async () => {
    const metaPersistence = new MemoryAchievementMetaPersistence(bumpStat(defaultMeta(), 'captures'))
    const eggPersistence = new MemoryAchievementEggPersistence(defaultIncubator())
    const coordinator = new AchievementClaimCoordinator(dependencies(metaPersistence, eggPersistence), () => 200)
    metaPersistence.failFinal = true

    await expect(coordinator.claimOnce('firstcatch')).rejects.toMatchObject({ code: 'receipt' })
    expect(eggPersistence.state.eggs).toHaveLength(1)
    expect(metaPersistence.meta.achievementClaims?.[0]).toMatchObject({ status: 'pending' })

    metaPersistence.failFinal = false
    const retry = await coordinator.claimOnce('firstcatch')
    expect(retry.status).toBe('already-applied')
    expect(eggPersistence.state.eggs).toHaveLength(1)
    expect(metaPersistence.meta.achievements.firstcatch).toBe(200)
    expect(metaPersistence.meta.achievementClaims?.[0]).toMatchObject({ status: 'settled' })
  })

  it('keeps a pending outbox recoverable after the reward boundary fails', async () => {
    const metaPersistence = new MemoryAchievementMetaPersistence(bumpStat(defaultMeta(), 'captures'))
    const eggPersistence = new MemoryAchievementEggPersistence(defaultIncubator())
    const deps = dependencies(metaPersistence, eggPersistence)
    const coordinator = new AchievementClaimCoordinator(deps, () => 300)
    eggPersistence.failPending = true

    await expect(coordinator.claimOnce('firstcatch')).rejects.toMatchObject({ code: 'storage' })
    expect(metaPersistence.meta.achievementClaims?.[0]).toMatchObject({ status: 'pending' })
    expect(eggPersistence.state.eggs).toHaveLength(0)

    eggPersistence.failPending = false
    const recovery = await coordinator.recoverPending()
    expect(recovery).toMatchObject({ attempted: 1, completed: 1, errors: [] })
    expect(eggPersistence.state.eggs).toHaveLength(1)
    expect(metaPersistence.meta.achievements.firstcatch).toBe(300)
  })

  it('rejects a reused operation id with a different fingerprint', async () => {
    const persistence = new MemoryAchievementEggPersistence(defaultIncubator())
    const destination = new AchievementEggDestination(persistence)
    const first = identityFor('firstcatch', { kind: 'egg', label: 'A', speciesPool: [1] })
    await destination.applyOnce(first, { achievementId: 'firstcatch', reward: { kind: 'egg', label: 'A', speciesPool: [1] } })

    const collision = identityFor('firstcatch', { kind: 'egg', label: 'B', speciesPool: [1] })
    // Keep the stable operation namespace while changing only the fingerprint.
    await expect(destination.applyOnce(
      { claimOperationId: first.claimOperationId, rewardFingerprint: collision.rewardFingerprint },
      { achievementId: 'firstcatch', reward: { kind: 'egg', label: 'B', speciesPool: [1] } },
    )).rejects.toBeInstanceOf(AchievementClaimError)
    await expect(destination.applyOnce(
      { claimOperationId: first.claimOperationId, rewardFingerprint: collision.rewardFingerprint },
      { achievementId: 'firstcatch', reward: { kind: 'egg', label: 'B', speciesPool: [1] } },
    )).rejects.toMatchObject({ code: 'collision' })
    expect(persistence.state.eggs).toHaveLength(1)
  })

  it('supports the independent SP reward boundary with exactly-once accounting', async () => {
    const persistence = new MemoryAchievementSpPersistence(4)
    const destination = new AchievementSpDestination(persistence, () => 400)
    const reward = { kind: 'sp' as const, label: '試煉 SP', amount: 3 }
    const identity = identityFor('synthetic-sp', reward)
    const first = await destination.applyOnce(identity, { achievementId: 'synthetic-sp', reward })
    const second = await destination.applyOnce(identity, { achievementId: 'synthetic-sp', reward: { ...reward, amount: 99 } })

    expect(first).toMatchObject({ status: 'applied', before: 4, after: 7, delta: 3 })
    expect(second).toMatchObject({ status: 'already-applied', after: 7 })
    expect(persistence.points).toBe(7)
    expect(persistence.savePendingCount).toBe(1)
  })

  it('never grants SP when the durable claim marker cannot be read', async () => {
    const persistence = new MemoryAchievementSpPersistence(4)
    vi.spyOn(persistence, 'loadMarkers').mockRejectedValue(new Error('marker storage unavailable'))
    const destination = new AchievementSpDestination(persistence)
    const reward = { kind: 'sp' as const, label: '試煉 SP', amount: 3 }
    const identity = identityFor('synthetic-sp-read-error', reward)

    await expect(destination.applyOnce(identity, { achievementId: 'synthetic-sp-read-error', reward }))
      .rejects.toMatchObject({ code: 'storage' })
    expect(persistence.points).toBe(4)
    expect(persistence.savePendingCount).toBe(0)
  })
})
