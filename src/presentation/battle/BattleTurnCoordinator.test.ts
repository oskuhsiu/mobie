import { createBattleState } from '@/game/battle/reducer'
import { mon } from '@/game/battle/testFixtures'
import { BattleDirector } from './BattleDirector'
import { BattleTurnCoordinator } from './BattleTurnCoordinator'
import type {
  BattleCue,
  BattleTransactionPort,
  CancelReason,
  PresentationResult,
  PresentationToken,
  TurnPresentationJob,
  TurnResolution,
} from './contracts'

const before = createBattleState([mon()], [mon()])
const input = { type: 'ATTACK' as const }

function resolution(): TurnResolution {
  return {
    before,
    input,
    events: [],
    nextState: { ...before, turn: before.turn + 1 },
    commitMeta: { energyDelta: 8, dealtDamage: true, lockedIndex: null },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function transaction(calls: string[], current = () => true): BattleTransactionPort {
  return {
    begin: (token) => calls.push(`begin:${token.presentationId}`),
    isCurrent: current,
    commit: (token) => calls.push(`commit:${token.presentationId}`),
    cancel: (token, reason) => calls.push(`cancel:${token.presentationId}:${reason}`),
  }
}

describe('BattleTurnCoordinator', () => {
  it('owns begin → resolve → record → present → current fence → commit exactly once and ignores concurrency', async () => {
    const calls: string[] = []
    const gate = deferred<PresentationResult>()
    const coordinator = new BattleTurnCoordinator({
      session: { battleSessionId: 'battle' },
      resolve: () => { calls.push('resolve'); return resolution() },
      record: () => { calls.push('record') },
      director: { present: async (job) => { calls.push(`present:${job.token.presentationId}`); return gate.promise } },
      transaction: transaction(calls),
    })

    const first = coordinator.submit(before, input)
    await expect(coordinator.submit(before, input)).resolves.toBe('ignored')
    gate.resolve('completed')
    await expect(first).resolves.toBe('completed')
    expect(calls).toEqual(['begin:1', 'resolve', 'record', 'present:1', 'commit:1'])
  })

  it.each(['completed', 'degraded'] as const)('%s presentation commits once', async (result) => {
    const calls: string[] = []
    const coordinator = new BattleTurnCoordinator({
      session: { battleSessionId: 'battle' }, resolve: resolution,
      record: () => undefined, director: { present: async () => result },
      transaction: transaction(calls),
    })
    await expect(coordinator.submit(before, input)).resolves.toBe(result)
    expect(calls.filter((call) => call.startsWith('commit:'))).toHaveLength(1)
  })

  it.each(['unmount', 'superseded'] as const)('%s abort cancels once and never commits', async (reason) => {
    const calls: string[] = []
    const entered = deferred<void>()
    const coordinator = new BattleTurnCoordinator({
      session: { battleSessionId: 'battle' }, resolve: resolution, record: () => undefined,
      director: {
        present: (_job, signal) => new Promise((resolve) => {
          entered.resolve()
          signal.addEventListener('abort', () => resolve('cancelled'), { once: true })
        }),
      },
      transaction: transaction(calls),
    })
    const running = coordinator.submit(before, input)
    await entered.promise
    coordinator.cancel(reason)
    coordinator.cancel(reason)
    await expect(running).resolves.toBe('cancelled')
    expect(calls.filter((call) => call.startsWith('cancel:'))).toEqual([`cancel:1:${reason}`])
    expect(calls.some((call) => call.startsWith('commit:'))).toBe(false)
  })

  it('stale fence cancels once and never commits', async () => {
    const calls: string[] = []
    const coordinator = new BattleTurnCoordinator({
      session: { battleSessionId: 'battle' }, resolve: resolution, record: () => undefined,
      director: { present: async () => 'completed' }, transaction: transaction(calls, () => false),
    })
    await expect(coordinator.submit(before, input)).resolves.toBe('cancelled')
    expect(calls).toContain('cancel:1:stale')
    expect(calls.some((call) => call.startsWith('commit:'))).toBe(false)
  })

  it('does not resolve when begin cannot acquire the current presentation token', async () => {
    const calls: string[] = []
    const coordinator = new BattleTurnCoordinator({
      session: { battleSessionId: 'battle' },
      resolve: () => { calls.push('resolve'); return resolution() },
      record: () => { calls.push('record') },
      director: { present: async () => { calls.push('present'); return 'completed' } },
      transaction: transaction(calls, () => false),
    })

    await expect(coordinator.submit(before, input)).resolves.toBe('cancelled')
    expect(calls).toEqual(['begin:1', 'cancel:1:stale'])
  })

  it('does not retry resolution after recorder or presentation failure and escapes busy via degraded commit', async () => {
    let resolveCount = 0
    let recordCount = 0
    let busy = false
    const tx: BattleTransactionPort = {
      begin: () => { busy = true }, isCurrent: () => true,
      commit: () => { busy = false }, cancel: () => { busy = false },
      recordFailed: () => undefined,
    }
    const coordinator = new BattleTurnCoordinator({
      session: { battleSessionId: 'battle' },
      resolve: () => { resolveCount += 1; return resolution() },
      record: () => { recordCount += 1; throw new Error('recorder offline') },
      director: { present: async () => { throw new Error('cue failed') } },
      transaction: tx,
    })
    await expect(coordinator.submit(before, input)).resolves.toBe('degraded')
    expect({ resolveCount, recordCount, busy }).toEqual({ resolveCount: 1, recordCount: 1, busy: false })
  })

  it('releases ownership even when transaction callbacks throw', async () => {
    let resolveCount = 0
    const coordinator = new BattleTurnCoordinator({
      session: { battleSessionId: 'battle' },
      resolve: () => { resolveCount += 1; return resolution() },
      record: () => { throw new Error('record') },
      director: { present: async () => 'completed' },
      transaction: {
        begin: () => undefined,
        isCurrent: () => true,
        commit: () => { throw new Error('commit') },
        cancel: () => { throw new Error('cancel') },
        recordFailed: () => { throw new Error('notify') },
      },
    })

    await expect(coordinator.submit(before, input)).resolves.toBe('failed')
    await expect(coordinator.submit(before, input)).resolves.toBe('failed')
    expect(resolveCount).toBe(2)
  })

  it('releases ownership when begin and failure notification throw', async () => {
    let beginCount = 0
    const coordinator = new BattleTurnCoordinator({
      session: { battleSessionId: 'battle' }, resolve: resolution, record: () => undefined,
      director: { present: async () => 'completed' },
      transaction: {
        begin: () => { beginCount += 1; throw new Error('begin') },
        isCurrent: () => true,
        commit: () => undefined,
        cancel: () => { throw new Error('cancel') },
        resolveFailed: () => { throw new Error('notify') },
      },
    })

    await expect(coordinator.submit(before, input)).resolves.toBe('failed')
    await expect(coordinator.submit(before, input)).resolves.toBe('failed')
    expect(beginCount).toBe(2)
  })
})

describe('BattleDirector', () => {
  const token: PresentationToken = { battleSessionId: 'battle', presentationId: 1 }
  const job: TurnPresentationJob = { kind: 'turn', token, before, input, events: [] }
  const cue = { kind: 'legacy-event', id: 'event:0:memberFainted', eventIndex: 0, before, event: { type: 'memberFainted', side: 'foe', index: 0 } } as BattleCue

  it('compiles once, plays sequentially, and resets once', async () => {
    const calls: string[] = []
    const director = new BattleDirector({
      compile: () => { calls.push('compile'); return [cue, { ...cue, id: 'event:1:memberFainted' }] },
      handler: { play: async (item) => { calls.push(`play:${item.id}`) } },
      lifecycle: {
        beforeCue: (item) => { calls.push(`before:${item.id}`) },
        reset: () => { calls.push('reset') },
      },
    })
    await expect(director.present(job, new AbortController().signal)).resolves.toBe('completed')
    expect(calls).toEqual([
      'compile', 'before:event:0:memberFainted', 'play:event:0:memberFainted',
      'before:event:1:memberFainted', 'play:event:1:memberFainted', 'reset',
    ])
  })

  it('stops later cues, degrades, and resets once after a cue failure', async () => {
    const calls: string[] = []
    const director = new BattleDirector({
      compile: () => [cue, { ...cue, id: 'never' }],
      handler: { play: async (item) => { calls.push(item.id); throw new Error('shader') } },
      lifecycle: { degraded: () => { calls.push('degraded') }, reset: () => { calls.push('reset') } },
    })
    await expect(director.present(job, new AbortController().signal)).resolves.toBe('degraded')
    expect(calls).toEqual(['event:0:memberFainted', 'degraded', 'reset'])
  })

  it('returns cancelled and resets once on abort', async () => {
    const calls: Array<CancelReason | string> = []
    const controller = new AbortController()
    const director = new BattleDirector({
      compile: () => [cue],
      handler: { play: async (_item, context) => {
        controller.abort('unmount')
        await context.clock.wait(10, context.signal)
      } },
      lifecycle: { reset: () => { calls.push('reset') } },
    })
    await expect(director.present(job, controller.signal)).resolves.toBe('cancelled')
    expect(calls).toEqual(['reset'])
  })
})
