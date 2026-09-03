// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { MashMeter, MoveSlots, SwitchAction } from '@/ui/screens/BattleScreen'
import type { Move } from '@/game/types'
import { renderGameJourney } from '@/test/renderGameJourney'
import { useBattleStore } from '@/store/battleStore'
import { PRODUCT_RUNTIME } from '@/game/ext/productRuntime'

vi.mock('@/audio/audioEngine', () => ({
  audio: {
    play: vi.fn(),
    unlock: vi.fn().mockResolvedValue(undefined),
    setIntensity: vi.fn(),
    pauseBgm: vi.fn(),
    resumeBgm: vi.fn(),
    cancelBattleSfx: vi.fn(),
    pauseBattleSfx: vi.fn(),
    resumeBattleSfx: vi.fn(),
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
    vi.unstubAllGlobals()
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

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '跳過開場' }))
      await vi.advanceTimersByTimeAsync(0)
    })
    expect(useBattleStore.getState().phase).toBe('playerChoice')
    expect(screen.getByRole('button', { name: /火花.*效果絕佳 ×2/ })).toBeTruthy()
    expect(document.querySelector('[data-battle-shell]')).toBeTruthy()
    expect(screen.getByText(/回合 1/)).toBeTruthy()
    expect(screen.getByRole('meter', { name: /妙蛙種子 HP/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: /妙蛙種子，出戰中，HP/ })).toBeTruthy()

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
    const qte = screen.getByRole('button', { name: /10秒內點擊任意處/ })
    expect(qte.closest('.battle-command-body')).toBeTruthy()
    expect(document.querySelector('[data-battle-stage]')?.contains(qte)).toBe(false)
    expect(document.activeElement).toBe(qte)
  })

  it('returns normal attack focus through QTE, busy feed, and the next legal move', async () => {
    vi.useFakeTimers()
    renderGameJourney({
      state: 'battle',
      context: {
        regionId: 'practice',
        playerTeam: [
          { cardId: 'focus-player-1', speciesId: 4, level: 16 },
          { cardId: 'focus-player-2', speciesId: 25, level: 16 },
          { cardId: 'focus-player-3', speciesId: 133, level: 16 },
        ],
        foeTeam: [
          { cardId: 'focus-foe-1', speciesId: 1, level: 10 },
          { cardId: 'focus-foe-2', speciesId: 7, level: 10 },
          { cardId: 'focus-foe-3', speciesId: 10, level: 10 },
        ],
      },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '跳過開場' }))
      await vi.advanceTimersByTimeAsync(0)
    })
    const selectedMove = screen.getByRole('button', { name: /火花/ })
    fireEvent.click(selectedMove)
    const qte = screen.getByRole('button', { name: /10秒內點擊任意處/ })
    fireEvent.pointerDown(qte)

    const mash = screen.getByRole('button', { name: /連打蓄力/ })
    expect(document.activeElement).toBe(mash)
    await act(async () => { await vi.advanceTimersByTimeAsync(2_801) })

    expect(useBattleStore.getState().phase).toBe('busy')
    expect(document.activeElement).toBe(document.querySelector('[data-battle-feed-focus]'))
    for (let second = 0; second < 20 && useBattleStore.getState().phase !== 'playerChoice'; second += 1) {
      await act(async () => { await vi.advanceTimersByTimeAsync(1_000) })
    }

    expect(useBattleStore.getState().phase).toBe('playerChoice')
    expect(useBattleStore.getState().battle?.turn).toBe(2)
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /火花/ }))
  })

  it('pauses the live QTE clock while document.hidden and resumes its preserved remainder', async () => {
    vi.useFakeTimers()
    let hidden = false
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden })
    try {
      renderGameJourney({
        state: 'battle',
        context: {
          regionId: 'practice',
          playerTeam: [
            { cardId: 'hidden-player-1', speciesId: 4, level: 16 },
            { cardId: 'hidden-player-2', speciesId: 25, level: 16 },
            { cardId: 'hidden-player-3', speciesId: 133, level: 16 },
          ],
          foeTeam: [
            { cardId: 'hidden-foe-1', speciesId: 1, level: 10 },
            { cardId: 'hidden-foe-2', speciesId: 7, level: 10 },
            { cardId: 'hidden-foe-3', speciesId: 10, level: 10 },
          ],
        },
      })
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: '跳過開場' }))
        await vi.advanceTimersByTimeAsync(0)
      })
      fireEvent.click(screen.getByRole('button', { name: /火花/ }))
      expect(useBattleStore.getState().phase).toBe('qte')

      hidden = true
      await act(async () => document.dispatchEvent(new Event('visibilitychange')))
      await act(() => vi.advanceTimersByTimeAsync(11_000))
      expect(useBattleStore.getState().phase).toBe('qte')

      hidden = false
      await act(async () => document.dispatchEvent(new Event('visibilitychange')))
      await act(() => vi.advanceTimersByTimeAsync(9_900))
      expect(useBattleStore.getState().phase).toBe('qte')
      await act(() => vi.advanceTimersByTimeAsync(200))
      expect(useBattleStore.getState().phase).toBe('mash')
    } finally {
      Reflect.deleteProperty(document, 'hidden')
    }
  })

  it('projects the complete choice HUD and blocks MobCard when an input surface owns the command body', async () => {
    vi.useFakeTimers()
    renderGameJourney({
      state: 'battle',
      context: {
        regionId: 'practice',
        playerTeam: [
          { cardId: 'matrix-player-1', speciesId: 4, level: 16 },
          { cardId: 'matrix-player-2', speciesId: 7, level: 16 },
          { cardId: 'matrix-player-3', speciesId: 1, level: 16 },
        ],
        foeTeam: [
          { cardId: 'matrix-foe-1', speciesId: 1, level: 12 },
          { cardId: 'matrix-foe-2', speciesId: 7, level: 12 },
          { cardId: 'matrix-foe-3', speciesId: 10, level: 12 },
        ],
      },
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '跳過開場' }))
      await vi.advanceTimersByTimeAsync(0)
    })
    act(() => useBattleStore.setState((state) => state.battle ? {
      energy: 100,
      battle: {
        ...state.battle,
        chainGauge: PRODUCT_RUNTIME.turnExtensions.chain.gaugeFull,
        field: {
          ...state.battle.field,
          teamStatuses: [
            { stat: 'atk', mult: 1.2, remaining: 3, source: -1, label: '訓練師加油' },
            { stat: 'def', mult: 1.2, remaining: 3, source: 1010, label: '防禦提升' },
            { stat: 'spa', mult: 1.2, remaining: 2, source: -1, label: '精神集中' },
            { stat: 'spd', mult: 1.2, remaining: 1, source: -1, label: '靈光守護' },
          ],
          enemyStatuses: [{ stat: 'def', mult: 0.8, remaining: 2, source: -1, label: '防禦下降' }],
          comboCastEffects: [
            { key: 'one', label: '第一標記', icon: '①', remaining: 4 },
            { key: 'two', label: '第二標記', icon: '②', remaining: 3 },
            { key: 'three', label: '第三標記', icon: '③', remaining: 2 },
          ],
        },
      },
    } : {}))

    expect(screen.getByRole('button', { name: '星擊發動' })).toBeTruthy()
    expect(screen.getByRole('button', { name: '連鎖發動' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /看穿/ })).toBeTruthy()
    expect(screen.getByLabelText('我方全隊狀態')).toBeTruthy()
    expect(screen.getByLabelText('對手全隊狀態')).toBeTruthy()
    expect(screen.getByRole('button', { name: '展開全部 3 個場域標記' })).toBeTruthy()

    const playerPlate = document.querySelector<HTMLButtonElement>('.hp-plate--owner')!
    fireEvent.click(playerPlate)
    expect(screen.getByRole('dialog', { name: /小火龍.*完整資訊/ })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: '關閉' }))

    fireEvent.click(screen.getByRole('button', { name: /火花/ }))
    const qte = screen.getByRole('button', { name: /10秒內點擊任意處/ })
    const disabledPlate = document.querySelector<HTMLButtonElement>('.hp-plate--owner')!
    expect(disabledPlate.getAttribute('aria-label')).toContain('無法開啟資訊卡：戰鬥輸入進行中')
    expect(disabledPlate.getAttribute('aria-disabled')).toBe('true')
    fireEvent.click(disabledPlate)
    expect(screen.queryByRole('dialog')).toBeNull()
    expect(qte.closest('.battle-command-body')).toBeTruthy()
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

  it('lets hover and focus update only DOM state, then accepts a tap/key race once', () => {
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

    const move = screen.getByRole('button', { name: /撞擊/ })
    fireEvent.pointerEnter(move)
    fireEvent.focus(move)
    expect(onPick).not.toHaveBeenCalled()
    expect(screen.getByTestId('move-consequence-summary').textContent).toContain('撞擊')

    fireEvent.click(move)
    fireEvent.keyDown(window, { key: '1' })
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
    render(<SwitchAction
      availability={{
        consequence: '放棄本回合攻擊並承受對手攻擊',
        legalIndices: [1],
        disabledReason: null,
      }}
      onOpen={vi.fn()}
    />)

    expect(screen.getByRole('button', { name: '換人' })).toBeTruthy()
    expect(screen.getByText('放棄本回合攻擊並承受對手攻擊')).toBeTruthy()
  })

  it('counts one mash tap per physical key press', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const onDone = vi.fn()
    render(<MashMeter onDone={onDone} />)
    const input = screen.getByRole('button')

    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter', repeat: true })
    fireEvent.keyUp(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: ' ' })
    fireEvent.keyUp(input, { key: ' ' })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyUp(input, { key: 'Enter' })
    await act(() => vi.advanceTimersByTimeAsync(2_800))

    expect(onDone).toHaveBeenCalledWith(3)
  })

  it('preserves the mash timeout while hidden', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const onDone = vi.fn()
    const view = render(<MashMeter paused onDone={onDone} />)

    await act(() => vi.advanceTimersByTimeAsync(5_000))
    expect(onDone).not.toHaveBeenCalled()
    view.rerender(<MashMeter paused={false} onDone={onDone} />)
    await act(() => vi.advanceTimersByTimeAsync(2_799))
    expect(onDone).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(onDone).toHaveBeenCalledWith(0)
  })

  it('traps MobCard and switch focus, then restores each exact invoker', async () => {
    vi.useFakeTimers()
    renderGameJourney({
      state: 'battle',
      context: {
        regionId: 'practice',
        playerTeam: [
          { cardId: 'dialog-player-1', speciesId: 4, level: 16 },
          { cardId: 'dialog-player-2', speciesId: 25, level: 16 },
          { cardId: 'dialog-player-3', speciesId: 133, level: 16 },
        ],
        foeTeam: [
          { cardId: 'dialog-foe-1', speciesId: 1, level: 10 },
          { cardId: 'dialog-foe-2', speciesId: 7, level: 10 },
          { cardId: 'dialog-foe-3', speciesId: 10, level: 10 },
        ],
      },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '跳過開場' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    const playerPips = document.querySelectorAll<HTMLButtonElement>('.battle-combatant-hud--player .tray__pip')
    const cardInvoker = playerPips[1]
    fireEvent.click(cardInvoker)
    const card = screen.getByRole('dialog', { name: /完整資訊/ })
    const close = within(card).getByRole('button', { name: '關閉' })
    expect(document.activeElement).toBe(close)
    expect(document.querySelector<HTMLElement>('[data-battle-stage]')?.inert).toBe(true)
    expect(document.querySelector<HTMLElement>('.battle-command-deck')?.inert).toBe(true)
    fireEvent.keyDown(window, { key: '1' })
    expect(useBattleStore.getState().phase).toBe('playerChoice')
    expect(screen.getByRole('dialog', { name: /完整資訊/ })).toBe(card)
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(close)
    fireEvent.keyDown(document, { key: 'Escape' })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(document.activeElement).toBe(cardInvoker)

    const switchInvoker = screen.getByRole('button', { name: '換人' })
    fireEvent.click(switchInvoker)
    const sheet = screen.getByRole('dialog', { name: '選擇換上的夥伴' })
    const sheetButtons = within(sheet).getAllByRole('button')
    const firstLegal = sheetButtons[0]
    const cancel = within(sheet).getByRole('button', { name: '取消' })
    expect(document.activeElement).toBe(firstLegal)
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true })
    expect(document.activeElement).toBe(cancel)
    fireEvent.keyDown(document, { key: 'Tab' })
    expect(document.activeElement).toBe(firstLegal)
    fireEvent.keyDown(document, { key: 'Escape' })
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(screen.queryByRole('dialog', { name: '選擇換上的夥伴' })).toBeNull()
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '換人' }))
  })

  it('restores the MobCard invoker after a phase-forced close returns to choice', async () => {
    vi.useFakeTimers()
    renderGameJourney({
      state: 'battle',
      context: {
        regionId: 'practice',
        playerTeam: [
          { cardId: 'forced-card-player-1', speciesId: 4, level: 16 },
          { cardId: 'forced-card-player-2', speciesId: 25, level: 16 },
          { cardId: 'forced-card-player-3', speciesId: 133, level: 16 },
        ],
        foeTeam: [
          { cardId: 'forced-card-foe-1', speciesId: 1, level: 10 },
          { cardId: 'forced-card-foe-2', speciesId: 7, level: 10 },
          { cardId: 'forced-card-foe-3', speciesId: 10, level: 10 },
        ],
      },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: '跳過開場' }))
      await vi.advanceTimersByTimeAsync(0)
    })

    const invoker = document.querySelectorAll<HTMLButtonElement>('.battle-combatant-hud--player .tray__pip')[1]
    fireEvent.click(invoker)
    expect(screen.getByRole('dialog', { name: /完整資訊/ })).toBeTruthy()

    act(() => useBattleStore.getState().setPhase('busy'))
    expect(document.activeElement).toBe(document.querySelector('[data-battle-feed-focus]'))
    act(() => useBattleStore.getState().setPhase('playerChoice'))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })

    expect(document.activeElement).toBe(invoker)
  })
})
