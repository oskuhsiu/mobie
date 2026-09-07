import { resolveMoveRecipe } from './moveRecipe'
import type { BattleEvent } from '@/game/battle/reducer'
import type {
  BattleCue,
  DamageCue,
  IntentionalNoopCue,
  LegacyBattleCue,
  TurnPresentationJob,
} from './contracts'

const NORMAL_ATTACK_TIMING = {
  windupMs: 160,
  resultMs: 640,
  clearMs: 140,
} as const

const LEGACY_DAMAGE_TIMING = {
  windupMs: 440,
  resultMs: 820,
  clearMs: 140,
} as const

function assertNever(value: never): never {
  throw new Error(`Unhandled battle presentation variant: ${JSON.stringify(value)}`)
}

function legacyCue(
  before: TurnPresentationJob['before'],
  event: LegacyBattleCue['event'],
  eventIndex: number,
): LegacyBattleCue {
  return { kind: 'legacy-event', id: `event:${eventIndex}:${event.type}`, eventIndex, before, event }
}

function noopCue(
  event: Extract<BattleEvent, { type: 'random' }>,
  eventIndex: number,
): IntentionalNoopCue {
  return { kind: 'intentional-noop', id: `event:${eventIndex}:random:${event.event.type}`, eventIndex, event }
}

function compileRandom(
  before: TurnPresentationJob['before'],
  event: Extract<BattleEvent, { type: 'random' }>,
  eventIndex: number,
): BattleCue {
  switch (event.event.type) {
    case 'supportRoulette':
      return legacyCue(before, {
        ...event,
        event: { ...event.event, type: 'supportRoulette' },
      }, eventIndex)
    case 'accuracy': return noopCue(event, eventIndex)
    case 'crit': return noopCue(event, eventIndex)
    case 'ballRoulette': return noopCue(event, eventIndex)
    default: return assertNever(event.event.type)
  }
}

function compileWild(
  before: TurnPresentationJob['before'],
  event: Extract<BattleEvent, { type: 'wildAccident' }>,
  eventIndex: number,
): LegacyBattleCue {
  switch (event.kind) {
    case 'terrainShift': return legacyCue(before, event, eventIndex)
    case 'intrusion': return legacyCue(before, event, eventIndex)
    default: return assertNever(event.kind)
  }
}

function compileStatus(
  before: TurnPresentationJob['before'],
  event: Extract<BattleEvent, { type: 'statusApplied' }>,
  eventIndex: number,
): LegacyBattleCue {
  switch (event.effectKind) {
    case 'buff': return legacyCue(before, event, eventIndex)
    case 'heal': return legacyCue(before, event, eventIndex)
    case 'terrain': return legacyCue(before, event, eventIndex)
    default: return assertNever(event.effectKind)
  }
}

function compileCombo(
  before: TurnPresentationJob['before'],
  event: Extract<BattleEvent, { type: 'comboCast' }>,
  eventIndex: number,
): LegacyBattleCue {
  switch (event.castKind) {
    case 'infuseTerrain': return legacyCue(before, event, eventIndex)
    case 'teamBuff': return legacyCue(before, event, eventIndex)
    case 'enemyDebuff': return legacyCue(before, event, eventIndex)
    default: return assertNever(event.castKind)
  }
}

function compileDamage(job: TurnPresentationJob, event: Extract<BattleEvent, { type: 'damageApplied' }>, eventIndex: number): DamageCue {
  const attacker = job.before[event.attackerSide].members[event.attackerIndex]
  const defender = job.before[event.targetSide].members[event.targetIndex]
  if (!attacker || !defender) throw new Error(`Invalid damageApplied unit reference at event ${eventIndex}`)
  const move = event.resolvedMoveId == null
    ? attacker.move
    : attacker.moves.find((candidate) => candidate.id === event.resolvedMoveId) ?? attacker.move
  const normalAttack = event.attackerSide === 'foe'
    || (
      job.input.type === 'ATTACK'
      && job.input.starStrike !== true
      && event.attackerIndex === job.before.player.activeIndex
    )
  return {
    kind: 'damage', id: `event:${eventIndex}:damageApplied`, eventIndex, event,
    attacker, defender, attackerSide: event.attackerSide, defenderSide: event.targetSide,
    move, normalAttack,
    tracerRecipe: move.category === 'physical' ? 'physical' : 'electric',
    presentation: resolveMoveRecipe(move, { ...event,
      star: job.input.type === 'ATTACK' && job.input.starStrike === true && event.attackerSide === 'player',
    }),
    timing: normalAttack ? NORMAL_ATTACK_TIMING : LEGACY_DAMAGE_TIMING,
  }
}

function compileEvent(job: TurnPresentationJob, event: BattleEvent, eventIndex: number): BattleCue {
  switch (event.type) {
    case 'damageApplied': return compileDamage(job, event, eventIndex)
    case 'memberFainted': return legacyCue(job.before, event, eventIndex)
    case 'heal': return legacyCue(job.before, event, eventIndex)
    case 'activeChanged': return legacyCue(job.before, event, eventIndex)
    case 'switchDefenseResolved': return legacyCue(job.before, event, eventIndex)
    case 'battleEnded': return {
      kind: 'battle-outcome', id: `event:${eventIndex}:battleEnded`, eventIndex, event,
    }
    case 'random': return compileRandom(job.before, event, eventIndex)
    case 'chainOpportunity': return legacyCue(job.before, event, eventIndex)
    case 'chainHit': return legacyCue(job.before, event, eventIndex)
    case 'comboCast': return compileCombo(job.before, event, eventIndex)
    case 'wildAccident': return compileWild(job.before, event, eventIndex)
    case 'statusApplied': return compileStatus(job.before, event, eventIndex)
    default: return assertNever(event)
  }
}

function inputPrelude(job: TurnPresentationJob): readonly BattleCue[] {
  switch (job.input.type) {
    case 'ATTACK': return job.input.starStrike
      ? [{ kind: 'star-prelude', id: 'input:star-prelude' }]
      : []
    case 'SWITCH': return []
    case 'CHAIN': return [{ kind: 'chain-prelude', id: 'input:chain-prelude', timingMs: 420 }]
    default: return assertNever(job.input)
  }
}

function inputCleanup(job: TurnPresentationJob): readonly BattleCue[] {
  switch (job.input.type) {
    case 'ATTACK': return []
    case 'SWITCH': return []
    case 'CHAIN': return [{ kind: 'chain-cleanup', id: 'input:chain-cleanup', timingMs: 180 }]
    default: return assertNever(job.input)
  }
}

export function compileBattleCues(job: TurnPresentationJob): readonly BattleCue[] {
  const outcomeCount = job.events.filter((event) => event.type === 'battleEnded').length
  if (outcomeCount > 1) throw new Error('A turn may contain at most one battleEnded event')
  return [
    ...inputPrelude(job),
    ...job.events.map((event, eventIndex) => compileEvent(job, event, eventIndex)),
    ...inputCleanup(job),
  ]
}
