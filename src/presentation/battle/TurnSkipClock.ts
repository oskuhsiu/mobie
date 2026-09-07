import type { PresentationClock } from './contracts'
import { presentationAbortError } from './PresentationClock'

/** Turn-only timing adapter. The underlying clock retains visibility pause ownership. */
export class TurnSkipClock implements PresentationClock {
  private readonly pending = new Set<() => void>()
  skipping = false

  constructor(private readonly clock: PresentationClock) {}

  skip(): void {
    this.skipping = true
    for (const finish of [...this.pending]) finish()
  }

  wait(ms: number, signal: AbortSignal): Promise<void> {
    return this.interruptible((local) => this.clock.wait(ms, local), signal)
  }

  race<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
    // Consume late failures even when already skipped/aborted. Turn race callers
    // use void checkpoints; skipping cannot supply a value from unfinished work.
    const observed = Promise.resolve(work)
    void observed.catch(() => undefined)
    return this.interruptible((local) => this.clock.race(observed, local), signal)
  }

  private interruptible<T>(start: (signal: AbortSignal) => Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(presentationAbortError(signal.reason))
    if (this.skipping) return Promise.resolve(undefined as T)
    return new Promise<T>((resolve, reject) => {
      const local = new AbortController()
      let settled = false
      const finish = (done: () => void) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        this.pending.delete(onSkip)
        done()
      }
      const onAbort = () => finish(() => {
        local.abort(signal.reason)
        reject(presentationAbortError(signal.reason))
      })
      const onSkip = () => {
        if (signal.aborted) { onAbort(); return }
        finish(() => {
          local.abort('Turn presentation skipped')
          resolve(undefined as T)
        })
      }
      signal.addEventListener('abort', onAbort, { once: true })
      this.pending.add(onSkip)
      try {
        Promise.resolve(start(local.signal)).then(
          (value) => finish(() => resolve(value)),
          (error: unknown) => finish(() => reject(error)),
        )
      } catch (error) {
        finish(() => reject(error))
      }
    })
  }
}
