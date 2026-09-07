import { findMove } from '@/game/data/moves'
import { COMBO_DEFS } from '@/game/ext/combo'
import { upsertStatus, type BattleEvent, type BattleState, type FieldState } from '@/game/battle/reducer'

/** Apply only the field change revealed by this event, never a later turn snapshot. */
export function projectEventField(battle: BattleState, event: BattleEvent): FieldState {
  const field = battle.field
  if (event.type === 'statusApplied') {
    if (event.effectKind === 'terrain' && event.terrainId) {
      return { ...field, terrainEffects: { ...field.terrainEffects, current: [event.terrainId] } }
    }
    if (event.effectKind !== 'buff') return field
    const actor = battle[event.side].members[event.index]
    const move = actor?.moves.find(candidate => candidate.id === event.moveId)
      ?? (actor?.move.id === event.moveId ? actor.move : findMove(event.moveId))
    const effect = move?.effect
    if (effect?.kind !== 'buff' || !effect.stat || !effect.mult) return field
    const key = event.side === 'player' ? 'teamStatuses' : 'enemyStatuses'
    const previous = field[key].find(status => status.stat === effect.stat)
    // Status moves refresh duration exactly; unlike combo casts, a shorter cast can shorten it.
    const statuses = previous
      ? field[key].map(status => status === previous
        ? { ...status, mult: Math.max(status.mult, effect.mult!), remaining: event.remaining }
        : status)
      : [...field[key], { stat: effect.stat, mult: effect.mult, remaining: event.remaining, source: event.moveId, label: event.label }]
    return { ...field, [key]: statuses }
  }
  if (event.type === 'wildAccident' && event.kind === 'terrainShift' && event.terrainId) {
    return { ...field, terrainEffects: { ...field.terrainEffects, current: [event.terrainId] } }
  }
  if (event.type !== 'comboCast') return field

  const cast = COMBO_DEFS.find(definition => definition.id === event.key)?.cast
  let next = field
  if (cast?.kind === 'infuseTerrain' && event.castKind === cast.kind) {
    next = { ...field, terrainEffects: { ...field.terrainEffects, current: [cast.terrainId] } }
  } else if (cast && cast.kind !== 'infuseTerrain' && event.castKind === cast.kind) {
    const key = cast.kind === 'teamBuff' ? 'teamStatuses' : 'enemyStatuses'
    next = { ...field, [key]: upsertStatus(field[key], {
      stat: cast.stat, mult: cast.mult, remaining: event.remaining, source: -1, label: event.name,
    }) }
  }
  const mark = { key: event.key, label: event.label, icon: event.icon, remaining: event.remaining }
  return {
    ...next,
    comboCastEffects: field.comboCastEffects.some(existing => existing.key === event.key)
      ? field.comboCastEffects.map(existing => existing.key === event.key ? mark : existing)
      : [...field.comboCastEffects, mark],
  }
}
