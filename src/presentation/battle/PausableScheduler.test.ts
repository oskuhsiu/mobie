import { PausableScheduler } from './PausableScheduler'

describe('PausableScheduler', () => {
  afterEach(() => { vi.useRealTimers() })

  it('preserves each timeout and logical time while paused', async () => {
    vi.useFakeTimers()
    const scheduler = new PausableScheduler(() => Date.now())
    const first = vi.fn()
    const second = vi.fn()
    scheduler.schedule(first, 100)
    scheduler.schedule(second, 180)

    await vi.advanceTimersByTimeAsync(40)
    const pausedLogicalTime = scheduler.now()
    scheduler.pause()
    await vi.advanceTimersByTimeAsync(1_000)

    expect(scheduler.now()).toBe(pausedLogicalTime)
    expect(first).not.toHaveBeenCalled()
    expect(second).not.toHaveBeenCalled()

    scheduler.resume()
    await vi.advanceTimersByTimeAsync(59)
    expect(first).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1)
    expect(first).toHaveBeenCalledOnce()
    expect(second).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(80)
    expect(second).toHaveBeenCalledOnce()
    expect(scheduler.now()).toBe(pausedLogicalTime + 140)
  })
})
