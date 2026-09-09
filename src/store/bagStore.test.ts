import { describe, expect, it } from 'vitest'
import { createOwnedUnit } from '@/game/growth'
import { useRoster } from '@/store/rosterStore'
import { useBag } from '@/store/bagStore'

describe('bagStore equipment accounting', () => {
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
})
