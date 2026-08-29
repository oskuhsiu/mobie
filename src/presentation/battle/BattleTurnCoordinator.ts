import type {
  BattleTurnDirectorPort,
  BattleTransactionPort,
  CancelReason,
  TurnPresentationToken,
  TryRecordStatus,
  TurnInput,
  TurnPresentationJob,
  TurnResolution,
  TurnSubmissionResult,
} from './contracts'
import type { BattleState } from '@/game/battle/reducer'

export interface BattleTurnCoordinatorOptions {
  acquireToken(): TurnPresentationToken | null
  resolve(token: TurnPresentationToken, before: BattleState, input: TurnInput): TurnResolution
  tryRecordOnce(token: TurnPresentationToken, input: TurnInput, events: TurnResolution['events']): TryRecordStatus
  director: BattleTurnDirectorPort
  transaction: BattleTransactionPort
}

interface ActiveTurn {
  token: TurnPresentationToken
  controller: AbortController
  cancelRequested: boolean
  commitStarted: boolean
}

function validateOutcome(resolution: TurnResolution): void {
  const outcomes = resolution.events.filter((event) => event.type === 'battleEnded')
  if (outcomes.length > 1) throw new Error('A turn resolution may contain at most one battleEnded event')
  const event = outcomes[0]
  const meta = resolution.commitMeta.outcome
  if (!event) {
    if (resolution.nextState.winner !== null || meta !== null) {
      throw new Error('Outcome state requires a battleEnded event')
    }
    return
  }
  const expectedOutcome = event.winner === 'player' ? 'win' : 'lose'
  if (
    resolution.nextState.winner !== event.winner
    || meta?.winner !== event.winner
    || meta.outcome !== expectedOutcome
    || meta.reason !== event.reason
  ) {
    throw new Error('battleEnded must agree with nextState and commit outcome')
  }
}

export class BattleTurnCoordinator {
  private active: ActiveTurn | null = null

  constructor(private readonly options: BattleTurnCoordinatorOptions) {}

  async submit(before: BattleState, input: TurnInput): Promise<TurnSubmissionResult> {
    if (this.active) return 'ignored'

    const token = this.options.acquireToken()
    if (!token) return 'ignored'

    const active: ActiveTurn = {
      token,
      controller: new AbortController(),
      cancelRequested: false,
      commitStarted: false,
    }
    this.active = active
    try {
      try {
        this.options.transaction.begin(active.token, before, input)
      } catch (error) {
        this.notifyResolveFailed(active.token, error)
        this.requestCancel(active, 'stale')
        return 'failed'
      }
      if (!this.isCurrent(active.token)) {
        this.requestCancel(active, 'stale')
        return 'cancelled'
      }

      let resolution: TurnResolution
      try {
        resolution = this.options.resolve(active.token, before, input)
        validateOutcome(resolution)
      } catch (error) {
        if (this.isCurrent(active.token)) this.notifyResolveFailed(active.token, error)
        this.requestCancel(active, 'stale')
        return 'failed'
      }

      // Recorder failure degrades replay only. Contain even a contract-breaking
      // adapter throw so the already-resolved turn is never rerun or stranded busy.
      try {
        this.options.tryRecordOnce(active.token, input, resolution.events)
      } catch (error) {
        if (this.isCurrent(active.token)) this.notifyRecordFailed(active.token, error)
      }
      if (!this.isCurrent(active.token)) {
        this.requestCancel(active, 'stale')
        return 'cancelled'
      }

      const job: TurnPresentationJob = {
        kind: 'turn',
        token: active.token,
        before,
        input,
        events: resolution.events,
        battleSeed: resolution.battleSeed,
        turn: resolution.turn,
      }

      let presentation: 'completed' | 'degraded' | 'cancelled'
      try {
        presentation = await this.options.director.present(job, active.controller.signal)
      } catch {
        presentation = active.controller.signal.aborted ? 'cancelled' : 'degraded'
      }

      const isCurrent = this.isCurrent(active.token)
      if (presentation === 'cancelled' || active.controller.signal.aborted || !isCurrent) {
        this.requestCancel(active, !isCurrent ? 'stale' : 'superseded')
        return 'cancelled'
      }

      try {
        active.commitStarted = true
        if (!this.options.transaction.commit(active.token, resolution)) {
          this.requestCancel(active, 'stale')
          return 'cancelled'
        }
      } catch {
        this.requestCancel(active, 'stale')
        return 'failed'
      }
      return presentation
    } finally {
      this.release(active)
    }
  }

  cancel(reason: CancelReason): void {
    if (!this.active || this.active.commitStarted) return
    try {
      this.active.controller.abort(reason)
    } catch {
      // Cancellation still reaches the transaction adapter below.
    }
    this.requestCancel(this.active, reason)
  }

  private requestCancel(active: ActiveTurn, reason: CancelReason): void {
    if (active.cancelRequested) return
    active.cancelRequested = true
    try {
      this.options.transaction.cancel(active.token, reason)
    } catch {
      // A faulty adapter must not strand coordinator ownership.
    }
  }

  private isCurrent(token: TurnPresentationToken): boolean {
    try {
      return this.options.transaction.isCurrent(token)
    } catch {
      return false
    }
  }

  private notifyResolveFailed(token: TurnPresentationToken, error: unknown): void {
    try {
      this.options.transaction.resolveFailed?.(token, error)
    } catch {
      // Failure notification is best-effort; cancellation still releases the turn.
    }
  }

  private notifyRecordFailed(token: TurnPresentationToken, error: unknown): void {
    try {
      this.options.transaction.recordFailed?.(token, error)
    } catch {
      // Replay failure notification cannot block presentation or canonical commit.
    }
  }

  private release(active: ActiveTurn): void {
    if (this.active === active) this.active = null
  }
}
