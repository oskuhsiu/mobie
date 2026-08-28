import { compileBattleCues } from './compileBattleCues'
import { isPresentationAbort, RealPresentationClock } from './PresentationClock'
import type {
  BattleCue,
  BattleCueHandler,
  CueContext,
  PresentationClock,
  PresentationResult,
  TurnPresentationJob,
} from './contracts'

export interface BattleDirectorLifecycle {
  beforeCue?(cue: BattleCue, context: CueContext): Promise<void> | void
  degraded?(error: unknown, context: CueContext): Promise<void> | void
  reset(context: CueContext): Promise<void> | void
}

export interface BattleDirectorOptions {
  handler: BattleCueHandler
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

  async present(job: TurnPresentationJob, signal: AbortSignal): Promise<PresentationResult> {
    const context: CueContext = { token: job.token, signal, clock: this.clock }
    try {
      const cues = this.compile(job)
      for (const cue of cues) {
        if (signal.aborted) return 'cancelled'
        if (this.options.lifecycle.beforeCue) {
          await this.clock.race(Promise.resolve(this.options.lifecycle.beforeCue(cue, context)), signal)
        }
        await this.options.handler.play(cue, context)
      }
      return signal.aborted ? 'cancelled' : 'completed'
    } catch (error) {
      if (signal.aborted || isPresentationAbort(error)) return 'cancelled'
      if (this.options.lifecycle.degraded) {
        try {
          await Promise.resolve(this.options.lifecycle.degraded(error, context))
        } catch {
          // Degraded cleanup is best-effort; the coordinator must still escape busy.
        }
      }
      return 'degraded'
    } finally {
      try {
        await Promise.resolve(this.options.lifecycle.reset(context))
      } catch {
        // Reset is best-effort and must not change the transaction result.
      }
    }
  }
}
