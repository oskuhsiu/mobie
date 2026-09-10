import type {
  BattleEvent,
  ComboCastMark,
  Side,
  StatusEffect,
} from '@/game/battle/reducer'
import { findMove } from '@/game/data/moves'
import { COMBO_DEFS } from '@/game/ext/combo'
import type { ReplayLog, DisplayUnitSnapshot } from './types'
import { eventToReportLine, makeReportCtx } from './report'

/** A replay event with its stable turn/event position and text projections. */
export interface ReplayStep {
  stepIndex: number
  turnIndex: number
  eventIndex: number
  event: BattleEvent
  reportLine: string | null
  feedLine: string
}

export interface ReplayUnitProjection {
  snapshot: DisplayUnitSnapshot
  hp: number
  fainted: boolean
}

export interface ReplayFieldProjection {
  /** Unknown ids remain strings so a damaged/forward event can be named honestly. */
  terrainIds: string[]
  terrainKnown: boolean
  teamStatuses: StatusEffect[]
  enemyStatuses: StatusEffect[]
  comboCastEffects: ComboCastMark[]
  chainCount: number | null
  chainMax: number | null
  chainEligibleIndices: number[]
}

export interface ReplayProjection {
  cursor: number
  currentTurn: number | null
  units: Map<string, ReplayUnitProjection>
  active: Record<Side, number | null>
  field: ReplayFieldProjection
  outcome: Side | null
  outcomeReason: 'timeout' | null
  degraded: string[]
}

function firstSlot(snapshot: DisplayUnitSnapshot[], side: Side): number | null {
  const first = snapshot
    .filter((unit) => unit.side === side)
    .sort((a, b) => a.slot - b.slot)[0]
  return first?.slot ?? null
}

function textFromEvent(event: BattleEvent): string {
  switch (event.type) {
    case 'random':
      return `隨機判定：${event.event.type}（${event.event.outcome}）`
    default:
      return `事件：${event.type}`
  }
}

/** Flatten the canonical event stream without changing event order. */
export function flattenReplay(log: ReplayLog): ReplayStep[] {
  const ctx = makeReportCtx(log.header.snapshot)
  const steps: ReplayStep[] = []
  log.turns.forEach((turn, turnIndex) => {
    turn.events.forEach((event, eventIndex) => {
      const reportLine = eventToReportLine(event, ctx)
      steps.push({
        stepIndex: steps.length,
        turnIndex,
        eventIndex,
        event,
        reportLine,
        feedLine: reportLine ?? textFromEvent(event),
      })
    })
  })
  return steps
}

/** Keep cursor operations total and bounded even when a stale control races a remount. */
export function clampReplayCursor(cursor: number, eventCount: number): number {
  if (!Number.isFinite(cursor)) return 0
  return Math.min(eventCount, Math.max(0, Math.trunc(cursor)))
}

function initialTerrainState(value: unknown): { ids: string[]; known: boolean } {
  if (Array.isArray(value)) {
    return { ids: value.filter((id): id is string => typeof id === 'string'), known: true }
  }
  if (!value || typeof value !== 'object') return { ids: [], known: false }
  const state = value as Record<string, unknown>
  if (Array.isArray(state.terrainIds)) {
    return { ids: state.terrainIds.filter((id): id is string => typeof id === 'string'), known: true }
  }
  const terrainEffects = state.terrainEffects
  if (terrainEffects && typeof terrainEffects === 'object') {
    const current = (terrainEffects as Record<string, unknown>).current
    if (Array.isArray(current)) {
      return { ids: current.filter((id): id is string => typeof id === 'string'), known: true }
    }
  }
  return { ids: [], known: false }
}

function initialField(log: ReplayLog): ReplayFieldProjection {
  const terrain = initialTerrainState(log.header.initialFieldState)
  return {
    terrainIds: terrain.ids,
    terrainKnown: terrain.known,
    teamStatuses: [],
    enemyStatuses: [],
    comboCastEffects: [],
    chainCount: null,
    chainMax: null,
    chainEligibleIndices: [],
  }
}

