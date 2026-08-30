// @vitest-environment jsdom

import { act, fireEvent, render } from '@testing-library/react'
import { rhythmTaps } from '@/input/gestures'
import { RhythmTap } from './StarStrikeGestures'

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
