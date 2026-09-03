// @vitest-environment jsdom

import { act, fireEvent, render } from '@testing-library/react'
import { rhythmTaps } from '@/input/gestures'
import { HoldChargeRing, RhythmTap } from './StarStrikeGestures'

vi.mock('@/input/gestures', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/input/gestures')>()
  return {
    ...actual,
    beatSchedule: () => [100, 200, 300],
    rhythmTaps: vi.fn((taps: number[]) => taps.length / 10),
  }
})

describe('RhythmTap keyboard input', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('records one tap per Enter/Space keydown-up pair and ignores repeat', () => {
    let frame: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    let now = 100
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const onDone = vi.fn()
    const view = render(<RhythmTap mode="arcade" onDone={onDone} />)
    const input = view.getByRole('button')

    fireEvent.keyDown(input, { key: 'Enter', repeat: true })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyUp(input, { key: 'Enter' })
    now = 200
    fireEvent.keyDown(input, { key: ' ' })
    fireEvent.keyUp(input, { key: ' ' })

    now = 1_000
    act(() => { frame?.(now) })

    expect(vi.mocked(rhythmTaps).mock.calls[0]?.[0]).toHaveLength(2)
    expect(onDone).toHaveBeenCalledWith(0.2)
  })
})

describe('HoldChargeRing keyboard input', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('holds with Enter, ignores repeat, and completes once', () => {
    let frame: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    let now = 100
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const onCharged = vi.fn()
    const view = render(<HoldChargeRing mode="lite" onCharged={onCharged} />)
    const input = view.getByRole('button')

    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'Enter', repeat: true })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.keyDown(input, { key: 'Enter' })
    act(() => { frame?.(now) })
    now = 950
    act(() => { frame?.(now) })
    fireEvent.pointerDown(input)

    expect(onCharged).toHaveBeenCalledOnce()
    expect(onCharged).toHaveBeenCalledWith(1)
  })

  it('preserves its timeout and stops animation frames while hidden', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const onCharged = vi.fn()
    const view = render(<HoldChargeRing paused mode="lite" timeoutMs={100} onCharged={onCharged} />)

    expect(requestAnimationFrame).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(onCharged).not.toHaveBeenCalled()

    view.rerender(<HoldChargeRing paused={false} mode="lite" timeoutMs={100} onCharged={onCharged} />)
    expect(requestAnimationFrame).toHaveBeenCalledOnce()
    await act(() => vi.advanceTimersByTimeAsync(99))
    expect(onCharged).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(onCharged).toHaveBeenCalledOnce()
  })

  it('releases a held key while hidden and requires a fresh press after resume', () => {
    let frame: FrameRequestCallback | null = null
    vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
      frame = callback
      return 1
    }))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    let now = 100
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    const onCharged = vi.fn()
    const view = render(<HoldChargeRing mode="lite" onCharged={onCharged} />)
    const input = view.getByRole('button')

    act(() => { frame?.(now) })
    fireEvent.keyDown(input, { key: 'Enter' })
    now = 600
    act(() => { frame?.(now) })
    now = 900
    act(() => { frame?.(now) })

    view.rerender(<HoldChargeRing paused mode="lite" onCharged={onCharged} />)
    now = 10_900
    view.rerender(<HoldChargeRing paused={false} mode="lite" onCharged={onCharged} />)
    act(() => { frame?.(now) })
    now = 12_900
    act(() => { frame?.(now) })
    expect(onCharged).not.toHaveBeenCalled()

    fireEvent.keyDown(input, { key: 'Enter' })
    act(() => { frame?.(now) })
    now = 13_800
    act(() => { frame?.(now) })
    expect(onCharged).toHaveBeenCalledOnce()
    expect(onCharged).toHaveBeenCalledWith(1)
  })
})

describe('RhythmTap visibility clock', () => {
  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  it('does not schedule gameplay animation frames while hidden', () => {
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
    const view = render(<RhythmTap paused mode="arcade" onDone={vi.fn()} />)

    expect(requestAnimationFrame).not.toHaveBeenCalled()
    view.rerender(<RhythmTap paused={false} mode="arcade" onDone={vi.fn()} />)
    expect(requestAnimationFrame).toHaveBeenCalledOnce()
  })
})
