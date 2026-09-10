// @vitest-environment jsdom

import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { addEgg, advanceAll, defaultIncubator, saveIncubatorState } from '@/game/incubator'
import { defaultMeta, saveMetaState } from '@/game/meta'
import { useIncubator } from '@/store/incubatorStore'
import { useMeta } from '@/store/metaStore'
import { useRoster } from '@/store/rosterStore'
import { renderGameJourney } from '@/test/renderGameJourney'

vi.mock('@/audio/audioEngine', () => ({
  audio: { unlock: vi.fn(async () => undefined), play: vi.fn() },
}))

describe('Incubator hatch journey', () => {
  beforeEach(() => {
    localStorage.clear()
    const incubator = advanceAll(
      addEgg(defaultIncubator(), { source: 'achievement', speciesPool: [1], label: '成就測試蛋' }),
      6,
    )
    const meta = defaultMeta()
    saveIncubatorState(incubator)
    saveMetaState(meta)
    useIncubator.setState({ state: incubator, loaded: true, loadError: null, hatchBusy: null, hatchErrors: {}, lastHatch: null })
    useMeta.setState({ meta, loaded: true, claimBusy: null, claimErrors: {} })
    useRoster.setState({ roster: [], loaded: true, lastResults: [], lastEvolutions: [], lastMoveLearns: [], lastCaptured: null })
  })

  it('hatches a real ready egg into roster/Dex and renders the reduced-motion-safe facts', async () => {
    renderGameJourney()
    fireEvent.click(screen.getByRole('button', { name: '更多' }))
    fireEvent.click(await screen.findByRole('button', { name: /孵化所/ }))
    expect(await screen.findByText('成就測試蛋')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '孵化' }))

    await waitFor(() => expect(screen.getByTestId('hatch-reveal')).toBeTruthy())
    expect(screen.getByText('妙蛙種子')).toBeTruthy()
    expect(screen.getByText('✓ 已加入 roster')).toBeTruthy()
    expect(screen.getByText(/已登錄 Dex #001/)).toBeTruthy()
    expect(useRoster.getState().roster).toHaveLength(1)
    expect(useMeta.getState().meta.registered).toContain(1)
    expect(useIncubator.getState().state.eggs).toHaveLength(0)
    expect(JSON.parse(localStorage.getItem('mobie.incubator.v1') ?? 'null')).toMatchObject({
      eggs: [],
      hatchOutbox: [{ status: 'settled', eggId: 'egg-1' }],
    })
  })
})
