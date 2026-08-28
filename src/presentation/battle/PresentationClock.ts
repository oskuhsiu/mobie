import type { PresentationClock as PresentationClockContract } from './contracts'

export function presentationAbortError(reason?: unknown): DOMException {
  if (reason instanceof DOMException && reason.name === 'AbortError') return reason
  return new DOMException(typeof reason === 'string' ? reason : 'Presentation cancelled', 'AbortError')
}

export function isPresentationAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

export class RealPresentationClock implements PresentationClockContract {
  wait(ms: number, signal: AbortSignal): Promise<void> {
    if (signal.aborted) return Promise.reject(presentationAbortError(signal.reason))
    return new Promise((resolve, reject) => {
      const timer = globalThis.setTimeout(() => {
        signal.removeEventListener('abort', onAbort)
        resolve()
      }, Math.max(0, ms))
      const onAbort = () => {
        globalThis.clearTimeout(timer)
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
