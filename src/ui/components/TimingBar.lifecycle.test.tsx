// @vitest-environment jsdom

import { act, fireEvent, render } from '@testing-library/react'
import { TimingBar } from './TimingBar'

describe('pausable battle input clock', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    vi.stubGlobal('requestAnimationFrame', vi.fn(() => 1))
    vi.stubGlobal('cancelAnimationFrame', vi.fn())
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('ignores input while paused and resumes the remaining timeout', async () => {
    const onResult = vi.fn()
    const view = render(<TimingBar paused timeoutMs={100} onResult={onResult} />)

    await act(() => vi.advanceTimersByTimeAsync(1_000))
    fireEvent.pointerDown(view.getByRole('button'))
    expect(onResult).not.toHaveBeenCalled()

    view.rerender(<TimingBar paused={false} timeoutMs={100} onResult={onResult} />)
    await act(() => vi.advanceTimersByTimeAsync(99))
    expect(onResult).not.toHaveBeenCalled()
    await act(() => vi.advanceTimersByTimeAsync(1))
    expect(onResult).toHaveBeenCalledOnce()
  })
})
