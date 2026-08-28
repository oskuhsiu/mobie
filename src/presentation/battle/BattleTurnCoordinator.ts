import type {
  BattleDirectorPort,
  BattleSessionToken,
  BattleTransactionPort,
  CancelReason,
  NormalAttackInput,
  PresentationToken,
  TurnPresentationJob,
  TurnResolution,
  TurnSubmissionResult,
} from './contracts'
import type { BattleState } from '@/game/battle/reducer'

export interface BattleTurnCoordinatorOptions {
  session: BattleSessionToken
  resolve(token: PresentationToken, before: BattleState, input: NormalAttackInput): TurnResolution
  record(token: PresentationToken, input: NormalAttackInput, events: TurnResolution['events']): void
  director: BattleDirectorPort
  transaction: BattleTransactionPort
}

interface ActiveTurn {
  token: PresentationToken
  controller: AbortController
  cancelRequested: boolean
}

export class BattleTurnCoordinator {
  private nextPresentationId = 1
  private active: ActiveTurn | null = null

  constructor(private readonly options: BattleTurnCoordinatorOptions) {}

  async submit(before: BattleState, input: NormalAttackInput): Promise<TurnSubmissionResult> {
    if (this.active) return 'ignored'

    const active: ActiveTurn = {
      token: { ...this.options.session, presentationId: this.nextPresentationId++ },
      controller: new AbortController(),
      cancelRequested: false,
    }
    this.active = active
    try {
      try {
        this.options.transaction.begin(active.token, before)
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
      } catch (error) {
        if (this.isCurrent(active.token)) this.notifyResolveFailed(active.token, error)
        this.requestCancel(active, 'stale')
        return 'failed'
      }

      try {
        this.options.record(active.token, input, resolution.events)
      } catch (error) {
        this.notifyRecordFailed(active.token, error)
      }

      const job: TurnPresentationJob = {
        kind: 'turn',
        token: active.token,
        before,
        input,
        events: resolution.events,
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
        this.options.transaction.commit(active.token, resolution)
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
    if (!this.active) return
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

  private isCurrent(token: PresentationToken): boolean {
    try {
      return this.options.transaction.isCurrent(token)
    } catch {
      return false
    }
  }

  private notifyResolveFailed(token: PresentationToken, error: unknown): void {
    try {
      this.options.transaction.resolveFailed?.(token, error)
    } catch {
      // Failure notification is best-effort; cancellation still releases the turn.
    }
  }

  private notifyRecordFailed(token: PresentationToken, error: unknown): void {
    try {
      this.options.transaction.recordFailed?.(token, error)
    } catch {
      // Recorder degradation is non-blocking and never reruns the resolver.
    }
  }

  private release(active: ActiveTurn): void {
    if (this.active === active) this.active = null
  }
}
