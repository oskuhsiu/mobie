import type { OwnedUnit } from '@/game/types'
import { applyExp, expYield, type ExpResult } from '@/game/growth'
import { effectiveLearnedMoves, newlyLearned } from '@/game/learnset'
import { getSpecies } from '@/game/data/species'
import { PRODUCT_RUNTIME } from '@/game/ext/productRuntime'
import { addRegistered, bumpStat, type MetaState } from '@/game/meta'

/**
 * Result settlement is keyed by the logical battle, not by a React mount or a
 * presentation attempt.  The fingerprint is deliberately independent from
 * the reward payload: it detects a reused id with a different battle token.
 */
export interface ResultIdentity {
  resultId: string
  resultFingerprint: string
}

export type ResultSettlementErrorCode = 'collision' | 'storage' | 'receipt'

export class ResultSettlementError extends Error {
  readonly code: ResultSettlementErrorCode
  readonly identity: ResultIdentity

  constructor(code: ResultSettlementErrorCode, identity: ResultIdentity, message: string, cause?: unknown) {
    super(message)
    this.name = 'ResultSettlementError'
    this.code = code
    this.identity = identity
    if (cause !== undefined) this.cause = cause
  }
}

export type ResultMarkerStatus = 'pending' | 'settled'

/** Bounded retention is shared by Result, claim, and hatch destinations. */
export const RESULT_MARKER_LIMIT = 128
export const RESULT_SETTLEMENT_SCHEMA_VERSION = 1
export const RESULT_SETTLEMENT_JOURNAL_KEY = 'mobie.result.settlement.v1'
export const ROSTER_GROWTH_MARKER_KEY = 'mobie.roster.growth.v1'
export const SKILL_POINTS_SETTLEMENT_MARKER_KEY = 'mobie.skillpoints.settlement.v1'
export const META_SETTLEMENT_MARKER_KEY = 'mobie.meta.settlement.v1'

export type ResultOutcome = 'win' | 'lose'

/** Account-level SP reward forwarded by Result. The canonical wallet is owned by the SP child. */
export interface SkillPointsSettlementPayload {
  delta: number
}

/** Existing Result meta progression forwarded by Result. Capture/Dex writes remain Ticket 32. */
export interface MetaSettlementPayload {
  winMode?: 'arena' | 'wild'
  evolutions?: Array<{ toSpecies: number }>
}

export interface RosterGrowthPayload {
  unitIds: string[]
  foeLevels: number[]
  ratio: number
  /** Kept beside (and independent from) the identity pair for future destinations. */
  outcome?: ResultOutcome
}

/** Complete Result payload forwarded to the independent child destinations. */
export interface ResultSettlementPayload extends RosterGrowthPayload {
  skillPoints?: SkillPointsSettlementPayload
  meta?: MetaSettlementPayload
}

export interface MoveLearnReceipt {
  unitId: string
  moveIds: number[]
}

export interface RosterGrowthReceipt extends ResultIdentity {
  status: 'applied' | 'already-applied'
  results: ExpResult[]
  evolutions: EvolutionReceipt[]
  moveLearns: MoveLearnReceipt[]
  appliedAt: number
}

export interface SkillPointsSettlementReceipt extends ResultIdentity {
  status: 'applied' | 'already-applied'
  delta: number
  before: number
  after: number
  appliedAt: number
}

export interface MetaSettlementReceipt extends ResultIdentity {
  status: 'applied' | 'already-applied'
  meta: MetaState
  winMode?: 'arena' | 'wild'
  evolutionCount: number
  appliedAt: number
}

export interface ResultSettlementReceipt extends RosterGrowthReceipt {
  skillPoints?: SkillPointsSettlementReceipt
  meta?: MetaSettlementReceipt
}

export interface EvolutionReceipt {
  unitId: string
  fromSpecies: number
  toSpecies: number
  atLevel: number
}

/**
 * Destination marker.  `updates` is the exact canonical subset changed by the
 * operation, which lets a pending write reconcile without replacing later
 * unrelated roster changes.
 */
export interface RosterGrowthMarker extends ResultIdentity {
  destination: 'roster-growth'
  status: ResultMarkerStatus
  createdAt: number
  settledAt?: number
  leftResultAt?: number
  outcome?: ResultOutcome
  /** Canonical subset before the operation, retained for late retry reconciliation. */
  before?: OwnedUnit[]
  updates: OwnedUnit[]
  receipt: Omit<RosterGrowthReceipt, 'status'>
}

export interface SkillPointsSettlementMarker extends ResultIdentity {
  destination: 'skill-points'
  status: ResultMarkerStatus
  createdAt: number
  settledAt?: number
  leftResultAt?: number
  /** The canonical wallet write completed inside the child boundary. */
  canonicalApplied?: boolean
  delta: number
  before: number
  after: number
  receipt: Omit<SkillPointsSettlementReceipt, 'status'>
}

export interface MetaSettlementMarker extends ResultIdentity {
  destination: 'meta'
  status: ResultMarkerStatus
  createdAt: number
  settledAt?: number
  leftResultAt?: number
  /** The canonical Meta write completed inside the child boundary. */
  canonicalApplied?: boolean
  before: MetaState
  after: MetaState
  payload: MetaSettlementPayload
  receipt: Omit<MetaSettlementReceipt, 'status'>
}

export interface SettlementJournalEntry extends ResultIdentity {
  status: ResultMarkerStatus
  createdAt: number
  settledAt?: number
  leftResultAt?: number
  outcome?: ResultOutcome
  rosterGrowth?: RosterGrowthReceipt
  skillPoints?: SkillPointsSettlementReceipt
  meta?: MetaSettlementReceipt
  error?: string
}

export interface RosterGrowthPersistence {
  loadRoster: () => Promise<OwnedUnit[]>
  /** Must reject a failed canonical write; swallowing quota errors is unsafe here. */
  saveRoster: (units: OwnedUnit[]) => Promise<void>
  loadMarkers: () => Promise<RosterGrowthMarker[]>
  /** Durable write-ahead step: pending marker + canonical roster. */
  savePending: (roster: OwnedUnit[], markers: RosterGrowthMarker[]) => Promise<void>
  /** Final marker step after the canonical roster write has succeeded. */
  saveMarkers: (markers: RosterGrowthMarker[]) => Promise<void>
}

export interface SkillPointsPersistence {
  loadPoints: () => Promise<number>
  /** Must reject a failed canonical write; swallowing quota errors is unsafe here. */
  savePoints: (points: number) => Promise<void>
  loadMarkers: () => Promise<SkillPointsSettlementMarker[]>
  /** Durable write-ahead step: pending marker + canonical wallet. */
  savePending: (points: number, markers: SkillPointsSettlementMarker[], operationId?: string) => Promise<void>
  /** Final marker step after the canonical wallet write has succeeded. */
  saveMarkers: (markers: SkillPointsSettlementMarker[]) => Promise<void>
}