function markCombo(field: ReplayFieldProjection, mark: ComboCastMark): void {
  const index = field.comboCastEffects.findIndex((existing) => existing.key === mark.key)
  if (index < 0) field.comboCastEffects = [...field.comboCastEffects, mark]
  else field.comboCastEffects = field.comboCastEffects.map((existing, i) => i === index ? mark : existing)
}

function tickRemaining<T extends { remaining: number }>(items: readonly T[]): T[] {
  return items
    .map((item) => ({ ...item, remaining: item.remaining - 1 }))
    .filter((item) => item.remaining > 0)
}

/** Reducer ticks temporary statuses after every resolved turn, including a turn that ends the battle. */
function tickField(field: ReplayFieldProjection): void {
  field.teamStatuses = tickRemaining(field.teamStatuses)
  field.enemyStatuses = tickRemaining(field.enemyStatuses)
  field.comboCastEffects = tickRemaining(field.comboCastEffects)
}

function setHp(
  units: Map<string, ReplayUnitProjection>,
  side: Side,
  index: number,
  hp: number,
  degraded: string[],
): void {
  const unit = units.get(`${side}:${index}`)
  if (!unit) {
    degraded.push(`找不到 ${side === 'player' ? '我方' : '對手'} 第 ${index + 1} 隻 Mobie 的快照`)
    return
  }
  const nextHp = Math.min(unit.snapshot.maxHp, Math.max(0, Number.isFinite(hp) ? hp : 0))
  unit.hp = nextHp
  unit.fainted = nextHp <= 0
}

function applyEvent(
  event: BattleEvent,
  units: Map<string, ReplayUnitProjection>,
  active: Record<Side, number | null>,
  field: ReplayFieldProjection,
  degraded: string[],
): { outcome: Side | null; outcomeReason: 'timeout' | null } {
  let outcome: Side | null = null
  let outcomeReason: 'timeout' | null = null
  switch (event.type) {
    case 'damageApplied':
      if (!event.missed) setHp(units, event.targetSide, event.targetIndex, event.hpAfter, degraded)
      break
    case 'heal':
      setHp(units, event.side, event.index, event.hpAfter, degraded)
      break
    case 'statusApplied': {
      if (event.effectKind === 'heal') {
        if (event.hpAfter !== undefined) setHp(units, event.side, event.index, event.hpAfter, degraded)
        else degraded.push('回血事件缺少 hpAfter，HP 顯示可能不完整')
        break
      }
      if (event.effectKind === 'terrain') {
        if (event.terrainId) {
          field.terrainIds = [event.terrainId]
          field.terrainKnown = true
        } else degraded.push('地形事件缺少地形 id')
        break
      }
      if (event.effectKind !== 'buff') break
      const effect = findMove(event.moveId)?.effect
      if (!effect || effect.kind !== 'buff' || !effect.stat || !effect.mult) {
        degraded.push(`變化招 ${event.moveId} 的增益資料未記錄`)
        break
      }
      const status: StatusEffect = {
        stat: effect.stat,
        mult: effect.mult,
        remaining: Math.max(0, event.remaining),
        source: event.moveId,
        label: event.label,
      }
      const statuses = event.side === 'player' ? field.teamStatuses : field.enemyStatuses
      const index = statuses.findIndex((candidate) => candidate.stat === status.stat)
      const merged = index < 0
        ? [...statuses, status]
        : statuses.map((candidate, i) => i === index
          ? { ...candidate, mult: Math.max(candidate.mult, status.mult), remaining: status.remaining, source: status.source, label: status.label }
          : candidate)
      if (event.side === 'player') field.teamStatuses = merged
      else field.enemyStatuses = merged
      break
    }
    case 'wildAccident':
      if (event.kind === 'terrainShift') {
        if (event.terrainId) {
          field.terrainIds = [event.terrainId]
          field.terrainKnown = true
        } else degraded.push('野外地形突變缺少地形 id')
      } else if (event.side !== undefined && event.index !== undefined && event.hpAfter !== undefined) {
        setHp(units, event.side, event.index, event.hpAfter, degraded)
      } else {
        degraded.push('亂入事件缺少受擊方或 hpAfter，HP 顯示可能不完整')
      }
      break
    case 'memberFainted':
      setHp(units, event.side, event.index, 0, degraded)
      break
    case 'activeChanged':
      active[event.side] = event.toIndex
      if (!units.has(`${event.side}:${event.toIndex}`)) {
        degraded.push(`換人事件指向未記錄的 ${event.side}:${event.toIndex}`)
      }
      break
    case 'chainOpportunity':
      field.chainMax = event.maxHits
      field.chainEligibleIndices = [...event.eligibleIndices]
      field.chainCount = 0
      break
    case 'chainHit':
      field.chainCount = event.comboCount
      break
    case 'comboCast': {
      const definition = COMBO_DEFS.find((candidate) => candidate.id === event.key)
      if (definition?.cast.kind === 'infuseTerrain') {
        field.terrainIds = [definition.cast.terrainId]
        field.terrainKnown = true
      } else if (definition?.cast.kind === 'teamBuff' || definition?.cast.kind === 'enemyDebuff') {
        const status: StatusEffect = {
          stat: definition.cast.stat,
          mult: definition.cast.mult,
          remaining: Math.max(0, event.remaining),
          source: -1,
          label: event.name,
        }
        const statuses = definition.cast.kind === 'teamBuff' ? field.teamStatuses : field.enemyStatuses
        const index = statuses.findIndex((candidate) => candidate.stat === status.stat)
        const next = index < 0
          ? [...statuses, status]
          : statuses.map((candidate, i) => i === index ? { ...candidate, ...status, mult: Math.max(candidate.mult, status.mult) } : candidate)
        if (definition.cast.kind === 'teamBuff') field.teamStatuses = next
        else field.enemyStatuses = next
      } else {
        degraded.push(`合體技 ${event.key} 的效果資料未記錄`)
      }
      markCombo(field, { key: event.key, label: event.label, icon: event.icon, remaining: Math.max(0, event.remaining) })
      break
    }
    case 'battleEnded':
      outcome = event.winner
      outcomeReason = event.reason ?? null
      break
    default:
      break
  }
  return { outcome, outcomeReason }
}

