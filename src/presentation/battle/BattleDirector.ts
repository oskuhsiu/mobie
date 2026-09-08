import { compileBattleCues } from './compileBattleCues'
import { samePresentationToken } from './battleIdentity'
import { isPresentationAbort, RealPresentationClock } from './PresentationClock'
import { TurnSkipClock } from './TurnSkipClock'
import type {
  BattleCue,
  BattleCueHandler,
  CueContext,
  IntentCueContext,
  IntentPresentationJob,
  PausablePresentationClock,
  PresentationContext,
  PresentationJob,
  PresentationResult,
  PresentationToken,
  TurnPresentationJob,
} from './contracts'

export interface BattleDirectorLifecycle {
  /** Apply queued display-cost changes only between presentation cues/jobs. */
  safeCueBoundary?(job: PresentationJob, context: PresentationContext): Promise<void> | void
  beforeCue?(cue: BattleCue, context: CueContext): Promise<void> | void
  degraded?(error: unknown, job: PresentationJob, context: PresentationContext): Promise<void> | void
  reset(job: PresentationJob, context: PresentationContext): Promise<void> | void
}

export interface BattleIntentHandler {
  play(job: IntentPresentationJob, context: IntentCueContext): Promise<void>
}

export interface BattleDirectorOptions {
  handler: BattleCueHandler
  intentHandler?: BattleIntentHandler
  lifecycle: BattleDirectorLifecycle
  clock?: PausablePresentationClock
  compile?: (job: TurnPresentationJob) => readonly BattleCue[]
}

export class BattleDirector {
  private readonly clock: PausablePresentationClock
  private readonly compile: (job: TurnPresentationJob) => readonly BattleCue[]
  private activeToken: PresentationToken | null = null
  private pendingClockState: { token: PresentationToken; paused: boolean } | null = null
  private clockPaused = false
  private activeTurnClock: TurnSkipClock | null = null

  constructor(private readonly options: BattleDirectorOptions) {
    this.clock = options.clock ?? new RealPresentationClock()
    this.compile = options.compile ?? compileBattleCues
  }

  async present(job: PresentationJob, signal: AbortSignal): Promise<PresentationResult> {
    this.activeToken = job.token
    const turnClock = job.kind === 'turn' ? new TurnSkipClock(this.clock) : null
    this.activeTurnClock = turnClock
    if (this.pendingClockState && samePresentationToken(this.pendingClockState.token, job.token)) {
      this.clockPaused = this.pendingClockState.paused
      this.pendingClockState = null
    }
    if (this.clockPaused) this.clock.pause()
    else this.clock.resume()
    const context: PresentationContext = { token: job.token, signal, clock: this.clock }
    try {
      if (this.options.lifecycle.safeCueBoundary) {
        await this.clock.race(
          Promise.resolve(this.options.lifecycle.safeCueBoundary(job, context)),
          signal,
        )
      }
      if (job.kind === 'intent') {
        if (!this.options.intentHandler) throw new Error('Battle Director has no intent handler')
        await this.options.intentHandler.play(job, { ...context, token: job.token })
      } else {
        const cueContext: CueContext = {
          ...context, token: job.token, clock: turnClock!,
          get skipping() { return turnClock!.skipping },
        }
        const cues = this.compile(job)
        for (const cue of cues) {
          if (signal.aborted) return 'cancelled'
          if (this.options.lifecycle.beforeCue) {
            await cueContext.clock.race(Promise.resolve(this.options.lifecycle.beforeCue(cue, cueContext)), signal)
          }
          await this.options.handler.play(cue, cueContext)
        }
      }
      return signal.aborted ? 'cancelled' : 'completed'
    } catch (error) {
      if (signal.aborted || isPresentationAbort(error)) return 'cancelled'
      if (this.options.lifecycle.degraded) {
        try {
          await Promise.resolve(this.options.lifecycle.degraded(error, job, context))
        } catch {
          // Degraded cleanup is best-effort; the coordinator must still escape busy.
        }
      }
      return 'degraded'
    } finally {
      try {
        await Promise.resolve(this.options.lifecycle.reset(job, context))
      } catch {
        // Reset is best-effort and must not change the transaction result.
      }
      if (samePresentationToken(this.activeToken, job.token)) {
        this.activeToken = null
        this.activeTurnClock = null
      }
    }
  }

  skip(token: PresentationToken): boolean {
    if (!samePresentationToken(this.activeToken, token) || !this.activeTurnClock) return false
    this.activeTurnClock.skip()
    return true
  }

  pause(token: PresentationToken): boolean {
    if (!samePresentationToken(this.activeToken, token)) {
      this.pendingClockState = { token, paused: true }
      return true
    }
    this.clockPaused = true
    this.clock.pause()
    return true
  }

  resume(token: PresentationToken): boolean {
    if (!samePresentationToken(this.activeToken, token)) {
      this.pendingClockState = { token, paused: false }
      return true
    }
    this.clockPaused = false
    this.clock.resume()
    return true
  }

}
