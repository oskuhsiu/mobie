// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MoveSlots, SwitchAction } from '@/ui/screens/BattleScreen'
import type { Move } from '@/game/types'
import { renderGameJourney } from '@/test/renderGameJourney'
import { useBattleStore } from '@/store/battleStore'

vi.mock('@/audio/audioEngine', () => ({
  audio: {
    play: vi.fn(),
    unlock: vi.fn().mockResolvedValue(undefined),
    setIntensity: vi.fn(),
    playMoveSound: vi.fn(),
    starChargeSweep: vi.fn(),
    starStampTick: vi.fn(),
    starImpactBoom: vi.fn(),
  },
}))
vi.mock('@/input/haptics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/input/haptics')>()
  return { ...actual, haptic: vi.fn() }
})
vi.mock('@/scene/r3f/BattleStage', async () => {
  const { forwardRef } = await import('react')
  return { default: forwardRef(() => <div aria-label="battle-stage" />) }
})
vi.mock('@/scene/fx/FxCanvas', async () => {
  const { forwardRef } = await import('react')
  return { FxCanvas: forwardRef(() => <div aria-label="battle-effects" />) }
})
vi.mock('@/scene/fx/WeatherCanvas', () => ({ WeatherCanvas: () => null }))
vi.mock('@/ui/components/DamageNumbers', async () => {
  const { forwardRef } = await import('react')
  return { DamageNumbers: forwardRef(() => null) }
})

const moves: Move[] = [{
  id: 1,
  name: 'tackle',
  nameZh: '撞擊',
  type: 'normal',
  power: 40,
  accuracy: 100,
  category: 'physical',
}]

describe('battle decision journey', () => {
  afterEach(() => {
    cleanup()
    vi.useRealTimers()
  })

  it('keeps the real battle in player choice, updates for the active foe, then enters QTE only after a pick', async () => {
    vi.useFakeTimers()
    renderGameJourney({
      state: 'battle',
      context: {
        regionId: 'practice',
        playerTeam: [
          { cardId: 'journey-fire', speciesId: 4, level: 16 },
          { cardId: 'journey-player-2', speciesId: 25, level: 16 },
          { cardId: 'journey-player-3', speciesId: 133, level: 16 },
        ],
        foeTeam: [
          { cardId: 'journey-grass', speciesId: 1, level: 11 },
          { cardId: 'journey-water', speciesId: 7, level: 11 },
          { cardId: 'journey-foe-3', speciesId: 10, level: 11 },
        ],
      },
    })

    await act(async () => { await vi.advanceTimersByTimeAsync(1_100) })
    expect(useBattleStore.getState().phase).toBe('playerChoice')
    expect(screen.getByRole('button', { name: /火花.*效果絕佳 ×2/ })).toBeTruthy()

    await act(async () => { await vi.advanceTimersByTimeAsync(8_001) })
    expect(useBattleStore.getState().phase).toBe('playerChoice')
    expect(screen.queryByText(/10秒內點擊任意處/)).toBeNull()

    act(() => useBattleStore.setState((state) => state.battle ? {
      battle: { ...state.battle, foe: { ...state.battle.foe, activeIndex: 1 } },
    } : {}))
    expect(screen.getByRole('button', { name: /火花.*效果不佳 ×0\.5/ })).toBeTruthy()
    act(() => useBattleStore.setState((state) => state.battle ? {
      battle: { ...state.battle, foe: { ...state.battle.foe, activeIndex: 0 } },
    } : {}))

    fireEvent.click(screen.getByRole('button', { name: /火花.*效果絕佳 ×2/ }))
    expect(useBattleStore.getState().phase).toBe('qte')
    expect(screen.getByText(/10秒內點擊任意處/)).toBeTruthy()
  })

  it('waits beyond the former eight-second boundary for an explicit move choice', () => {
    vi.useFakeTimers()
    const onPick = vi.fn()

    render(
      <MoveSlots
        moves={moves}
        defenderTypes={['normal']}
        playerSpeed={100}
        foeSpeed={100}
        onPick={onPick}
      />,
    )
    vi.advanceTimersByTime(8_001)

    expect(onPick).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: /撞擊/ }))
    fireEvent.click(screen.getByRole('button', { name: /撞擊/ }))
    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(0)
  })

  it.each(['1', 'ArrowUp'])('accepts %s once without duplicating the choice', (key) => {
    const onPick = vi.fn()
    render(
      <MoveSlots
        moves={moves}
        defenderTypes={['normal']}
        playerSpeed={100}
        foeSpeed={100}
        onPick={onPick}
      />,
    )

    fireEvent.keyDown(window, { key })
    fireEvent.keyDown(window, { key })

    expect(onPick).toHaveBeenCalledTimes(1)
    expect(onPick).toHaveBeenCalledWith(0)
  })

  it('exposes active-foe effectiveness and initiative in visible text and move names', () => {
    const fireMove: Move = {
      ...moves[0],
      id: 2,
      name: 'ember',
      nameZh: '火花',
      type: 'fire',
      category: 'special',
    }

    const view = render(
      <MoveSlots
        moves={[fireMove]}
        defenderTypes={['grass']}
        playerSpeed={101}
        foeSpeed={100}
        onPick={vi.fn()}
      />,
    )

    expect(screen.getByText('你先攻')).toBeTruthy()
    expect(screen.getByText('效果絕佳 ×2')).toBeTruthy()
    expect(screen.getByRole('button', { name: /火花.*效果絕佳 ×2/ })).toBeTruthy()

    view.rerender(
      <MoveSlots
        moves={[fireMove]}
        defenderTypes={['water']}
        playerSpeed={101}
        foeSpeed={100}
        onPick={vi.fn()}
      />,
    )
    expect(screen.getByText('效果不佳 ×0.5')).toBeTruthy()
    expect(screen.getByRole('button', { name: /火花.*效果不佳 ×0.5/ })).toBeTruthy()
  })

  it('keeps the switch cost visible before the player chooses it', () => {
    render(<SwitchAction switchable onPick={vi.fn()} />)

    expect(screen.getByRole('button', { name: '換人' })).toBeTruthy()
    expect(screen.getByText('放棄本回合攻擊並承受對手攻擊')).toBeTruthy()
  })
})
