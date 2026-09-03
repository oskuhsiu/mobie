// @vitest-environment jsdom

import { act, fireEvent, render } from '@testing-library/react'
import { ShieldSwipe } from './BattleGestures'

describe('ShieldSwipe keyboard input', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('submits normal once for Enter and fences pointer/timeout competition', () => {
    vi.useFakeTimers()
    const onResult = vi.fn()
    const view = render(<ShieldSwipe mode="arcade" onResult={onResult} timeoutMs={100} />)
    const input = view.getByRole('button')

    expect(document.activeElement).toBe(input)
    fireEvent.keyDown(input, { key: 'Enter', repeat: true })
    fireEvent.keyDown(input, { key: 'Enter' })
    fireEvent.pointerDown(input, { clientX: 10, clientY: 10 })
    fireEvent.pointerUp(input)
    vi.advanceTimersByTime(100)

    expect(onResult).toHaveBeenCalledOnce()
    expect(onResult).toHaveBeenCalledWith('normal')
  })

  it('preserves the remaining timeout while hidden', async () => {
    vi.useFakeTimers()
    const onResult = vi.fn()
    const view = render(<ShieldSwipe paused mode="arcade" onResult={onResult} timeoutMs={100} />)

    await act(() => vi.advanceTimersByTimeAsync(1_000))
    expect(onResult).not.toHaveBeenCalled()
    view.rerender(<ShieldSwipe paused={false} mode="arcade" onResult={onResult} timeoutMs={100} />)
    await act(() => vi.advanceTimersByTimeAsync(99))
    expect(onResult).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(onResult).toHaveBeenCalledOnce()
    expect(onResult).toHaveBeenCalledWith('normal')
  })
})
