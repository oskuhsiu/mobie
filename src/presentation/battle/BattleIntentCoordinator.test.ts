import { BattleIntentCoordinator } from './BattleIntentCoordinator'
import type {
  BattleIntent,
  BattleDisplaySnapshot,
  BattleIntentTransactionPort,
  IntentPresentationToken,
  PresentationResult,
} from './contracts'

const intent: BattleIntent = {
  kind: 'intro',
  id: 'intro',
  foeEntrance: { id: 'foe', message: 'A foe appeared' },
  playerEntrance: { id: 'player', message: 'Go!' },
  terrain: null,
  synergy: null,
}

const token: IntentPresentationToken = {
  battleSessionId: 'battle',
  resultFingerprint: 'fingerprint',
  presentationId: 4,
  purpose: 'intent',
  intentId: 'intro',
}

const snapshot: BattleDisplaySnapshot = {
  player: { members: [], activeIndex: 0 },
  foe: { members: [], activeIndex: 0 },
  terrainIds: [],
  sideStatuses: { player: [], foe: [] },
  fieldMarks: [],
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function transaction(calls: string[], current = () => true): BattleIntentTransactionPort {
  return {
    begin: (value) => { calls.push(`begin:${value.id}`); return token },
    isCurrent: current,
    completeOnce: (value) => { calls.push(`complete:${value.presentationId}`); return true },
    cancelOnce: (value, reason) => { calls.push(`cancel:${value.presentationId}:${reason}`); return true },
  }
}

describe('BattleIntentCoordinator', () => {
  it('uses the transaction-tagged token and completes exactly once', async () => {
    const calls: string[] = []
    const coordinator = new BattleIntentCoordinator({
      presenter: {
        present: async (job) => {
          calls.push(`present:${job.token.purpose}:${job.token.intentId}:${job.snapshot === snapshot}:${job.visualSeed}`)
          return 'completed'
        },
      },
      transaction: transaction(calls),
    })

    await expect(coordinator.submit(intent, snapshot, 'visual-seed')).resolves.toBe('completed')
    expect(calls).toEqual(['begin:intro', 'present:intent:intro:true:visual-seed', 'complete:4'])
  })

  it('accepts only the first skip source, aborts presentation, and completes once', async () => {
    const calls: string[] = []
    const entered = deferred<void>()
    const coordinator = new BattleIntentCoordinator({
      presenter: {
        present: (_job, signal) => new Promise<PresentationResult>((resolve) => {
          entered.resolve()
          signal.addEventListener('abort', () => {
            calls.push(`abort:${String(signal.reason)}`)
            resolve('cancelled')
          }, { once: true })
        }),
      },
      transaction: transaction(calls),
    })

    const running = coordinator.submit(intent, snapshot, 'seed')
    await entered.promise
    expect(coordinator.skip('touch')).toBe(true)
    expect(coordinator.skip('enter')).toBe(false)
    expect(coordinator.skip('escape')).toBe(false)
    await expect(running).resolves.toBe('skipped')
    expect(calls.filter((call) => call.startsWith('abort:'))).toEqual(['abort:skip'])
    expect(calls.filter((call) => call.startsWith('complete:'))).toEqual(['complete:4'])
  })

  it('performs zero completion writes when the token becomes stale', async () => {
    const calls: string[] = []
    let checks = 0
    const coordinator = new BattleIntentCoordinator({
      presenter: { present: async () => 'completed' },
      transaction: transaction(calls, () => { checks += 1; return checks === 1 }),
    })

    await expect(coordinator.submit(intent, snapshot, 'seed')).resolves.toBe('cancelled')
    expect(calls).toEqual(['begin:intro'])
  })

  it('cancels an unmounted intent once without completing it', async () => {
    const calls: string[] = []
    const entered = deferred<void>()
    const coordinator = new BattleIntentCoordinator({
      presenter: {
        present: (_job, signal) => new Promise<PresentationResult>((resolve) => {
          entered.resolve()
          signal.addEventListener('abort', () => resolve('cancelled'), { once: true })
        }),
      },
      transaction: transaction(calls),
    })

    const running = coordinator.submit(intent, snapshot, 'seed')
    await entered.promise
    expect(coordinator.cancel('unmount')).toBe(true)
    expect(coordinator.cancel('unmount')).toBe(false)
    await expect(running).resolves.toBe('cancelled')
    expect(calls.filter((call) => call.startsWith('cancel:'))).toEqual(['cancel:4:unmount'])
    expect(calls.some((call) => call.startsWith('complete:'))).toBe(false)
  })

  it('degrades presenter errors into the same safe completion', async () => {
    const calls: string[] = []
    const coordinator = new BattleIntentCoordinator({
      presenter: { present: async () => { throw new Error('display failed') } },
      transaction: transaction(calls),
    })

    await expect(coordinator.submit(intent, snapshot, 'seed')).resolves.toBe('degraded')
    expect(calls).toEqual(['begin:intro', 'complete:4'])
  })

  it('ignores concurrent submissions while one intent owns presentation', async () => {
    const gate = deferred<PresentationResult>()
    const calls: string[] = []
    const coordinator = new BattleIntentCoordinator({
      presenter: { present: () => gate.promise },
      transaction: transaction(calls),
    })

    const first = coordinator.submit(intent, snapshot, 'first')
    await expect(coordinator.submit(intent, snapshot, 'second')).resolves.toBe('ignored')
    gate.resolve('completed')
    await expect(first).resolves.toBe('completed')
    expect(calls.filter((call) => call.startsWith('begin:'))).toHaveLength(1)
    expect(calls.filter((call) => call.startsWith('complete:'))).toHaveLength(1)
  })
})
