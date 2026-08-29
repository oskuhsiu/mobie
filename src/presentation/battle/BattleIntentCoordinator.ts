import type {
  BattleIntent,
  BattleDisplaySnapshot,
  BattleIntentPresenterPort,
  BattleIntentTransactionPort,
  CancelReason,
  IntentPresentationToken,
  IntentSkipSource,
  IntentSubmissionResult,
  PresentationResult,
} from './contracts'

export interface BattleIntentCoordinatorOptions {
  presenter: BattleIntentPresenterPort
  transaction: BattleIntentTransactionPort
}

interface ActiveIntent {
  token: IntentPresentationToken
  controller: AbortController
  skipSource: IntentSkipSource | null
  cancelReason: CancelReason | null
  completionAttempted: boolean
}

export class BattleIntentCoordinator {
  private active: ActiveIntent | null = null

  constructor(private readonly options: BattleIntentCoordinatorOptions) {}

  async submit(
    intent: BattleIntent,
    snapshot: BattleDisplaySnapshot,
    visualSeed: string,
  ): Promise<IntentSubmissionResult> {
    if (this.active) return 'ignored'

    let token: IntentPresentationToken | null
    try {
      token = this.options.transaction.begin(intent)
    } catch {
      return 'failed'
    }
    if (!token) return 'ignored'

    const active: ActiveIntent = {
      token,
      controller: new AbortController(),
      skipSource: null,
      cancelReason: null,
      completionAttempted: false,
    }
    this.active = active

    try {
      if (!this.isCurrent(active.token)) return 'cancelled'

      let presentation: PresentationResult
      try {
        presentation = await this.options.presenter.present({
          kind: 'intent',
          token: active.token,
          intent,
          snapshot,
          visualSeed,
        }, active.controller.signal)
      } catch {
        presentation = active.controller.signal.aborted ? 'cancelled' : 'degraded'
      }

      if (active.skipSource !== null) {
        return this.completeCurrent(active) ? 'skipped' : 'cancelled'
      }
      if (active.cancelReason !== null) {
        this.cancelCurrent(active, active.cancelReason)
        return 'cancelled'
      }
      if (presentation === 'cancelled' || active.controller.signal.aborted) {
        this.cancelCurrent(active, 'superseded')
        return 'cancelled'
      }
      if (!this.completeCurrent(active)) return 'cancelled'
      return presentation
    } finally {
      if (this.active === active) this.active = null
    }
  }

  skip(source: IntentSkipSource): boolean {
    const active = this.active
    if (!active || active.skipSource !== null || active.cancelReason !== null || active.completionAttempted) return false
    active.skipSource = source
    try {
      active.controller.abort('skip')
    } catch {
      // The completion fence below remains authoritative even if abort delivery fails.
    }
    return true
  }

  cancel(reason: CancelReason): boolean {
    const active = this.active
    if (!active || active.skipSource !== null || active.cancelReason !== null || active.completionAttempted) return false
    active.cancelReason = reason
    try {
      active.controller.abort(reason)
    } catch {
      // The token-fenced transaction cancellation remains authoritative.
    }
    return true
  }

  private completeCurrent(active: ActiveIntent): boolean {
    if (active.completionAttempted || !this.isCurrent(active.token)) return false
    active.completionAttempted = true
    try {
      return this.options.transaction.completeOnce(active.token)
    } catch {
      return false
    }
  }

  private cancelCurrent(active: ActiveIntent, reason: CancelReason): boolean {
    if (active.completionAttempted || !this.isCurrent(active.token)) return false
    active.completionAttempted = true
    try {
      return this.options.transaction.cancelOnce(active.token, reason)
    } catch {
      return false
    }
  }

  private isCurrent(token: IntentPresentationToken): boolean {
    try {
      return this.options.transaction.isCurrent(token)
    } catch {
      return false
    }
  }
}
