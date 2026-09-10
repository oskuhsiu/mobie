// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
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

  it('projects the saved Tower receipt before enabling the next-floor CTA', async () => {
    const towerContext = {
      ...resultContext,
      tower: {
        floor: 5,
        ascension: 0,
        seed: 'journey-tower-projection',
        teamCards: playerTeam,
      },
    }

    renderGameJourney({ state: 'result', context: towerContext })

    const continueButton = await screen.findByRole('button', { name: /攻向第 6 層/ }, { timeout: 4_000 })
    expect(screen.getByRole('heading', { name: '第 5 層突破' })).toBeTruthy()
    expect(screen.getByText(/連勝塔進度/)).toBeTruthy()
    expect(screen.getByText(/A1 · 熟練/)).toBeTruthy()
    expect(continueButton).toHaveProperty('disabled', false)

    expect(document.querySelector('[data-result-next-actions]')).toBeTruthy()
  }, 8_000)

  it('blocks a stale floor from reusing an earlier Tower receipt', async () => {
    const firstContext = {
      ...resultContext,
      battleResult: {
        resultId: 'result-journey-stale',
        resultFingerprint: 'result-journey-stale-fingerprint',
        outcome: 'win' as const,
      },
      tower: {
        floor: 5,
        ascension: 0,
        seed: 'journey-tower-stale',
        teamCards: playerTeam,
      },
    }
    renderGameJourney({ state: 'result', context: firstContext })
    await screen.findByRole('button', { name: /攻向第 6 層/ }, { timeout: 4_000 })
    cleanup()

    renderGameJourney({
      state: 'result',
      context: {
        ...firstContext,
        tower: { ...firstContext.tower, floor: 6 },
      },
    })

    expect(await screen.findByText('儲存的 Tower 進度與本場不一致', {}, { timeout: 4_000 })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /攻向第 7 層/ })).toBeNull()
    expect(document.querySelector('[data-result-tower-receipt="stale"]')).toBeTruthy()
  }, 8_000)

  it('blocks malformed Tower context without starting a settlement write', async () => {
    renderGameJourney({
      state: 'result',
      context: {
        ...resultContext,
        tower: {
          floor: 0,
          ascension: 0,
          seed: 'bad-tower',
          teamCards: playerTeam,
        } as never,
      },
    })

    expect(await screen.findByText('Tower 結果需要恢復')).toBeTruthy()
    expect(screen.getByRole('button', { name: '返回 Region Hub' })).toHaveProperty('disabled', false)
    expect(localStorage.getItem('mobie.run.v1')).toBeNull()
  })

  it('labels a Tower timeout separately while preserving the settled lose flow', async () => {
    const towerContext = {
      ...resultContext,
      outcome: 'lose' as const,
      battleResult: {
        resultId: 'result-journey-timeout',
        resultFingerprint: 'result-journey-timeout-fingerprint',
        outcome: 'lose' as const,
        reason: 'timeout' as const,
      },
      tower: {
        floor: 3,
        ascension: 1,
        seed: 'journey-tower-timeout',
        teamCards: playerTeam,
      },
    }

    renderGameJourney({ state: 'result', context: towerContext })
    await screen.findByRole('button', { name: /結束遠征/ }, { timeout: 4_000 })

    const result = document.querySelector<HTMLElement>('[data-result]')
    expect(result?.dataset.resultReason).toBe('timeout')
    expect(result?.dataset.resultTowerResultState).toBe('timeout')
    expect(screen.getByRole('heading', { name: /第 3 層時間到/ })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /攻向第 4 層/ })).toBeNull()
  }, 8_000)

  it('explains a timeout victory while keeping the next-floor action legal', async () => {
    renderGameJourney({
      state: 'result',
      context: {
        ...resultContext,
        battleResult: {
          resultId: 'result-journey-timeout-win',
          resultFingerprint: 'result-journey-timeout-win-fingerprint',
          outcome: 'win' as const,
          reason: 'timeout' as const,
        },
        tower: {
          floor: 4,
          ascension: 0,
          seed: 'journey-tower-timeout-win',
          teamCards: playerTeam,
        },
      },
    })

    const continueButton = await screen.findByRole('button', { name: /攻向第 5 層/ }, { timeout: 4_000 })
    expect(screen.getByRole('heading', { name: /第 4 層時間到，依 HP 判定突破/ })).toBeTruthy()
    expect(screen.getByText(/回合上限已到，勝負依剩餘 HP 判定/)).toBeTruthy()
    expect(continueButton).toHaveProperty('disabled', false)
  }, 8_000)

  it('offers a safe region exit when a non-Tower Result has no battle outcome', async () => {
    renderGameJourney({
      state: 'result',
      context: {
        regionId: 'practice',
        foeTeam: playerTeam,
        playerTeam,
        outcome: null,
        battleResult: null,
      },
    })

    const back = await screen.findByRole('button', { name: /回到區域/ }, { timeout: 4_000 })
    expect(document.querySelector('[data-result-settlement-status="idle"]')).toBeTruthy()
    fireEvent.click(back)
    await waitFor(() => expect(document.querySelector('[data-region-hub]')).toBeTruthy())
  }, 8_000)

  it('blocks a Tower handoff whose fixed team differs by loadout metadata', async () => {
    const staleTowerTeam = [{ ...playerTeam[0], heldItemId: 'lifeorb' }, ...playerTeam.slice(1)]
    renderGameJourney({
      state: 'result',
      context: {
        ...resultContext,
        tower: {
          floor: 2,
          ascension: 0,
          seed: 'stale-loadout-tower',
          teamCards: staleTowerTeam,
        },
      },
    })

    expect(await screen.findByText('Tower 結果需要恢復')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /攻向第 3 層/ })).toBeNull()
  }, 8_000)
})
