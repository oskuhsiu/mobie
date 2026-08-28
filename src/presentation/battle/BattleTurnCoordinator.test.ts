import { createBattleState } from '@/game/battle/reducer'
import { mon } from '@/game/battle/testFixtures'
import type { ReplayInput } from '@/game/replay/types'
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
const token: PresentationToken = {
  battleSessionId: 'battle', resultFingerprint: 'fingerprint', presentationId: 7,
}

function resolution(input: ReplayInput): TurnResolution {
  return {
    before, input, events: [], nextState: { ...before, turn: before.turn + 1 },
    battleSeed: 'seed', turn: before.turn, rngCalls: 0,
    commitMeta: {
      energy: { kind: 'unchanged' }, lockedIndex: 'unchanged', combo: 'unchanged', outcome: null,
    },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function transaction(calls: string[], current = () => true): BattleTransactionPort {
  return {
    begin: (item) => { calls.push(`begin:${item.presentationId}`) },
    isCurrent: current,
    commit: (item) => { calls.push(`commit:${item.presentationId}`); return true },
    cancel: (item, reason) => { calls.push(`cancel:${item.presentationId}:${reason}`) },
  }
}

describe('BattleTurnCoordinator', () => {
  it.each([
    ['regular attack', { type: 'ATTACK', quality: 'good' }],
    ['status attack', { type: 'ATTACK', slotIndex: 1 }],
    ['switch', { type: 'SWITCH', index: 1 }],
    ['chain', { type: 'CHAIN', hits: [{ attackerIndex: 0, quality: 'perfect' }] }],
    ['star', { type: 'ATTACK', starStrike: true }],
  ] satisfies Array<[string, ReplayInput]>)('%s resolves, records, presents, and commits exactly once', async (_label, input) => {
    const calls: string[] = []
    const coordinator = new BattleTurnCoordinator({
      acquireToken: () => token,
      resolve: (_token, _before, value) => { calls.push('resolve'); return resolution(value) },
      tryRecordOnce: () => { calls.push('record'); return 'recorded' },
      director: {
        present: async (job) => {
          calls.push(`present:${job.battleSeed}:${job.turn}`)
          expect(job.input).toBe(input)
          return 'completed'
        },
      },
      transaction: transaction(calls),
    })

    await expect(coordinator.submit(before, input)).resolves.toBe('completed')
    expect(calls).toEqual(['begin:7', 'resolve', 'record', `present:seed:${before.turn}`, 'commit:7'])
  })

  it('ignores concurrency while preserving one active transaction', async () => {
    const gate = deferred<PresentationResult>()
    let resolved = 0
    const coordinator = new BattleTurnCoordinator({
      acquireToken: () => token,
      resolve: (_token, _before, input) => { resolved += 1; return resolution(input) },
      tryRecordOnce: () => 'recorded', director: { present: () => gate.promise },
      transaction: transaction([]),
    })
    const first = coordinator.submit(before, { type: 'ATTACK' })
    await expect(coordinator.submit(before, { type: 'SWITCH', index: 0 })).resolves.toBe('ignored')
    gate.resolve('completed')
    await expect(first).resolves.toBe('completed')
    expect(resolved).toBe(1)
  })

  it('does not begin or resolve when token allocation returns null', async () => {
    const calls: string[] = []
    const coordinator = new BattleTurnCoordinator({
      acquireToken: () => null,
      resolve: (_token, _before, input) => { calls.push('resolve'); return resolution(input) },
      tryRecordOnce: () => { calls.push('record'); return 'recorded' },
      director: { present: async () => { calls.push('present'); return 'completed' } },
      transaction: transaction(calls),
    })
    await expect(coordinator.submit(before, { type: 'ATTACK' })).resolves.toBe('ignored')
    expect(calls).toEqual([])
  })

  it('does not recalculate after recorder failure or presentation degradation', async () => {
    let resolveCount = 0
    let recordCount = 0
    let commitCount = 0
    const coordinator = new BattleTurnCoordinator({
      acquireToken: () => token,
      resolve: (_token, _before, input) => { resolveCount += 1; return resolution(input) },
      tryRecordOnce: () => { recordCount += 1; return 'failed' },
      director: { present: async () => 'degraded' },
      transaction: {
        begin: () => undefined, isCurrent: () => true,
        commit: () => { commitCount += 1; return true }, cancel: () => undefined,
      },
    })
    await expect(coordinator.submit(before, { type: 'ATTACK' })).resolves.toBe('degraded')
    expect({ resolveCount, recordCount, commitCount }).toEqual({ resolveCount: 1, recordCount: 1, commitCount: 1 })
  })

  it('rejects a resolution whose semantic outcome disagrees with canonical state', async () => {
    let presented = false
    const coordinator = new BattleTurnCoordinator({
      acquireToken: () => token,
      resolve: (_token, _before, input) => ({
        ...resolution(input), events: [{ type: 'battleEnded', winner: 'player' }],
        nextState: { ...before, winner: 'foe' },
        commitMeta: {
          energy: { kind: 'unchanged' }, lockedIndex: 'unchanged', combo: 'unchanged',
          outcome: { winner: 'player', outcome: 'win' },
        },
      }),
      tryRecordOnce: () => 'recorded',
      director: { present: async () => { presented = true; return 'completed' } },
      transaction: transaction([]),
    })
    await expect(coordinator.submit(before, { type: 'ATTACK' })).resolves.toBe('failed')
    expect(presented).toBe(false)
  })

  it.each(['unmount', 'superseded'] as const)('%s abort cancels once and never commits', async (reason) => {
    const calls: string[] = []
    const entered = deferred<void>()
    const coordinator = new BattleTurnCoordinator({
      acquireToken: () => token,
      resolve: (_token, _before, input) => resolution(input), tryRecordOnce: () => 'recorded',
      director: {
        present: (_job, signal) => new Promise((resolve) => {
          entered.resolve()
          signal.addEventListener('abort', () => resolve('cancelled'), { once: true })
        }),
      },
      transaction: transaction(calls),
    })
    const running = coordinator.submit(before, { type: 'ATTACK' })
    await entered.promise
    coordinator.cancel(reason)
    coordinator.cancel(reason)
    await expect(running).resolves.toBe('cancelled')
    expect(calls.filter((call) => call.startsWith('cancel:'))).toEqual([`cancel:7:${reason}`])
    expect(calls.some((call) => call.startsWith('commit:'))).toBe(false)
  })

  it('stale post-presentation fence cancels and never commits', async () => {
    let currentChecks = 0
    const calls: string[] = []
    const coordinator = new BattleTurnCoordinator({
      acquireToken: () => token,
      resolve: (_token, _before, input) => resolution(input), tryRecordOnce: () => 'recorded',
      director: { present: async () => 'completed' },
      transaction: transaction(calls, () => { currentChecks += 1; return currentChecks === 1 }),
    })
    await expect(coordinator.submit(before, { type: 'ATTACK' })).resolves.toBe('cancelled')
    expect(calls).toContain('cancel:7:stale')
    expect(calls.some((call) => call.startsWith('commit:'))).toBe(false)
  })

  it('does not turn a committed route transition into an unmount cancellation', async () => {
    const calls: string[] = []
    let coordinator!: BattleTurnCoordinator
    coordinator = new BattleTurnCoordinator({
      acquireToken: () => token,
      resolve: (_token, _before, input) => resolution(input),
      tryRecordOnce: () => 'recorded',
      director: { present: async () => 'completed' },
      transaction: {
        begin: () => undefined,
        isCurrent: () => true,
        commit: () => {
          calls.push('commit')
          coordinator.cancel('unmount')
          return true
        },
        cancel: () => { calls.push('cancel') },
      },
    })

    await expect(coordinator.submit(before, { type: 'ATTACK' })).resolves.toBe('completed')
    expect(calls).toEqual(['commit'])
  })
})

describe('BattleDirector', () => {
  const job: TurnPresentationJob = {
    kind: 'turn', token, before, input: { type: 'ATTACK' }, events: [], battleSeed: 'seed', turn: 1,
  }
  const cue = {
    kind: 'legacy-event', id: 'event:0:memberFainted', eventIndex: 0, before,
    event: { type: 'memberFainted', side: 'foe', index: 0 },
  } as BattleCue

  it('compiles once, plays sequentially, and resets once', async () => {
    const calls: string[] = []
    const director = new BattleDirector({
      compile: () => { calls.push('compile'); return [cue, { ...cue, id: 'event:1:memberFainted' } as BattleCue] },
      handler: { play: async (item) => { calls.push(`play:${item.id}`) } },
      lifecycle: { beforeCue: (item) => { calls.push(`before:${item.id}`) }, reset: () => { calls.push('reset') } },
    })
    await expect(director.present(job, new AbortController().signal)).resolves.toBe('completed')
    expect(calls).toEqual([
      'compile', 'before:event:0:memberFainted', 'play:event:0:memberFainted',
      'before:event:1:memberFainted', 'play:event:1:memberFainted', 'reset',
    ])
  })

  it('degrades on cue failure and resets once', async () => {
    const calls: string[] = []
    const director = new BattleDirector({
      compile: () => [cue], handler: { play: async () => { throw new Error('shader') } },
      lifecycle: { degraded: () => { calls.push('degraded') }, reset: () => { calls.push('reset') } },
    })
    await expect(director.present(job, new AbortController().signal)).resolves.toBe('degraded')
    expect(calls).toEqual(['degraded', 'reset'])
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
