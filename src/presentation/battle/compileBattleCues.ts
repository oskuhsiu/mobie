import type { BattleEvent } from '@/game/battle/reducer'
import type { BattleCue, LegacyEventCue, NormalAttackCue, TurnPresentationJob } from './contracts'

const NORMAL_ATTACK_TIMING = {
  windupMs: 440,
  resultMs: 820,
  clearMs: 140,
} as const

function assertNever(value: never): never {
  throw new Error(`Unhandled battle event: ${JSON.stringify(value)}`)
}

type NonDamageEvent = Exclude<BattleEvent, { type: 'damageApplied' }>

function legacyCue(
  before: TurnPresentationJob['before'],
  event: NonDamageEvent,
  eventIndex: number,
): LegacyEventCue {
  return {
    kind: 'legacy-event',
    id: `event:${eventIndex}:${event.type}`,
    eventIndex,
    before,
    event,
  } as LegacyEventCue
}

function compileEvent(job: TurnPresentationJob, event: BattleEvent, eventIndex: number): BattleCue {
  switch (event.type) {
    case 'damageApplied': {
      const attacker = job.before[event.attackerSide].members[event.attackerIndex]
      const defender = job.before[event.targetSide].members[event.targetIndex]
      if (!attacker || !defender) throw new Error(`Invalid damageApplied unit reference at event ${eventIndex}`)
      const move = event.resolvedMoveId == null
        ? attacker.move
        : attacker.moves.find((candidate) => candidate.id === event.resolvedMoveId) ?? attacker.move
      const cue: NormalAttackCue = {
        kind: 'normal-attack',
        id: `event:${eventIndex}:damageApplied`,
        eventIndex,
        event,
        attacker,
        defender,
        attackerSide: event.attackerSide,
        defenderSide: event.targetSide,
        move,
        timing: NORMAL_ATTACK_TIMING,
      }
      return cue
    }
    case 'memberFainted': return legacyCue(job.before, event, eventIndex)
    case 'heal': return legacyCue(job.before, event, eventIndex)
    case 'activeChanged': return legacyCue(job.before, event, eventIndex)
    case 'switchDefenseResolved': return legacyCue(job.before, event, eventIndex)
    case 'battleEnded': return legacyCue(job.before, event, eventIndex)
    case 'random': return legacyCue(job.before, event, eventIndex)
    case 'chainOpportunity': return legacyCue(job.before, event, eventIndex)
    case 'chainHit': return legacyCue(job.before, event, eventIndex)
    case 'comboCast': return legacyCue(job.before, event, eventIndex)
    case 'wildAccident': return legacyCue(job.before, event, eventIndex)
    case 'statusApplied': return legacyCue(job.before, event, eventIndex)
    default: return assertNever(event)
  }
}

export function compileBattleCues(job: TurnPresentationJob): readonly BattleCue[] {
  if (job.input.type !== 'ATTACK' || (job.input as { starStrike?: boolean }).starStrike === true) {
    throw new Error('Ticket 02 compiler only accepts non-star ATTACK inputs')
  }
  return job.events.map((event, eventIndex) => compileEvent(job, event, eventIndex))
}
