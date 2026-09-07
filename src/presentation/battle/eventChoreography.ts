import type { BattleEventCue, CueContext, EventScenePort } from './contracts'

/** All event waits belong to the Director clock; apply is the sole projection safe point. */
export async function playEventChoreography(cue: BattleEventCue, context: CueContext, ports: EventScenePort): Promise<void> {
  const timing = eventTiming(cue)
  const wait = (ms: number) => context.clock.wait(ms, context.signal)
  try {
    ports.begin(cue, context)
    await wait(timing.prepare)
    if (!context.skipping) ports.cast(cue, context)
    await wait(timing.cast)
    ports.apply(cue, context)
    await wait(timing.hold)
  } finally {
    ports.clear(cue, context)
  }
}

function eventTiming({ event: e }: BattleEventCue): { prepare: number; cast: number; hold: number } {
  switch (e.type) {
    case 'memberFainted': return { prepare: 180, cast: 0, hold: 620 }
    case 'heal': return { prepare: 0, cast: 80, hold: 640 }
    case 'statusApplied': return { prepare: 240, cast: 300, hold: 640 }
    case 'wildAccident': return { prepare: 0, cast: e.kind === 'terrainShift' ? 350 : 180, hold: 550 }
    case 'activeChanged': return { prepare: e.forced ? 180 : 300, cast: 0, hold: 520 }
    case 'switchDefenseResolved': return { prepare: 0, cast: 0, hold: 640 }
    case 'random': return { prepare: 350, cast: 350, hold: 600 }
    case 'chainOpportunity': return { prepare: 0, cast: 0, hold: 500 }
    case 'chainHit': return { prepare: 0, cast: 180, hold: 0 }
    case 'comboCast': return { prepare: 100, cast: 300, hold: 480 }
    default: return assertNever(e)
  }
}
function assertNever(value: never): never { throw new Error(`Unhandled choreography event: ${JSON.stringify(value)}`) }
