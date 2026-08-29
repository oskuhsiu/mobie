import type { PausablePresentationClock } from './contracts'
import { PausableScheduler } from './PausableScheduler'

export function presentationAbortError(reason?: unknown): DOMException {
  if (reason instanceof DOMException && reason.name === 'AbortError') return reason
  return new DOMException(typeof reason === 'string' ? reason : 'Presentation cancelled', 'AbortError')
}

export function isPresentationAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export class RealPresentationClock implements PausablePresentationClock {
  private readonly scheduler = new PausableScheduler()

  pause(): void {
    this.scheduler.pause()
  }

  resume(): void {
    this.scheduler.resume()
  }

  wait(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(presentationAbortError(signal.reason))
    return new Promise((resolve, reject) => {
      const timer = this.scheduler.schedule(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, ms)
      const onAbort = () => {
        this.scheduler.cancel(timer)
        signal.removeEventListener('abort', onAbort)
        reject(presentationAbortError(signal.reason))
      }
      signal.addEventListener('abort', onAbort, { once: true })
    })
  }

  race<T>(work: PromiseLike<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) {
      void Promise.resolve(work).catch(() => undefined)
      return Promise.reject(presentationAbortError(signal.reason))
    }
    return new Promise<T>((resolve, reject) => {
      let settled = false
      const finish = (callback: () => void) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        callback()
      }
      const onAbort = () => finish(() => reject(presentationAbortError(signal.reason)))
      signal.addEventListener('abort', onAbort, { once: true })
      Promise.resolve(work).then(
        (value) => finish(() => resolve(value)),
        (error: unknown) => finish(() => reject(error)),
      )
    })
  }
}
