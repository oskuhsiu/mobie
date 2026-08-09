// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react'
import { renderGameJourney } from '@/test/renderGameJourney'
import { PLAYER_CARDS } from '@/game/data/playerCards'
import { createOwnedUnit } from '@/game/growth'
import { useRoster } from '@/store/rosterStore'

vi.mock('@/audio/audioEngine', () => ({
  audio: { play: vi.fn(), unlock: vi.fn().mockResolvedValue(undefined) },
}))
vi.mock('@/input/haptics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/input/haptics')>()
  return { ...actual, haptic: vi.fn() }
})
vi.mock('@/scene/r3f/CaptureStage', () => ({
  default: () => <div aria-label="capture-stage" />,
}))

const playerTeam = PLAYER_CARDS.slice(0, 3)
const foeTeam = [
  { cardId: 'TEST-FOE-1', speciesId: 11, level: 12 },
  { cardId: 'TEST-FOE-2', speciesId: 13, level: 12 },
  { cardId: 'TEST-CAPTURE-TARGET', speciesId: 10, level: 13 },
]

describe('capture to companion journey', () => {
  beforeEach(() => {
    localStorage.clear()
    useRoster.setState({
      roster: PLAYER_CARDS.map((card) => createOwnedUnit(card.cardId, card.speciesId, card.level, card)),
      loaded: true,
      lastResults: [],
      lastEvolutions: [],
      lastMoveLearns: [],
      lastCaptured: null,
    })
    vi.spyOn(Math, 'random').mockReturnValue(0)
  })

  afterEach(() => {
    cleanup()
    vi.restoreAllMocks()
  })

  it('lets the player inspect a newly captured Mobie and open the collection', async () => {
    renderGameJourney({
      state: 'result',
      context: {
        regionId: 'verdant-forest',
        foeTeam,
        playerTeam,
        outcome: 'win',
      },
    })

    await screen.findByText('收服成功！', {}, { timeout: 4_000 })

    const inspect = await screen.findByRole(
      'button',
      { name: '查看新夥伴' },
      { timeout: 4_000 },
    )
    expect(screen.getByRole('button', { name: '我的 Mobie' })).toBeTruthy()

    fireEvent.click(inspect)

    await waitFor(() => {
      expect(screen.getByText('能力值')).toBeTruthy()
      expect(screen.getByText('個體')).toBeTruthy()
    })
  }, 8_000)

  it('keeps duplicate captures on the egg path without a false new-companion action', async () => {
    renderGameJourney({
      state: 'result',
      context: {
        regionId: 'verdant-forest',
        foeTeam: [
          foeTeam[0],
          foeTeam[1],
          { cardId: 'TEST-DUPLICATE-TARGET', speciesId: 1, level: 13 },
        ],
        playerTeam,
        outcome: 'win',
      },
    })

    await screen.findByText('收服成功！', {}, { timeout: 4_000 })
    await screen.findByText(/自動轉化為孵化蛋/, {}, { timeout: 4_000 })

    expect(screen.queryByRole('button', { name: '查看新夥伴' })).toBeNull()
  }, 8_000)
})
