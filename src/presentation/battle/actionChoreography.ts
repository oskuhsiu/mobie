import type {
  BattleActionPort,
  BattleOutcomeCue,
  ChainCleanupCue,
  ChainPreludeCue,
  CueContext,
  StarPreludeCue,
} from './contracts'
import { invokePresentationPort } from './presentationPort'

/** Timings for the single star-strike presentation transaction. */
export const STAR_CHOREOGRAPHY_TIMING = {
  chargeMs: 720,
  stampMs: 120,
} as const

/** The result cue stays readable before the coordinator commits the handoff. */
export const OUTCOME_HOLD_MS = 1800

/**
 * Action timing belongs to the presentation director. The screen ports only
 * apply the visual/audio state at each named safe point.
 */
export async function playStarChoreography(
  cue: StarPreludeCue,
  context: CueContext,
  ports: BattleActionPort,
): Promise<void> {
  await invokePresentationPort(ports.starPrelude(cue, context), context)
  if (context.skipping) return
  await context.clock.wait(STAR_CHOREOGRAPHY_TIMING.chargeMs, context.signal)
  if (context.skipping) return
  await invokePresentationPort(ports.starStamp(cue, context), context)
  if (context.skipping) return
  await context.clock.wait(STAR_CHOREOGRAPHY_TIMING.stampMs, context.signal)
  if (context.skipping) return
  await invokePresentationPort(ports.starImpact(cue, context), context)
}

export async function playChainPrelude(
  cue: ChainPreludeCue,
  context: CueContext,
  ports: BattleActionPort,
): Promise<void> {
  await invokePresentationPort(ports.chainPrelude(cue, context), context)
  if (!context.skipping) await context.clock.wait(cue.timingMs, context.signal)
}

export async function playChainCleanup(
  cue: ChainCleanupCue,
  context: CueContext,
  ports: BattleActionPort,
): Promise<void> {
  if (!context.skipping) await context.clock.wait(cue.timingMs, context.signal)
  await invokePresentationPort(ports.chainCleanup(cue, context), context)
}

export async function playOutcome(
  cue: BattleOutcomeCue,
  context: CueContext,
  ports: BattleActionPort,
): Promise<void> {
  await invokePresentationPort(ports.outcome(cue, context), context)
  if (!context.skipping) await context.clock.wait(OUTCOME_HOLD_MS, context.signal)
}
