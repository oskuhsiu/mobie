import { compileBattleCues } from './compileBattleCues'
import { isPresentationAbort, RealPresentationClock } from './PresentationClock'
import type {
  BattleCue,
  BattleCueHandler,
  CueContext,
  IntentCueContext,
  IntentPresentationJob,
  PresentationContext,
  PresentationClock,
  PresentationJob,
  PresentationResult,
  TurnPresentationJob,
} from './contracts'

export interface BattleDirectorLifecycle {
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
  clock?: PresentationClock
  compile?: (job: TurnPresentationJob) => readonly BattleCue[]
}

export class BattleDirector {
  private readonly clock: PresentationClock
  private readonly compile: (job: TurnPresentationJob) => readonly BattleCue[]

  constructor(private readonly options: BattleDirectorOptions) {
    this.clock = options.clock ?? new RealPresentationClock()
    this.compile = options.compile ?? compileBattleCues
  }

  async present(job: PresentationJob, signal: AbortSignal): Promise<PresentationResult> {
    const context: PresentationContext = { token: job.token, signal, clock: this.clock }
    try {
      if (job.kind === 'intent') {
        if (!this.options.intentHandler) throw new Error('Battle Director has no intent handler')
        await this.options.intentHandler.play(job, { ...context, token: job.token })
      } else {
        const cueContext: CueContext = { ...context, token: job.token }
        const cues = this.compile(job)
        for (const cue of cues) {
          if (signal.aborted) return 'cancelled'
          if (this.options.lifecycle.beforeCue) {
            await this.clock.race(Promise.resolve(this.options.lifecycle.beforeCue(cue, cueContext)), signal)
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
    }
  }
}
