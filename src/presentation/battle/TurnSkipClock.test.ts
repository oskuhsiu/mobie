import { createBattleState } from '@/game/battle/reducer'
import { mon } from '@/game/battle/testFixtures'
import { BattleDirector } from './BattleDirector'
import { RealPresentationClock } from './PresentationClock'
import { TurnSkipClock } from './TurnSkipClock'
import type { BattleCue, TurnPresentationJob } from './contracts'

describe('turn skip timing', () => {
  afterEach(() => vi.useRealTimers())

  it('resolves pending waits and checkpoints, consumes late failure, and preserves true abort', async () => {
    vi.useFakeTimers()
    const clock = new TurnSkipClock(new RealPresentationClock())
    const controller = new AbortController()
    let rejectLate!: (error: Error) => void
    const pending = clock.wait(5000, controller.signal)
    const checkpoint = clock.race(new Promise<void>((_, reject) => { rejectLate = reject }), controller.signal)
    clock.skip()
    await Promise.all([pending, checkpoint, clock.wait(5000, controller.signal)])
    expect(controller.signal.aborted).toBe(false)
    expect(vi.getTimerCount()).toBe(0)
    rejectLate(new Error('late checkpoint'))
    await Promise.resolve()
    controller.abort('left battle')
    await expect(clock.wait(10, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })

    const next = new TurnSkipClock(new RealPresentationClock())
    const cancel = new AbortController()
    const waiting = next.wait(5000, cancel.signal)
    cancel.abort()
    await expect(waiting).rejects.toMatchObject({ name: 'AbortError' })
    expect(vi.getTimerCount()).toBe(0)
  })

  it('accepts only the active turn token and resets skip ownership for the next job', async () => {
    vi.useFakeTimers()
    const job: TurnPresentationJob = {
      kind: 'turn', token: { battleSessionId: 'battle', presentationId: 1, resultFingerprint: 'result', purpose: 'turn' },
      before: createBattleState([mon()], [mon()]), input: { type: 'ATTACK' }, events: [], battleSeed: 'seed', turn: 1,
    }
    const states: boolean[] = []
    const reset = vi.fn()
    const director = new BattleDirector({
      compile: () => [{} as BattleCue], lifecycle: { reset },
      handler: { async play(_cue, context) {
        states.push(Boolean(context.skipping))
        await context.clock.wait(5000, context.signal)
        states.push(Boolean(context.skipping))
      } },
    })
    const controller = new AbortController()
    const first = director.present(job, controller.signal)
    expect(director.skip({ ...job.token, presentationId: 2 })).toBe(false)
    expect(director.skip(job.token)).toBe(true)
    await expect(first).resolves.toBe('completed')
    expect(states).toEqual([false, true])
    expect(director.skip(job.token)).toBe(false)
    const second = director.present({ ...job, token: { ...job.token, presentationId: 2 } }, controller.signal)
    expect(states).toEqual([false, true, false])
    expect(director.skip(job.token)).toBe(false)
    controller.abort()
    await expect(second).resolves.toBe('cancelled')
    expect(reset).toHaveBeenCalledTimes(2)
  })
})