export interface MetaSettlementPersistence {
  loadMeta: () => Promise<MetaState>
  /** Must reject a failed canonical write; swallowing quota errors is unsafe here. */
  saveMeta: (meta: MetaState) => Promise<void>
  loadMarkers: () => Promise<MetaSettlementMarker[]>
  /** Durable write-ahead step: pending marker + canonical meta. */
  savePending: (meta: MetaState, markers: MetaSettlementMarker[], operationId?: string) => Promise<void>
  /** Final marker step after the canonical meta write has succeeded. */
  saveMarkers: (markers: MetaSettlementMarker[]) => Promise<void>
}

export interface ResultSettlementChildren {
  skillPoints?: SkillPointsDestination
  meta?: MetaSettlementDestination
}

export interface SettlementJournalPersistence {
  load: () => Promise<SettlementJournalEntry[]>
  save: (entries: SettlementJournalEntry[]) => Promise<void>
}

export interface ResultStorage {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

export type ResultIdentityClassification = 'new' | 'same-result' | 'collision'

export function classifyResultIdentity(
  existing: ResultIdentity | null | undefined,
  incoming: ResultIdentity,
): ResultIdentityClassification {
  if (!existing || existing.resultId !== incoming.resultId) return 'new'
  return existing.resultFingerprint === incoming.resultFingerprint ? 'same-result' : 'collision'
}

function sameIdentity(left: ResultIdentity | null | undefined, right: ResultIdentity | null | undefined): boolean {
  return Boolean(left && right && classifyResultIdentity(left, right) === 'same-result')
}

function markerTimestamp(marker: { settledAt?: number; createdAt: number }): number {
  return marker.settledAt ?? marker.createdAt
}

/**
 * Keep every current/unsettled marker and only prune durable settled markers
 * that were explicitly left behind.  The current result is protected even if
 * it has already settled, because the player may still be viewing it.
 */
export function retainResultMarkers<T extends ResultIdentity & {
  status: ResultMarkerStatus
  createdAt: number
  settledAt?: number
  leftResultAt?: number
}>(markers: readonly T[], current: ResultIdentity | null = null): T[] {
  const protectedMarkers = markers.filter((marker) => (
    marker.status !== 'settled'
    || marker.leftResultAt === undefined
    || sameIdentity(marker, current)
  ))
  const eligible = markers
    .filter((marker) => (
      marker.status === 'settled'
      && marker.leftResultAt !== undefined
      && !sameIdentity(marker, current)
    ))
    .sort((left, right) => markerTimestamp(right) - markerTimestamp(left))
    .slice(0, RESULT_MARKER_LIMIT)

  // Preserve insertion order for the protected entries; consumers use the
  // timestamps above when they need recency.
  const kept = new Set([...protectedMarkers, ...eligible])
  return markers.filter((marker) => kept.has(marker))
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function sameUnit(left: OwnedUnit | undefined, right: OwnedUnit): boolean {
  return Boolean(left && stableJson(left) === stableJson(right))
}

function mergeGrowthUnit(current: OwnedUnit, update: OwnedUnit): OwnedUnit {
  const learnedMoveIds = [...new Set([
    ...(current.learnedMoveIds ?? []),
    ...(update.learnedMoveIds ?? []),
  ])]
  return {
    ...update,
    // These fields are not touched by EXP/evolution. Preserve a later item or
    // individual edit if a pending settlement resumes after that edit.
    ivs: current.ivs,
    nature: current.nature,
    seed: current.seed,
    shiny: current.shiny,
    ...(current.heldItemId === undefined
      ? (update.heldItemId === undefined ? {} : { heldItemId: update.heldItemId })
      : { heldItemId: current.heldItemId }),
    ...(learnedMoveIds.length > 0 ? { learnedMoveIds } : {}),
    ...(current.equippedMoveIds === undefined && update.equippedMoveIds === undefined
      ? {}
      : { equippedMoveIds: current.equippedMoveIds ?? update.equippedMoveIds }),
  }
}

function mergeUpdates(roster: readonly OwnedUnit[], updates: readonly OwnedUnit[]): OwnedUnit[] {
  const byId = new Map(updates.map((unit) => [unit.id, unit]))
  return roster.map((unit) => {
    const update = byId.get(unit.id)
    return update ? mergeGrowthUnit(unit, update) : unit
  })
}

function updatesApplied(roster: readonly OwnedUnit[], updates: readonly OwnedUnit[]): boolean {
  const byId = new Map(roster.map((unit) => [unit.id, unit]))
  return updates.every((update) => sameUnit(byId.get(update.id), update))
}

function updatesAreAtOrBeyond(
  roster: readonly OwnedUnit[],
  before: readonly OwnedUnit[] | undefined,
  updates: readonly OwnedUnit[],
): boolean {
  const currentById = new Map(roster.map((unit) => [unit.id, unit]))
  const beforeById = new Map((before ?? []).map((unit) => [unit.id, unit]))
  return updates.every((update) => {
    const current = currentById.get(update.id)
    const original = beforeById.get(update.id)
    if (!current || !original) return false
    const progressed = current.exp > original.exp
      || current.level > original.level
      || current.speciesId !== original.speciesId
    return progressed && current.exp >= update.exp && current.level >= update.level
  })
}

/** Pure roster reward/evolution calculation used by the destination. */
export function calculateRosterGrowth(
  roster: readonly OwnedUnit[],
  payload: RosterGrowthPayload,
): { roster: OwnedUnit[]; results: ExpResult[]; evolutions: EvolutionReceipt[]; moveLearns: MoveLearnReceipt[] } {
  const base = payload.foeLevels.reduce((sum, level) => sum + expYield(level), 0)
  const ratio = Number.isFinite(payload.ratio) ? Math.max(0, payload.ratio) : 0
  const gained = base > 0 ? Math.max(1, Math.floor(base * ratio)) : 0
  const ids = new Set(payload.unitIds)
  const results: ExpResult[] = []
  const evolutions: EvolutionReceipt[] = []
  const moveLearns: MoveLearnReceipt[] = []
  const nextRoster = roster.map((unit) => {
    if (!ids.has(unit.id)) return unit
    const growth = applyExp(unit, gained)
    let grown = PRODUCT_RUNTIME.applyPostGrowth(growth.unit)
    if (grown.speciesId !== growth.unit.speciesId) {
      evolutions.push({
        unitId: grown.id,
        fromSpecies: growth.unit.speciesId,
        toSpecies: grown.speciesId,
        atLevel: grown.level,
      })
    } else if (grown.level > growth.fromLevel) {
      const learned = newlyLearned(getSpecies(grown.speciesId), growth.fromLevel, grown.level)
      if (learned.length > 0) {
        moveLearns.push({ unitId: grown.id, moveIds: learned })
        const current = effectiveLearnedMoves(grown, getSpecies(grown.speciesId))
        grown = { ...grown, learnedMoveIds: [...new Set([...current, ...learned])] }
      }
    }
    results.push({ ...growth, unit: grown })
    return grown
  })
  return { roster: nextRoster, results, evolutions, moveLearns }
}

function makeReceipt(
  identity: ResultIdentity,
  calculated: Pick<RosterGrowthReceipt, 'results' | 'evolutions' | 'moveLearns'>,
  appliedAt: number,
  status: RosterGrowthReceipt['status'],
): RosterGrowthReceipt {
  return {
    ...identity,
    results: calculated.results,
    evolutions: calculated.evolutions,
    moveLearns: calculated.moveLearns,
    appliedAt,
    status,
  }
}

function markerFor(
  identity: ResultIdentity,
  receipt: RosterGrowthReceipt,
  before: OwnedUnit[],
  updates: OwnedUnit[],
  now: number,
  status: ResultMarkerStatus,
  outcome?: ResultOutcome,
  previous?: RosterGrowthMarker,
): RosterGrowthMarker {
  return {
    resultId: identity.resultId,
    resultFingerprint: identity.resultFingerprint,
    destination: 'roster-growth',
    status,
    createdAt: previous?.createdAt ?? now,
    ...(status === 'settled' ? { settledAt: previous?.settledAt ?? now } : {}),
    ...(previous?.leftResultAt === undefined ? {} : { leftResultAt: previous.leftResultAt }),
    ...((outcome ?? previous?.outcome) !== undefined
      ? { outcome: outcome ?? previous?.outcome }
      : {}),
    before: previous?.before ?? before,
    updates,
    receipt: {
      resultId: receipt.resultId,
      resultFingerprint: receipt.resultFingerprint,
      results: receipt.results,
      evolutions: receipt.evolutions,
      moveLearns: receipt.moveLearns,
      appliedAt: receipt.appliedAt,
    },
  }
}

function replaceMarker(markers: readonly RosterGrowthMarker[], marker: RosterGrowthMarker): RosterGrowthMarker[] {
  const index = markers.findIndex((item) => item.resultId === marker.resultId)
  const next = [...markers]
  if (index < 0) next.push(marker)
  else next[index] = marker
  return next
}

function collision(identity: ResultIdentity): never {
  throw new ResultSettlementError(
    'collision',
    identity,
    `結果識別碼碰撞：${identity.resultId} 已綁定不同的 fingerprint，請重新開始本場。`,
  )
}

/**
 * The roster/evolution child destination.  All calls are serialized outside
 * React, so StrictMode, remount, double-click, and late Promise completions
 * share one in-flight operation and one durable marker.
 */
export class RosterGrowthDestination {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly persistence: RosterGrowthPersistence,
    private readonly now: () => number = () => Date.now(),
  ) {}

  applyOnce(identity: ResultIdentity, payload: RosterGrowthPayload): Promise<RosterGrowthReceipt> {
    const run = this.queue.then(() => this.applySerialized(identity, payload))
    this.queue = run.catch(() => undefined)
    return run
  }

  hasApplied(identity: ResultIdentity): Promise<boolean> {
    const run = this.queue.then(async () => {
      try {
        const marker = (await this.persistence.loadMarkers()).find((item) => item.resultId === identity.resultId)
        if (!marker) return false
        if (marker.resultFingerprint !== identity.resultFingerprint) collision(identity)
        return marker.status === 'settled'
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, '讀取 Mobie 成長結算標記失敗，請重試。', error)
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  markResultLeft(identity: ResultIdentity): Promise<void> {
    const run = this.queue.then(async () => {
      try {
        const markers = await this.persistence.loadMarkers()
        const marker = markers.find((item) => item.resultId === identity.resultId)
        if (!marker) return
        if (marker.resultFingerprint !== identity.resultFingerprint) collision(identity)
        const next = replaceMarker(markers, { ...marker, leftResultAt: this.now() })
        await this.persistence.saveMarkers(retainResultMarkers(next))
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, '保存 Result 離場標記失敗，請重試。', error)
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async applySerialized(identity: ResultIdentity, payload: RosterGrowthPayload): Promise<RosterGrowthReceipt> {
    let markers: RosterGrowthMarker[]
    try {
      markers = await this.persistence.loadMarkers()
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '讀取 Result 結算標記失敗，請重試。', cause)
    }
    const existing = markers.find((item) => item.resultId === identity.resultId)
    if (existing && existing.resultFingerprint !== identity.resultFingerprint) collision(identity)

    if (existing?.status === 'settled') {
      return {
        ...existing.receipt,
        status: 'already-applied',
      }
    }

    let roster: OwnedUnit[]
    try {
      roster = await this.persistence.loadRoster()
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '讀取 canonical roster 失敗，請重試。', cause)
    }
    if (existing) {
      // A pending marker is a write-ahead record.  If the canonical units are
      // already present, only finalize the marker; this is the
      // canonical-write-success/receipt-failure recovery path.
      const updates = existing.updates ?? []
      const alreadyApplied = updatesApplied(roster, updates)
        || updatesAreAtOrBeyond(roster, existing.before, updates)
      if (!alreadyApplied) {
        const reconciled = mergeUpdates(roster, updates)
        try {
          await this.persistence.savePending(reconciled, markers)
        } catch (cause) {
          throw new ResultSettlementError('storage', identity, '恢復 Result 結算資料失敗，請重試。', cause)
        }
      }
      const settled = {
        ...existing,
        status: 'settled' as const,
        settledAt: existing.settledAt ?? this.now(),
      }
      try {
        // Settlement must not prune another marker. Retention runs only from
        // the explicit Result-leave boundary.
        await this.persistence.saveMarkers(replaceMarker(markers, settled))
      } catch (cause) {
        throw new ResultSettlementError('receipt', identity, 'Result 結算已寫入，但回條保存失敗；請重試以完成對帳。', cause)
      }
      return { ...existing.receipt, status: 'already-applied' }
    }

    const calculated = calculateRosterGrowth(roster, payload)
    const appliedAt = this.now()
    const receipt = makeReceipt(identity, calculated, appliedAt, 'applied')
    const before = roster.filter((unit) => payload.unitIds.includes(unit.id))
    const updates = calculated.results.map((result) => result.unit)
    const pending = markerFor(identity, receipt, before, updates, appliedAt, 'pending', payload.outcome)
    const pendingMarkers = replaceMarker(markers, pending)
    try {
      // Marker intent is durable before the canonical write.  If either write
      // fails, retry sees the pending marker and never recalculates growth.
      await this.persistence.savePending(calculated.roster, pendingMarkers)
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '保存 Mobie 成長結果失敗，請重試。', cause)
    }
    const settled = markerFor(identity, receipt, before, updates, appliedAt, 'settled', payload.outcome, pending)
    try {
      // Settlement must not prune another marker. Retention runs only from
      // the explicit Result-leave boundary.
      await this.persistence.saveMarkers(replaceMarker(pendingMarkers, settled))
    } catch (cause) {
      throw new ResultSettlementError('receipt', identity, 'Result 結算已寫入，但回條保存失敗；請重試以完成對帳。', cause)
    }
    return receipt
  }
}

function replaceSkillPointsMarker(
  markers: readonly SkillPointsSettlementMarker[],
  marker: SkillPointsSettlementMarker,
): SkillPointsSettlementMarker[] {
  const index = markers.findIndex((item) => item.resultId === marker.resultId)
  const next = [...markers]
  if (index < 0) next.push(marker)
  else next[index] = marker
  return next
}

function replaceMetaMarker(
  markers: readonly MetaSettlementMarker[],
  marker: MetaSettlementMarker,
): MetaSettlementMarker[] {
  const index = markers.findIndex((item) => item.resultId === marker.resultId)
  const next = [...markers]
  if (index < 0) next.push(marker)
  else next[index] = marker
  return next
}

function cloneMeta(meta: MetaState): MetaState {
  return {
    schemaVersion: meta.schemaVersion,
    registered: [...meta.registered],
    seen: [...meta.seen],
    stats: { ...meta.stats },
    achievements: { ...meta.achievements },
  }
}

/** Pure meta update used by the Meta child boundary. */
export function calculateMetaSettlement(meta: MetaState, payload: MetaSettlementPayload): MetaState {
  let next = meta
  if (payload.winMode) {
    next = bumpStat(next, payload.winMode === 'arena' ? 'arenaWins' : 'wins')
  }
  const evolutionIds = (payload.evolutions ?? []).map((event) => event.toSpecies)
  if (evolutionIds.length > 0) {
    next = bumpStat(addRegistered(next, evolutionIds), 'evolutions', evolutionIds.length)
  }
  return next
}

function skillPointsReceipt(
  identity: ResultIdentity,
  delta: number,
  before: number,
  after: number,
  appliedAt: number,
  status: SkillPointsSettlementReceipt['status'],
): SkillPointsSettlementReceipt {
  return { ...identity, status, delta, before, after, appliedAt }
}

function metaReceipt(
  identity: ResultIdentity,
  meta: MetaState,
  payload: MetaSettlementPayload,
  appliedAt: number,
  status: MetaSettlementReceipt['status'],
): MetaSettlementReceipt {
  return {
    ...identity,
    status,
    meta: cloneMeta(meta),
    ...(payload.winMode ? { winMode: payload.winMode } : {}),
    evolutionCount: payload.evolutions?.length ?? 0,
    appliedAt,
  }
}

function withoutReceiptStatus<T extends { status: unknown }>(receipt: T): Omit<T, 'status'> {
  const rest = { ...receipt } as Omit<T, 'status'> & { status?: unknown }
  delete rest.status
  return rest
}

/**
 * Skill Points child destination. The wallet and its pending marker are
 * written through one boundary, while Result orchestration remains separate.
 */
export class SkillPointsDestination {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly persistence: SkillPointsPersistence,
    private readonly now: () => number = () => Date.now(),
  ) {}

  applyOnce(identity: ResultIdentity, payload: SkillPointsSettlementPayload): Promise<SkillPointsSettlementReceipt> {
    const run = this.queue.then(() => this.applySerialized(identity, payload))
    this.queue = run.catch(() => undefined)
    return run
  }

  hasApplied(identity: ResultIdentity): Promise<boolean> {
    const run = this.queue.then(async () => {
      try {
        const marker = (await this.persistence.loadMarkers()).find((item) => item.resultId === identity.resultId)
        if (!marker) return false
        if (marker.resultFingerprint !== identity.resultFingerprint) collision(identity)
        return marker.status === 'settled' || marker.canonicalApplied === true
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, '讀取 SP 結算標記失敗，請重試。', error)
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  markResultLeft(identity: ResultIdentity): Promise<void> {
    const run = this.queue.then(async () => {
      try {
        const markers = await this.persistence.loadMarkers()
        const marker = markers.find((item) => item.resultId === identity.resultId)
        if (!marker) return
        if (marker.resultFingerprint !== identity.resultFingerprint) collision(identity)
        await this.persistence.saveMarkers(retainResultMarkers(
          replaceSkillPointsMarker(markers, { ...marker, leftResultAt: this.now() }),
        ))
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, '保存 SP Result 離場標記失敗，請重試。', error)
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async applySerialized(
    identity: ResultIdentity,
    payload: SkillPointsSettlementPayload,
  ): Promise<SkillPointsSettlementReceipt> {
    let markers: SkillPointsSettlementMarker[]
    try {
      markers = await this.persistence.loadMarkers()
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '讀取 SP 結算標記失敗，請重試。', cause)
    }
    const existing = markers.find((item) => item.resultId === identity.resultId)
    if (existing && existing.resultFingerprint !== identity.resultFingerprint) collision(identity)
    if (existing?.status === 'settled') return { ...existing.receipt, status: 'already-applied' }

    let points: number
    try {
      points = await this.persistence.loadPoints()
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '讀取 canonical SP 失敗，請重試。', cause)
    }

    if (existing) {
      // Pending is a durable write-ahead record. The child boundary records
      // canonicalApplied together with the wallet value; when it is false,
      // apply the saved delta to the current wallet so later spends/grants are
      // preserved instead of resetting the balance to an old snapshot.
      if (existing.canonicalApplied !== true && existing.delta > 0) {
        try {
          await this.persistence.savePending(points + existing.delta, markers, identity.resultId)
          existing.canonicalApplied = true
        } catch (cause) {
          throw new ResultSettlementError('storage', identity, '恢復 SP 結算資料失敗，請重試。', cause)
        }
      }
      const settled: SkillPointsSettlementMarker = {
        ...existing,
        status: 'settled',
        settledAt: existing.settledAt ?? this.now(),
      }
      try {
        await this.persistence.saveMarkers(replaceSkillPointsMarker(markers, settled))
      } catch (cause) {
        throw new ResultSettlementError('receipt', identity, 'SP 已寫入，但回條保存失敗；請重試以完成對帳。', cause)
      }
      return { ...existing.receipt, status: 'already-applied' }
    }

    const delta = Number.isFinite(payload.delta) ? Math.max(0, Math.floor(payload.delta)) : 0
    const after = points + delta
    const appliedAt = this.now()
    const receipt = skillPointsReceipt(identity, delta, points, after, appliedAt, 'applied')
    const pending: SkillPointsSettlementMarker = {
      ...identity,
      destination: 'skill-points',
      status: 'pending',
      createdAt: appliedAt,
      canonicalApplied: false,
      delta,
      before: points,
      after,
      receipt: withoutReceiptStatus(receipt),
    }
    try {
      await this.persistence.savePending(after, replaceSkillPointsMarker(markers, pending), identity.resultId)
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '保存 SP 結果失敗，請重試。', cause)
    }
    pending.canonicalApplied = true
    const settled: SkillPointsSettlementMarker = {
      ...pending,
      status: 'settled',
      settledAt: appliedAt,
    }
    try {
      await this.persistence.saveMarkers(replaceSkillPointsMarker(markers, settled))
    } catch (cause) {
      throw new ResultSettlementError('receipt', identity, 'SP 已寫入，但回條保存失敗；請重試以完成對帳。', cause)
    }
    return receipt
  }
}

/** Meta/Dex progression child destination. Capture writes remain a later child. */
export class MetaSettlementDestination {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly persistence: MetaSettlementPersistence,
    private readonly now: () => number = () => Date.now(),
  ) {}

  applyOnce(identity: ResultIdentity, payload: MetaSettlementPayload): Promise<MetaSettlementReceipt> {
    const run = this.queue.then(() => this.applySerialized(identity, payload))
    this.queue = run.catch(() => undefined)
    return run
  }

  hasApplied(identity: ResultIdentity): Promise<boolean> {
    const run = this.queue.then(async () => {
      try {
        const marker = (await this.persistence.loadMarkers()).find((item) => item.resultId === identity.resultId)
        if (!marker) return false
        if (marker.resultFingerprint !== identity.resultFingerprint) collision(identity)
        return marker.status === 'settled' || marker.canonicalApplied === true
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, '讀取 Meta 結算標記失敗，請重試。', error)
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  markResultLeft(identity: ResultIdentity): Promise<void> {
    const run = this.queue.then(async () => {
      try {
        const markers = await this.persistence.loadMarkers()
        const marker = markers.find((item) => item.resultId === identity.resultId)
        if (!marker) return
        if (marker.resultFingerprint !== identity.resultFingerprint) collision(identity)
        await this.persistence.saveMarkers(retainResultMarkers(
          replaceMetaMarker(markers, { ...marker, leftResultAt: this.now() }),
        ))
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, '保存 Meta Result 離場標記失敗，請重試。', error)
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async applySerialized(identity: ResultIdentity, payload: MetaSettlementPayload): Promise<MetaSettlementReceipt> {
    let markers: MetaSettlementMarker[]
    try {
      markers = await this.persistence.loadMarkers()
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '讀取 Meta 結算標記失敗，請重試。', cause)
    }
    const existing = markers.find((item) => item.resultId === identity.resultId)
    if (existing && existing.resultFingerprint !== identity.resultFingerprint) collision(identity)
    if (existing?.status === 'settled') return { ...existing.receipt, status: 'already-applied', meta: cloneMeta(existing.receipt.meta) }

    let meta: MetaState
    try {
      meta = await this.persistence.loadMeta()
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '讀取 canonical Meta 失敗，請重試。', cause)
    }
    if (existing) {
      if (existing.canonicalApplied !== true) {
        // The marker payload is the operation delta. Apply it to the current
        // canonical state so a later win/capture/claim is never overwritten.
        const reconciled = calculateMetaSettlement(meta, existing.payload)
        try {
          await this.persistence.savePending(reconciled, markers, identity.resultId)
          existing.canonicalApplied = true
        } catch (cause) {
          throw new ResultSettlementError('storage', identity, '恢復 Meta 結算資料失敗，請重試。', cause)
        }
      }
      const settled: MetaSettlementMarker = {
        ...existing,
        status: 'settled',
        settledAt: existing.settledAt ?? this.now(),
      }
      try {
        await this.persistence.saveMarkers(replaceMetaMarker(markers, settled))
      } catch (cause) {
        throw new ResultSettlementError('receipt', identity, 'Meta 已寫入，但回條保存失敗；請重試以完成對帳。', cause)
      }
      return { ...existing.receipt, status: 'already-applied', meta: cloneMeta(existing.receipt.meta) }
    }

    const after = calculateMetaSettlement(meta, payload)
    const appliedAt = this.now()
    const receipt = metaReceipt(identity, after, payload, appliedAt, 'applied')
    const pending: MetaSettlementMarker = {
      ...identity,
      destination: 'meta',
      status: 'pending',
      createdAt: appliedAt,
      canonicalApplied: false,
      before: cloneMeta(meta),
      after: cloneMeta(after),
      payload: {
        ...(payload.winMode ? { winMode: payload.winMode } : {}),
        ...(payload.evolutions ? { evolutions: payload.evolutions.map((event) => ({ toSpecies: event.toSpecies })) } : {}),
      },
      receipt: withoutReceiptStatus(receipt),
    }
    try {
      await this.persistence.savePending(after, replaceMetaMarker(markers, pending), identity.resultId)
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '保存 Meta 結果失敗，請重試。', cause)
    }
    pending.canonicalApplied = true
    const settled: MetaSettlementMarker = {
      ...pending,
      status: 'settled',
      settledAt: appliedAt,
    }
    try {
      await this.persistence.saveMarkers(replaceMetaMarker(markers, settled))
    } catch (cause) {
      throw new ResultSettlementError('receipt', identity, 'Meta 已寫入，但回條保存失敗；請重試以完成對帳。', cause)
    }
    return receipt
  }
}

/** Result-level journal; it never mutates the roster and is not exactly-once authority. */
export class ResultSettlementCoordinator {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly destination: RosterGrowthDestination,
    private readonly journal: SettlementJournalPersistence,
    private readonly now: () => number = () => Date.now(),
    private readonly children: ResultSettlementChildren = {},
  ) {}

  settle(identity: ResultIdentity, payload: ResultSettlementPayload): Promise<ResultSettlementReceipt> {
    const run = this.queue.then(() => this.settleSerialized(identity, payload))
    this.queue = run.catch(() => undefined)
    return run
  }

  markResultLeft(identity: ResultIdentity): Promise<void> {
    const run = this.queue.then(async () => {
      try {
        const entries = await this.journal.load()
        const entry = entries.find((item) => item.resultId === identity.resultId)
        if (entry && entry.resultFingerprint !== identity.resultFingerprint) collision(identity)
        if (entry) {
          await this.journal.save(retainResultMarkers(
            entries.map((item) => item.resultId === identity.resultId ? { ...item, leftResultAt: this.now() } : item),
          ))
        }
        await this.destination.markResultLeft(identity)
        if (this.children.skillPoints) await this.children.skillPoints.markResultLeft(identity)
        if (this.children.meta) await this.children.meta.markResultLeft(identity)
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, '保存 Result 離場標記失敗，請重試。', error)
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async settleSerialized(identity: ResultIdentity, payload: ResultSettlementPayload): Promise<ResultSettlementReceipt> {
    let entries: SettlementJournalEntry[]
    try {
      entries = await this.journal.load()
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '讀取 Result 結算進度失敗，請重試。', cause)
    }
    const existing = entries.find((item) => item.resultId === identity.resultId)
    if (existing && existing.resultFingerprint !== identity.resultFingerprint) collision(identity)

    let childAlreadyApplied = false
    let skillPointsAlreadyApplied = false
    let metaAlreadyApplied = false
    if (existing) {
      // Reconciliation starts with the child authority. The journal is only
      // orchestration state and cannot prove that the roster write happened.
      try {
        childAlreadyApplied = await this.destination.hasApplied(identity)
        if (this.children.skillPoints) skillPointsAlreadyApplied = await this.children.skillPoints.hasApplied(identity)
        if (this.children.meta) metaAlreadyApplied = await this.children.meta.hasApplied(identity)
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, 'Result 子結算回條對帳失敗，請重試。', error)
      }
    }

    const allChildrenSettled = existing?.status === 'settled'
      && existing.rosterGrowth
      && childAlreadyApplied
      && (!this.children.skillPoints || (existing.skillPoints && skillPointsAlreadyApplied))
      && (!this.children.meta || (existing.meta && metaAlreadyApplied))
    if (allChildrenSettled) {
      let childReceipt: ResultSettlementReceipt
      try {
        const rosterReceipt = await this.destination.applyOnce(identity, payload)
        const skillPointsReceipt = this.children.skillPoints
          ? await this.children.skillPoints.applyOnce(identity, payload.skillPoints ?? { delta: 0 })
          : undefined
        const metaPayload: MetaSettlementPayload = {
          ...(payload.meta ?? {}),
          ...(payload.meta?.evolutions
            ? {}
            : { evolutions: rosterReceipt.evolutions.map((event) => ({ toSpecies: event.toSpecies })) }),
        }
        const metaReceipt = this.children.meta
          ? await this.children.meta.applyOnce(identity, metaPayload)
          : undefined
        childReceipt = {
          ...rosterReceipt,
          ...(skillPointsReceipt ? { skillPoints: skillPointsReceipt } : {}),
          ...(metaReceipt ? { meta: metaReceipt } : {}),
        }
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, 'Result 子結算回條對帳失敗，請重試。', error)
      }
      return {
        ...childReceipt,
        status: 'already-applied',
        ...(childReceipt.skillPoints ? { skillPoints: { ...childReceipt.skillPoints, status: 'already-applied' } } : {}),
        ...(childReceipt.meta ? { meta: { ...childReceipt.meta, status: 'already-applied' } } : {}),
      }
    }

    const running: SettlementJournalEntry = existing
      ? { ...existing, status: 'pending', error: undefined }
      : {
          resultId: identity.resultId,
          resultFingerprint: identity.resultFingerprint,
          status: 'pending',
          createdAt: this.now(),
          ...(payload.outcome ? { outcome: payload.outcome } : {}),
        }
    try {
      await this.journal.save(replaceJournal(entries, running))
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '保存 Result 結算進度失敗，請重試。', cause)
    }

    let receipt: RosterGrowthReceipt
    try {
      receipt = await this.destination.applyOnce(identity, payload)
    } catch (error) {
      if (error instanceof ResultSettlementError) throw error
      throw new ResultSettlementError('storage', identity, 'Result 結算失敗，請重試。', error)
    }

    let skillPointsReceipt: SkillPointsSettlementReceipt | undefined
    if (this.children.skillPoints) {
      try {
        skillPointsReceipt = await this.children.skillPoints.applyOnce(
          identity,
          payload.skillPoints ?? { delta: 0 },
        )
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, 'SP 結算失敗，請重試。', error)
      }
    }

    let metaReceipt: MetaSettlementReceipt | undefined
    if (this.children.meta) {
      const metaPayload: MetaSettlementPayload = {
        ...(payload.meta ?? {}),
        ...(payload.meta?.evolutions
          ? {}
          : { evolutions: receipt.evolutions.map((event) => ({ toSpecies: event.toSpecies })) }),
      }
      try {
        metaReceipt = await this.children.meta.applyOnce(identity, metaPayload)
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, 'Meta 結算失敗，請重試。', error)
      }
    }

    const settled: SettlementJournalEntry = {
      ...running,
      status: 'settled',
      settledAt: running.settledAt ?? this.now(),
      rosterGrowth: receipt,
      ...(skillPointsReceipt ? { skillPoints: skillPointsReceipt } : {}),
      ...(metaReceipt ? { meta: metaReceipt } : {}),
      error: undefined,
    }
    try {
      // Do not prune while the coordinator is still settling. The leave
      // action performs bounded retention after the player exits Result.
      await this.journal.save(replaceJournal(entries, settled))
    } catch (cause) {
      // The child destination is now durable.  Keeping the journal in its
      // running state lets retry reconcile via destination.applyOnce.
      throw new ResultSettlementError('receipt', identity, 'Mobie 成長已保存，但 Result 回條尚未完成；請重試。', cause)
    }
    return {
      ...receipt,
      ...(skillPointsReceipt ? { skillPoints: skillPointsReceipt } : {}),
      ...(metaReceipt ? { meta: metaReceipt } : {}),
    }
  }
}

function replaceJournal(entries: readonly SettlementJournalEntry[], entry: SettlementJournalEntry): SettlementJournalEntry[] {
  const index = entries.findIndex((item) => item.resultId === entry.resultId)
  const next = [...entries]
  if (index < 0) next.push(entry)
  else next[index] = entry
  return next
}

function safeStorage(): ResultStorage | null {
  if (typeof localStorage === 'undefined') return null
  return localStorage
}

function parseArray<T>(raw: string | null, label: string): T[] {
  if (raw === null) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new Error(`${label} 格式無效：${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (!Array.isArray(parsed)) throw new Error(`${label} 格式無效：必須是陣列`)
  return parsed as T[]
}

function readEmbeddedMarkers<T>(raw: string | null, label: string): T[] | null {
  if (raw === null) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch (cause) {
    throw new Error(`${label} 格式無效：${cause instanceof Error ? cause.message : String(cause)}`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const markers = (parsed as Record<string, unknown>).resultSettlements
  if (markers === undefined) return null
  if (!Array.isArray(markers)) throw new Error(`${label} 格式無效：必須是陣列`)
  return markers as T[]
}

function storageFailure(identity: ResultIdentity, message: string, cause: unknown): ResultSettlementError {
  return new ResultSettlementError('storage', identity, message, cause)
}

/** Browser persistence for the shared result journal. */
export class LocalStorageSettlementJournal implements SettlementJournalPersistence {
  constructor(private readonly storage: ResultStorage | null = safeStorage()) {}

  async load(): Promise<SettlementJournalEntry[]> {
    if (!this.storage) return []
    return parseArray<SettlementJournalEntry>(this.storage.getItem(RESULT_SETTLEMENT_JOURNAL_KEY), 'Result 結算進度')
  }

  async save(entries: SettlementJournalEntry[]): Promise<void> {
    if (!this.storage) return
    try {
      this.storage.setItem(RESULT_SETTLEMENT_JOURNAL_KEY, JSON.stringify(entries))
    } catch (cause) {
      throw new Error(`保存 Result 結算進度失敗：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
}

/** Browser persistence for the roster child marker. */
export class LocalStorageRosterGrowthPersistence implements RosterGrowthPersistence {
  constructor(
    private readonly roster: {
      loadRoster: () => Promise<OwnedUnit[]>
      saveRoster: (units: OwnedUnit[]) => Promise<void>
    },
    private readonly storage: ResultStorage | null = safeStorage(),
  ) {}

  loadRoster(): Promise<OwnedUnit[]> {
    return this.roster.loadRoster()
  }

  saveRoster(units: OwnedUnit[]): Promise<void> {
    return this.roster.saveRoster(units)
  }

  async loadMarkers(): Promise<RosterGrowthMarker[]> {
    if (!this.storage) return []
    return parseArray<RosterGrowthMarker>(this.storage.getItem(ROSTER_GROWTH_MARKER_KEY), 'Mobie 成長結算標記')
  }

  async savePending(roster: OwnedUnit[], markers: RosterGrowthMarker[]): Promise<void> {
    if (!this.storage) {
      await this.saveRoster(roster)
      return
    }
    try {
      // Write-ahead marker + strict canonical write are one serialized
      // persistence operation.  A pending marker makes an interrupted write
      // recoverable without recalculating the reward.
      this.storage.setItem(ROSTER_GROWTH_MARKER_KEY, JSON.stringify(markers))
      await this.saveRoster(roster)
    } catch (cause) {
      throw storageFailure({ resultId: 'roster-growth', resultFingerprint: 'storage' }, '保存 Mobie 成長資料失敗。', cause)
    }
  }

  async saveMarkers(markers: RosterGrowthMarker[]): Promise<void> {
    if (!this.storage) return
    try {
      this.storage.setItem(ROSTER_GROWTH_MARKER_KEY, JSON.stringify(markers))
    } catch (cause) {
      throw new Error(`保存 Mobie 成長結算標記失敗：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
}

/** Browser persistence for the SP child boundary. */
export class LocalStorageSkillPointsPersistence implements SkillPointsPersistence {
  constructor(
    private readonly points: {
      loadPoints: () => Promise<number> | number
      savePoints: (points: number) => Promise<void> | void
      savePointsWithMarkers: (points: number, markers: SkillPointsSettlementMarker[], operationId?: string) => Promise<void> | void
    },
    private readonly storage: ResultStorage | null = safeStorage(),
  ) {}

  loadPoints(): Promise<number> {
    return Promise.resolve(this.points.loadPoints())
  }

  savePoints(points: number): Promise<void> {
    return Promise.resolve(this.points.savePoints(points))
  }

  async loadMarkers(): Promise<SkillPointsSettlementMarker[]> {
    if (!this.storage) return []
    const embedded = readEmbeddedMarkers<SkillPointsSettlementMarker>(
      this.storage.getItem('mobie.skillpoints.v1'),
      'SP 結算標記',
    )
    if (embedded) return embedded
    return parseArray<SkillPointsSettlementMarker>(
      this.storage.getItem(SKILL_POINTS_SETTLEMENT_MARKER_KEY),
      'SP 結算標記',
    )
  }

  async savePending(points: number, markers: SkillPointsSettlementMarker[], operationId?: string): Promise<void> {
    const completed = markers.map((marker) => marker.resultId === operationId
      ? { ...marker, canonicalApplied: true }
      : marker)
    try {
      await this.points.savePointsWithMarkers(points, completed, operationId)
      try { this.storage?.setItem(SKILL_POINTS_SETTLEMENT_MARKER_KEY, JSON.stringify(completed)) } catch { /* canonical envelope is authoritative */ }
    } catch (cause) {
      throw new Error(`保存 SP 結算資料失敗：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  async saveMarkers(markers: SkillPointsSettlementMarker[]): Promise<void> {
    try {
      const points = await this.loadPoints()
      await this.points.savePointsWithMarkers(points, markers)
      try { this.storage?.setItem(SKILL_POINTS_SETTLEMENT_MARKER_KEY, JSON.stringify(markers)) } catch { /* canonical envelope is authoritative */ }
    } catch (cause) {
      throw new Error(`保存 SP 結算標記失敗：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
}

/** Browser persistence for the Meta child boundary. */
export class LocalStorageMetaSettlementPersistence implements MetaSettlementPersistence {
  constructor(
    private readonly meta: {
      loadMeta: () => Promise<MetaState> | MetaState
      saveMeta: (meta: MetaState) => Promise<void> | void
      saveMetaWithMarkers: (meta: MetaState, markers: MetaSettlementMarker[], operationId?: string) => Promise<void> | void
    },
    private readonly storage: ResultStorage | null = safeStorage(),
  ) {}

  loadMeta(): Promise<MetaState> {
    return Promise.resolve(this.meta.loadMeta())
  }

  saveMeta(meta: MetaState): Promise<void> {
    return Promise.resolve(this.meta.saveMeta(meta))
  }

  async loadMarkers(): Promise<MetaSettlementMarker[]> {
    if (!this.storage) return []
    const embedded = readEmbeddedMarkers<MetaSettlementMarker>(
      this.storage.getItem('mobie.meta.v1'),
      'Meta 結算標記',
    )
    if (embedded) return embedded
    return parseArray<MetaSettlementMarker>(
      this.storage.getItem(META_SETTLEMENT_MARKER_KEY),
      'Meta 結算標記',
    )
  }

  async savePending(meta: MetaState, markers: MetaSettlementMarker[], operationId?: string): Promise<void> {
    const completed = markers.map((marker) => marker.resultId === operationId
      ? { ...marker, canonicalApplied: true }
      : marker)
    try {
      await this.meta.saveMetaWithMarkers(meta, completed, operationId)
      try { this.storage?.setItem(META_SETTLEMENT_MARKER_KEY, JSON.stringify(completed)) } catch { /* canonical envelope is authoritative */ }
    } catch (cause) {
      throw new Error(`保存 Meta 結算資料失敗：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  async saveMarkers(markers: MetaSettlementMarker[]): Promise<void> {
    try {
      const meta = await this.loadMeta()
      await this.meta.saveMetaWithMarkers(meta, markers)
      try { this.storage?.setItem(META_SETTLEMENT_MARKER_KEY, JSON.stringify(markers)) } catch { /* canonical envelope is authoritative */ }
    } catch (cause) {
      throw new Error(`保存 Meta 結算標記失敗：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
}

/** Test-friendly in-memory marker/journal implementations. */
export class MemorySettlementJournal implements SettlementJournalPersistence {
  entries: SettlementJournalEntry[] = []
  failSave = false
  saveCount = 0
  failOnSave: number | undefined

  async load(): Promise<SettlementJournalEntry[]> {
    return this.entries.map((entry) => ({
      ...entry,
      rosterGrowth: entry.rosterGrowth ? { ...entry.rosterGrowth } : undefined,
      skillPoints: entry.skillPoints ? { ...entry.skillPoints } : undefined,
      meta: entry.meta ? { ...entry.meta, meta: cloneMeta(entry.meta.meta) } : undefined,
    }))
  }

  async save(entries: SettlementJournalEntry[]): Promise<void> {
    this.saveCount += 1
    if (this.failSave || this.failOnSave === this.saveCount) throw new Error('journal write failed')
    this.entries = entries.map((entry) => ({
      ...entry,
      rosterGrowth: entry.rosterGrowth ? { ...entry.rosterGrowth } : undefined,
      skillPoints: entry.skillPoints ? { ...entry.skillPoints } : undefined,
      meta: entry.meta ? { ...entry.meta, meta: cloneMeta(entry.meta.meta) } : undefined,
    }))
  }
}

export class MemoryRosterGrowthPersistence implements RosterGrowthPersistence {
  roster: OwnedUnit[]
  markers: RosterGrowthMarker[] = []
  failPending = false
  failMarker = false
  saveCount = 0

  constructor(roster: OwnedUnit[]) {
    this.roster = roster.map((unit) => ({ ...unit }))
  }

  async loadRoster(): Promise<OwnedUnit[]> {
    return this.roster.map((unit) => ({ ...unit }))
  }

  async saveRoster(units: OwnedUnit[]): Promise<void> {
    this.saveCount += 1
    this.roster = units.map((unit) => ({ ...unit }))
  }

  async loadMarkers(): Promise<RosterGrowthMarker[]> {
    return this.markers.map((marker) => ({ ...marker, receipt: { ...marker.receipt } }))
  }

  async savePending(roster: OwnedUnit[], markers: RosterGrowthMarker[]): Promise<void> {
    if (this.failPending) throw new Error('pending write failed')
    this.markers = markers.map((marker) => ({ ...marker, receipt: { ...marker.receipt } }))
    await this.saveRoster(roster)
  }

  async saveMarkers(markers: RosterGrowthMarker[]): Promise<void> {
    if (this.failMarker) throw new Error('marker write failed')
    this.markers = markers.map((marker) => ({ ...marker, receipt: { ...marker.receipt } }))
  }
}

export class MemorySkillPointsPersistence implements SkillPointsPersistence {
  points: number
  markers: SkillPointsSettlementMarker[] = []
  failPending = false
  failMarker = false
  saveCount = 0

  constructor(points = 0) {
    this.points = points
  }

  async loadPoints(): Promise<number> {
    return this.points
  }

  async savePoints(points: number): Promise<void> {
    this.saveCount += 1
    this.points = points
  }

  async loadMarkers(): Promise<SkillPointsSettlementMarker[]> {
    return this.markers.map((marker) => ({ ...marker, receipt: { ...marker.receipt } }))
  }

  async savePending(points: number, markers: SkillPointsSettlementMarker[], operationId?: string): Promise<void> {
    this.markers = markers.map((marker) => ({ ...marker, receipt: { ...marker.receipt } }))
    if (this.failPending) throw new Error('SP pending write failed')
    await this.savePoints(points)
    this.markers = markers.map((marker) => ({
      ...marker,
      ...(marker.resultId === operationId ? { canonicalApplied: true } : {}),
      receipt: { ...marker.receipt },
    }))
  }

  async saveMarkers(markers: SkillPointsSettlementMarker[]): Promise<void> {
    if (this.failMarker) throw new Error('SP marker write failed')
    this.markers = markers.map((marker) => ({ ...marker, receipt: { ...marker.receipt } }))
  }
}

export class MemoryMetaSettlementPersistence implements MetaSettlementPersistence {
  meta: MetaState
  markers: MetaSettlementMarker[] = []
  failPending = false
  failMarker = false
  saveCount = 0

  constructor(meta: MetaState) {
    this.meta = cloneMeta(meta)
  }

  async loadMeta(): Promise<MetaState> {
    return cloneMeta(this.meta)
  }

  async saveMeta(meta: MetaState): Promise<void> {
    this.saveCount += 1
    this.meta = cloneMeta(meta)
  }

  async loadMarkers(): Promise<MetaSettlementMarker[]> {
    return this.markers.map((marker) => ({
      ...marker,
      before: cloneMeta(marker.before),
      after: cloneMeta(marker.after),
      payload: {
        ...marker.payload,
        ...(marker.payload.evolutions
          ? { evolutions: marker.payload.evolutions.map((event) => ({ ...event })) }
          : {}),
      },
      receipt: { ...marker.receipt, meta: cloneMeta(marker.receipt.meta) },
    }))
  }

  async savePending(meta: MetaState, markers: MetaSettlementMarker[], operationId?: string): Promise<void> {
    this.markers = markers.map((marker) => ({
      ...marker,
      before: cloneMeta(marker.before),
      after: cloneMeta(marker.after),
      payload: {
        ...marker.payload,
        ...(marker.payload.evolutions
          ? { evolutions: marker.payload.evolutions.map((event) => ({ ...event })) }
          : {}),
      },
      receipt: { ...marker.receipt, meta: cloneMeta(marker.receipt.meta) },
    }))
    if (this.failPending) throw new Error('Meta pending write failed')
    await this.saveMeta(meta)
    this.markers = markers.map((marker) => ({
      ...marker,
      ...(marker.resultId === operationId ? { canonicalApplied: true } : {}),
      before: cloneMeta(marker.before),
      after: cloneMeta(marker.after),
      payload: {
        ...marker.payload,
        ...(marker.payload.evolutions
          ? { evolutions: marker.payload.evolutions.map((event) => ({ ...event })) }
          : {}),
      },
      receipt: { ...marker.receipt, meta: cloneMeta(marker.receipt.meta) },
    }))
  }

  async saveMarkers(markers: MetaSettlementMarker[]): Promise<void> {
    if (this.failMarker) throw new Error('Meta marker write failed')
    this.markers = markers.map((marker) => ({
      ...marker,
      before: cloneMeta(marker.before),
      after: cloneMeta(marker.after),
      payload: {
        ...marker.payload,
        ...(marker.payload.evolutions
          ? { evolutions: marker.payload.evolutions.map((event) => ({ ...event })) }
          : {}),
      },
      receipt: { ...marker.receipt, meta: cloneMeta(marker.receipt.meta) },
    }))
  }
}
