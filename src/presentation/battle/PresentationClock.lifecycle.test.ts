import { RealPresentationClock } from './PresentationClock'

interface PausableClock {
  pause(): void
  resume(): void
}

describe('presentation clock lifecycle', () => {
  afterEach(() => { vi.useRealTimers() })

  it('preserves the remaining wait while paused', async () => {
    vi.useFakeTimers()
    const clock = new RealPresentationClock() as RealPresentationClock & Partial<PausableClock>
    const controller = new AbortController()
    let completed = false
    const waiting = clock.wait(100, controller.signal).then(() => { completed = true })

    await vi.advanceTimersByTimeAsync(40)
    expect(typeof clock.pause).toBe('function')
    clock.pause?.()
    await vi.advanceTimersByTimeAsync(1_000)
    expect(completed).toBe(false)

    clock.resume?.()
    await vi.advanceTimersByTimeAsync(59)
    expect(completed).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    await waiting
    expect(completed).toBe(true)
  })

  it('aborts a pending wait while paused', async () => {
    vi.useFakeTimers()
    const clock = new RealPresentationClock()
    const controller = new AbortController()
    const waiting = clock.wait(100, controller.signal)

    await vi.advanceTimersByTimeAsync(40)
    clock.pause()
    controller.abort('hidden battle left')

    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    clock.resume()
    await vi.advanceTimersByTimeAsync(100)
  })
})
