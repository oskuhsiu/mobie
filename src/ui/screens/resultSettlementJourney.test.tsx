// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, screen, waitFor } from '@testing-library/react'
import { renderGameJourney } from '@/test/renderGameJourney'
import { PLAYER_CARDS } from '@/game/data/playerCards'
import { createOwnedUnit } from '@/game/growth'
import { useRoster } from '@/store/rosterStore'
import { useRun } from '@/store/runStore'
import { useIncubator } from '@/store/incubatorStore'
import { addEgg, defaultIncubator, saveIncubatorState } from '@/game/incubator'

const playerTeam = PLAYER_CARDS.slice(0, 3)
const foeTeam = [
  { cardId: 'RESULT-FOE-1', speciesId: 10, level: 10 },
  { cardId: 'RESULT-FOE-2', speciesId: 11, level: 10 },
  { cardId: 'RESULT-FOE-3', speciesId: 12, level: 10 },
]
const resultContext = {
  regionId: 'practice',
  foeTeam,
  playerTeam,
  outcome: 'win' as const,
  battleResult: {
    resultId: 'result-journey-battle',
    resultFingerprint: 'result-journey-fingerprint',
    outcome: 'win' as const,
  },
}

describe('Result roster settlement journey', () => {
  beforeEach(() => {
    localStorage.clear()
    useRoster.setState({
      roster: playerTeam.map((card) => createOwnedUnit(card.cardId, card.speciesId, 15, card)),
      loaded: true,
      lastResults: [],
      lastEvolutions: [],
      lastMoveLearns: [],
      lastCaptured: null,
    })
  })

  afterEach(() => cleanup())

  it('keeps the same EXP result after a Result remount', async () => {
    renderGameJourney({ state: 'result', context: resultContext })
    await screen.findByRole('button', { name: /再戰一場/ }, { timeout: 4_000 })

    const afterFirstMount = useRoster.getState().roster.slice(0, 3).map((unit) => ({ id: unit.id, level: unit.level, exp: unit.exp }))
    const spAfterFirstMount = localStorage.getItem('mobie.skillpoints.v1')
    const metaAfterFirstMount = JSON.parse(localStorage.getItem('mobie.meta.v1') ?? '{}') as { stats?: { arenaWins?: number } }
    cleanup()

    renderGameJourney({ state: 'result', context: resultContext })
    await screen.findByRole('button', { name: /再戰一場/ }, { timeout: 4_000 })
    await waitFor(() => {
      expect(useRoster.getState().roster.slice(0, 3).map((unit) => ({ id: unit.id, level: unit.level, exp: unit.exp }))).toEqual(afterFirstMount)
    })

    const markers = JSON.parse(localStorage.getItem('mobie.roster.growth.v1') ?? '[]') as unknown[]
    expect(markers).toHaveLength(1)
    expect(localStorage.getItem('mobie.skillpoints.v1')).toBe(spAfterFirstMount)
    expect(JSON.parse(localStorage.getItem('mobie.meta.v1') ?? '{}')).toMatchObject(metaAfterFirstMount)
    expect(JSON.parse(localStorage.getItem('mobie.skillpoints.v1') ?? '{}')).toMatchObject({
      sp: 1,
      resultSettlements: [{ resultId: resultContext.battleResult.resultId, canonicalApplied: true }],
    })
    expect(JSON.parse(localStorage.getItem('mobie.meta.v1') ?? '{}')).toMatchObject({
      resultSettlements: [{ resultId: resultContext.battleResult.resultId, canonicalApplied: true }],
    })
    // Mirror keys remain inspectable for Chrome storage evidence.
    expect(JSON.parse(localStorage.getItem('mobie.skillpoints.settlement.v1') ?? '[]')).toHaveLength(1)
    expect(JSON.parse(localStorage.getItem('mobie.meta.settlement.v1') ?? '[]')).toHaveLength(1)
  }, 8_000)

  it('settles Tower progression and existing incubator eggs once across a remount', async () => {
    const incubatorState = addEgg(defaultIncubator(), {
      source: 'achievement',
      speciesPool: [1],
      label: 'journey egg',
    })
    useRun.setState({ bestFloor: 0, ascensionUnlocked: 0 })
    useIncubator.setState({ state: incubatorState, loaded: true })
    saveIncubatorState(incubatorState)
    const towerContext = {
      ...resultContext,
      tower: {
        floor: 5,
        ascension: 0,
        seed: 'journey-tower',
        teamCards: playerTeam,
      },
    }

    renderGameJourney({ state: 'result', context: towerContext })
    await screen.findByRole('button', { name: /結束遠征/ }, { timeout: 4_000 })
    const runAfterFirst = JSON.parse(localStorage.getItem('mobie.run.v1') ?? '{}') as {
      bestFloor?: number
      ascensionUnlocked?: number
      resultSettlements?: Array<{ resultId: string; canonicalApplied?: boolean }>
    }
    const incubatorAfterFirst = JSON.parse(localStorage.getItem('mobie.incubator.v1') ?? '{}') as {
      eggs?: Array<{ progress: number }>
      resultSettlements?: Array<{ resultId: string; canonicalApplied?: boolean }>
    }
    expect(runAfterFirst).toMatchObject({ bestFloor: 5, ascensionUnlocked: 1 })
    expect(runAfterFirst.resultSettlements).toEqual([
      expect.objectContaining({ resultId: resultContext.battleResult.resultId, canonicalApplied: true }),
    ])
    expect(incubatorAfterFirst.eggs?.[0]?.progress).toBe(2)
    expect(incubatorAfterFirst.resultSettlements).toEqual([
      expect.objectContaining({ resultId: resultContext.battleResult.resultId, canonicalApplied: true }),
    ])
    const runSnapshot = localStorage.getItem('mobie.run.v1')
    const incubatorSnapshot = localStorage.getItem('mobie.incubator.v1')
    cleanup()

    renderGameJourney({ state: 'result', context: towerContext })
    await screen.findByRole('button', { name: /結束遠征/ }, { timeout: 4_000 })
    expect(localStorage.getItem('mobie.run.v1')).toBe(runSnapshot)
    expect(localStorage.getItem('mobie.incubator.v1')).toBe(incubatorSnapshot)
  }, 8_000)
})
