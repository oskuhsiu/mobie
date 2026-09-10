// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { AchievementsModal } from './AchievementsModal'
import { bumpStat, defaultMeta, saveMetaState } from '@/game/meta'
import { defaultIncubator, saveIncubatorState } from '@/game/incubator'
import { useMeta } from '@/store/metaStore'
import { useIncubator } from '@/store/incubatorStore'

describe('AchievementsModal durable claim journey', () => {
  beforeEach(() => {
    localStorage.clear()
    const meta = bumpStat(defaultMeta(), 'captures')
    const incubator = defaultIncubator()
    saveMetaState(meta)
    saveIncubatorState(incubator)
    useMeta.setState({ meta, loaded: true, claimBusy: null, claimErrors: {} })
    useIncubator.setState({ state: incubator, loaded: true })
  })

  afterEach(() => cleanup())

  it('claims once, updates the incubator projection, and survives remount', async () => {
    const { unmount } = render(<AchievementsModal onClose={() => undefined} />)
    fireEvent.click(screen.getByRole('button', { name: '領取' }))

    await waitFor(() => expect(screen.getByText('✓ 已領取')).toBeTruthy())
    expect(useIncubator.getState().state.eggs).toHaveLength(1)
    expect(useIncubator.getState().state.eggs[0]?.source).toBe('achievement')
    expect(JSON.parse(localStorage.getItem('mobie.meta.v1') ?? 'null')).toMatchObject({
      achievements: { firstcatch: expect.any(Number) },
      achievementClaims: [{ status: 'settled', achievementId: 'firstcatch' }],
    })
    expect(JSON.parse(localStorage.getItem('mobie.incubator.v1') ?? 'null')).toMatchObject({
      eggs: [{ source: 'achievement' }],
      achievementClaims: [{ status: 'settled', achievementId: 'firstcatch' }],
    })
    expect(localStorage.getItem('mobie.achievement.claim.meta.v1')).toContain('settled')
    expect(localStorage.getItem('mobie.achievement.claim.incubator.v1')).toContain('settled')

    unmount()
    render(<AchievementsModal onClose={() => undefined} />)
    expect(screen.getByText('✓ 已領取')).toBeTruthy()
    expect(screen.queryByRole('button', { name: '領取' })).toBeNull()
  })
})
