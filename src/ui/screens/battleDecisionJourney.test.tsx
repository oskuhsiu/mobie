// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { MoveSlots, SwitchAction } from '@/ui/screens/BattleScreen'
import type { Move } from '@/game/types'

vi.mock('@/audio/audioEngine', () => ({
  audio: { play: vi.fn(), unlock: vi.fn().mockResolvedValue(undefined) },
}))

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
