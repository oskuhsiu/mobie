import { afterEach, describe, expect, it, vi } from 'vitest'
import { createOwnedUnit } from '@/game/growth'
import { useRoster } from '@/store/rosterStore'
import { ITEM_BAG_STORAGE_KEY, useBag } from '@/store/bagStore'

describe('bagStore equipment accounting', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('serializes concurrent equips so one item cannot be spent twice', async () => {
    const first = createOwnedUnit('bag-concurrency-a', 1, 5)
    const second = createOwnedUnit('bag-concurrency-b', 4, 5)
    useRoster.setState({ roster: [first, second] })
    useBag.setState({ bag: { headband: 1 } })

    const results = await Promise.all([
      useBag.getState().equip(first.id, 'headband'),
      useBag.getState().equip(second.id, 'headband'),
    ])

    expect(results.filter(Boolean)).toHaveLength(1)
    expect(useBag.getState().bag.headband).toBe(0)
    expect(useRoster.getState().roster.filter((unit) => unit.heldItemId === 'headband')).toHaveLength(1)
  })

  it('rolls the canonical roster back when the bag write fails', async () => {
    const values = new Map<string, string>()
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        if (key === ITEM_BAG_STORAGE_KEY) throw new Error('bag write unavailable')
        values.set(key, value)
      },
      removeItem: (key: string) => { values.delete(key) },
    })
    const unit = createOwnedUnit('bag-storage-failure', 1, 5)
    useRoster.setState({ roster: [unit], loaded: true })
    useBag.setState({ bag: { headband: 1 } })

    await expect(useBag.getState().equip(unit.id, 'headband')).rejects.toThrow('保存道具庫存失敗')
    expect(useRoster.getState().roster[0]?.heldItemId).toBeUndefined()
    expect(useBag.getState().bag.headband).toBe(1)
  })
})