/**
 * Fold only the decoded event prefix into a display projection.
 * This function intentionally imports no battle store/resolver/RNG and never mutates canonical data.
 */
export function projectReplay(log: ReplayLog, cursor: number): ReplayProjection {
  const steps = flattenReplay(log)
  const boundedCursor = clampReplayCursor(cursor, steps.length)
  const units = new Map<string, ReplayUnitProjection>()
  for (const snapshot of log.header.snapshot) {
    units.set(snapshot.instanceId, {
      snapshot,
      hp: Math.max(0, Math.min(snapshot.maxHp, snapshot.initialHp)),
      fainted: snapshot.initialHp <= 0,
    })
  }
  const active: Record<Side, number | null> = {
    player: firstSlot(log.header.snapshot, 'player'),
    foe: firstSlot(log.header.snapshot, 'foe'),
  }
  const field = initialField(log)
  const degraded = field.terrainKnown ? [] : ['開場地形未記錄；只顯示回放事件中揭露的地形']
  let outcome: Side | null = null
  let outcomeReason: 'timeout' | null = null
  let consumed = 0
  const hasReplayProgress = boundedCursor > 0
  const completeReplay = hasReplayProgress && boundedCursor === steps.length
  for (const turn of log.turns) {
    const turnEnd = consumed + turn.events.length
    for (const event of turn.events) {
      if (consumed >= boundedCursor) break
      const result = applyEvent(event, units, active, field, degraded)
      if (result.outcome) {
        outcome = result.outcome
        outcomeReason = result.outcomeReason
      }
      consumed += 1
    }
    // If the cursor includes this turn's complete event list, mirror the
    // reducer's end-of-turn expiry before folding the next turn.
    const turnIncluded = turn.events.length > 0
      ? consumed >= turnEnd
      : boundedCursor > consumed || completeReplay
    if (turnIncluded) tickField(field)
    if (consumed >= boundedCursor) break
  }
  return {
    cursor: boundedCursor,
    currentTurn: boundedCursor > 0 ? steps[boundedCursor - 1].turnIndex : null,
    units,
    active,
    field,
    outcome,
    outcomeReason,
    degraded: [...new Set(degraded)],
  }
}
