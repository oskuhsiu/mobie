import type { CueContext } from './contracts'

/** Run a synchronous or async display adapter under the active presentation signal. */
export async function invokePresentationPort(
  work: Promise<void> | void,
  context: CueContext,
): Promise<void> {
  await context.clock.race(Promise.resolve(work), context.signal)
}
