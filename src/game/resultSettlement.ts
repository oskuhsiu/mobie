import type { Card, OwnedUnit } from '@/game/types'
import { applyExp, createOwnedUnit, expYield, type ExpResult } from '@/game/growth'
import { effectiveLearnedMoves, newlyLearned } from '@/game/learnset'
import { getSpecies } from '@/game/data/species'
import { PRODUCT_RUNTIME } from '@/game/ext/productRuntime'
import { addRegistered, bumpStat, type MetaState } from '@/game/meta'
import { addEgg, isSupportedEggSource, type Egg, type IncubatorState } from '@/game/incubator'
import { ASCENSIONS, isBossFloor } from '@/game/tower'
import { buildBattleMobie } from '@/game/stats'
import { captureChanceWithBall, getBall, rollBall, type BallId } from '@/game/battle/engine'
import { hashSeed, makeRng } from '@/game/rng'
import type { AchievementRewardMarker, AchievementClaimOutbox } from '@/game/achievementClaim'
import type { HatchOutbox } from '@/game/incubatorHatch'

/**
 * Result settlement is keyed by the logical battle, not by a React mount or a
 * presentation attempt.  The fingerprint is deliberately independent from
 * the reward payload: it detects a reused id with a different battle token.
 */
export interface ResultIdentity {
  resultId: string
  resultFingerprint: string
}

export type ResultSettlementErrorCode = 'collision' | 'storage' | 'receipt' | 'invalid-source'

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
export const TOWER_SETTLEMENT_MARKER_KEY = 'mobie.tower.settlement.v1'
export const INCUBATOR_SETTLEMENT_MARKER_KEY = 'mobie.incubator.settlement.v1'
export const ROSTER_CAPTURE_SETTLEMENT_MARKER_KEY = 'mobie.roster.capture.v1'
export const META_CAPTURE_SETTLEMENT_MARKER_KEY = 'mobie.meta.capture.v1'
export const DUPLICATE_EGG_SETTLEMENT_MARKER_KEY = 'mobie.incubator.capture.v1'
// Descriptive aliases retained for callers that name the progression child explicitly.
export const TOWER_PROGRESSION_SETTLEMENT_MARKER_KEY = TOWER_SETTLEMENT_MARKER_KEY
export const INCUBATOR_PROGRESSION_SETTLEMENT_MARKER_KEY = INCUBATOR_SETTLEMENT_MARKER_KEY
export const CAPTURE_ROSTER_SETTLEMENT_MARKER_KEY = ROSTER_CAPTURE_SETTLEMENT_MARKER_KEY
export const CAPTURE_META_SETTLEMENT_MARKER_KEY = META_CAPTURE_SETTLEMENT_MARKER_KEY
export const INCUBATOR_CAPTURE_SETTLEMENT_MARKER_KEY = DUPLICATE_EGG_SETTLEMENT_MARKER_KEY

export type ResultOutcome = 'win' | 'lose'

/** Account-level SP reward forwarded by Result. The canonical wallet is owned by the SP child. */
export interface SkillPointsSettlementPayload {
  delta: number
}

/** Existing Result win/evolution Meta progression; capture/Dex uses the namespaced child below. */
export interface MetaSettlementPayload {
  winMode?: 'arena' | 'wild'
  evolutions?: Array<{ toSpecies: number }>
}

export type CaptureOutcome = 'escaped' | 'captured-new' | 'captured-duplicate-egg'

/** Inputs that existed before Ticket 32. The capture result never reads retry count or UI state. */
export interface CaptureSettlementPayload {
  target: Card
  captureMult: number
}

export interface CaptureDecision extends ResultIdentity {
  ballId: BallId
  captureChance: number
  /** The one deterministic draw after the ball roulette. */
  captureRoll: number
  caught: boolean
}

export interface RosterCapturePayload {
  card: Card
}

export interface CaptureMetaPayload {
  speciesId: number
  shiny: boolean
  outcome: Exclude<CaptureOutcome, 'escaped'>
}

export interface DuplicateEggPayload {
  speciesId: number
  label: string
  inheritedMoveId?: number
}

export interface CaptureSettlementPlan extends ResultIdentity {
  payload: CaptureSettlementPayload
  decision: CaptureDecision
  outcome: CaptureOutcome
  roster?: RosterCapturePayload
  meta?: CaptureMetaPayload
  duplicateEgg?: DuplicateEggPayload
}

/** Tower run metadata forwarded by Result; in-run floor/team state stays in XState. */
export interface TowerProgressionPayload {
  floor: number
  ascension: number
  outcome: ResultOutcome
}

/** Existing incubator eggs only. This child never creates a new egg. */
export interface IncubatorProgressionPayload {
  amount: number
  /** Optional source guard for future producer flows; Tower is intentionally rejected. */
  source?: string
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
  tower?: TowerProgressionPayload
  incubator?: IncubatorProgressionPayload
  capture?: CaptureSettlementPayload
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

export interface TowerProgressionState {
  bestFloor: number
  ascensionUnlocked: number
}

export interface TowerProgressionReceipt extends ResultIdentity {
  status: 'applied' | 'already-applied'
  floor: number
  ascension: number
  outcome: ResultOutcome
  before: TowerProgressionState
  after: TowerProgressionState
  appliedAt: number
}

export interface IncubatorProgressUpdate {
  eggId: string
  source: Egg['source']
  beforeProgress: number
  afterProgress: number
}

export interface IncubatorProgressionReceipt extends ResultIdentity {
  status: 'applied' | 'already-applied'
  amount: number
  updates: IncubatorProgressUpdate[]
  appliedAt: number
}

export interface RosterCaptureReceipt extends ResultIdentity {
  status: 'applied' | 'already-applied'
  unit: OwnedUnit
  appliedAt: number
}

export interface CaptureMetaReceipt extends ResultIdentity {
  status: 'applied' | 'already-applied'
  speciesId: number
  shiny: boolean
  outcome: Exclude<CaptureOutcome, 'escaped'>
  meta: MetaState
  appliedAt: number
}

export interface DuplicateEggReceipt extends ResultIdentity {
  status: 'applied' | 'already-applied'
  egg: Egg
  appliedAt: number
}

export interface CaptureSettlementReceipt extends ResultIdentity {
  status: 'applied' | 'already-applied'
  decision: CaptureDecision
  outcome: CaptureOutcome
  target: Card
  unit?: OwnedUnit
  egg?: Egg
  rosterCapture?: RosterCaptureReceipt
  meta?: CaptureMetaReceipt
  duplicateEgg?: DuplicateEggReceipt
  appliedAt: number
}

export interface ResultSettlementReceipt extends RosterGrowthReceipt {
  skillPoints?: SkillPointsSettlementReceipt
  meta?: MetaSettlementReceipt
  tower?: TowerProgressionReceipt
  incubator?: IncubatorProgressionReceipt
  capture?: CaptureSettlementReceipt
}

/**
 * Read-only preparation returned before a Result child mutation starts.
 * Capture presentation consumes the persisted decision from this seam; the
 * screen never rolls a second stream or reconstructs an outcome locally.
 */
export interface ResultSettlementPreparation extends ResultIdentity {
  capturePlan?: CaptureSettlementPlan
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

export interface TowerProgressionMarker extends ResultIdentity {
  destination: 'tower-progression'
  status: ResultMarkerStatus
  createdAt: number
  settledAt?: number
  leftResultAt?: number
  canonicalApplied?: boolean
  payload: TowerProgressionPayload
  before: TowerProgressionState
  after: TowerProgressionState
  receipt: Omit<TowerProgressionReceipt, 'status'>
}

export interface IncubatorProgressionMarker extends ResultIdentity {
  destination: 'incubator-progression'
  status: ResultMarkerStatus
  createdAt: number
  settledAt?: number
  leftResultAt?: number
  canonicalApplied?: boolean
  payload: IncubatorProgressionPayload
  updates: IncubatorProgressUpdate[]
  receipt: Omit<IncubatorProgressionReceipt, 'status'>
}

export interface RosterCaptureMarker extends ResultIdentity {
  destination: 'roster-capture'
  status: ResultMarkerStatus
  createdAt: number
  settledAt?: number
  leftResultAt?: number
  canonicalApplied?: boolean
  payload: RosterCapturePayload
  unit: OwnedUnit
  receipt: Omit<RosterCaptureReceipt, 'status'>
}

export interface CaptureMetaMarker extends ResultIdentity {
  destination: 'meta-capture'
  status: ResultMarkerStatus
  createdAt: number
  settledAt?: number
  leftResultAt?: number
  canonicalApplied?: boolean
  payload: CaptureMetaPayload
  before: MetaState
  after: MetaState
  receipt: Omit<CaptureMetaReceipt, 'status'>
}

export interface DuplicateEggMarker extends ResultIdentity {
  destination: 'incubator-capture'
  status: ResultMarkerStatus
  createdAt: number
  settledAt?: number
  leftResultAt?: number
  canonicalApplied?: boolean
  payload: DuplicateEggPayload
  egg: Egg
  receipt: Omit<DuplicateEggReceipt, 'status'>
}

export interface SettlementJournalEntry extends ResultIdentity {
  status: ResultMarkerStatus
  createdAt: number
  settledAt?: number
  leftResultAt?: number
  outcome?: ResultOutcome
  /** Original child intent retained when a stage fails before its receipt is journaled. */
  towerPayload?: TowerProgressionPayload
  incubatorPayload?: IncubatorProgressionPayload
  capturePayload?: CaptureSettlementPayload
  capturePlan?: CaptureSettlementPlan
  rosterGrowth?: RosterGrowthReceipt
  skillPoints?: SkillPointsSettlementReceipt
  meta?: MetaSettlementReceipt
  tower?: TowerProgressionReceipt
  incubator?: IncubatorProgressionReceipt
  capture?: CaptureSettlementReceipt
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

export interface TowerProgressionPersistence {
  loadRun: () => Promise<TowerProgressionState>
  loadMarkers: () => Promise<TowerProgressionMarker[]>
  /** Durable write-ahead step: pending marker + canonical tower metadata. */
  savePending: (run: TowerProgressionState, markers: TowerProgressionMarker[], operationId?: string) => Promise<void>
  /** Final marker step after the canonical tower write has succeeded. */
  saveMarkers: (markers: TowerProgressionMarker[]) => Promise<void>
}

export interface IncubatorProgressionPersistence {
  loadState: () => Promise<IncubatorState>
  loadMarkers: () => Promise<IncubatorProgressionMarker[]>
  /** Durable write-ahead step: pending marker + canonical incubator state. */
  savePending: (state: IncubatorState, markers: IncubatorProgressionMarker[], operationId?: string) => Promise<void>
  /** Final marker step after the canonical incubator write has succeeded. */
  saveMarkers: (markers: IncubatorProgressionMarker[]) => Promise<void>
}

export interface RosterCapturePersistence {
  loadRoster: () => Promise<OwnedUnit[]>
  loadMarkers: () => Promise<RosterCaptureMarker[]>
  /** Durable write-ahead step: capture marker + canonical roster boundary. */
  savePending: (roster: OwnedUnit[], markers: RosterCaptureMarker[], operationId?: string) => Promise<void>
  /** Final marker step after the canonical roster write has succeeded. */
  saveMarkers: (markers: RosterCaptureMarker[]) => Promise<void>
}

export interface CaptureMetaPersistence {
  loadMeta: () => Promise<MetaState>
  loadMarkers: () => Promise<CaptureMetaMarker[]>
  /** Durable write-ahead step: capture/Dex marker + canonical Meta boundary. */
  savePending: (meta: MetaState, markers: CaptureMetaMarker[], operationId?: string) => Promise<void>
  /** Final marker step after the canonical Meta write has succeeded. */
  saveMarkers: (markers: CaptureMetaMarker[]) => Promise<void>
}

export interface DuplicateEggPersistence {
  loadState: () => Promise<IncubatorState>
  loadMarkers: () => Promise<DuplicateEggMarker[]>
  /** Durable write-ahead step: duplicate egg marker + canonical incubator boundary. */
  savePending: (state: IncubatorState, markers: DuplicateEggMarker[], operationId?: string) => Promise<void>
  /** Final marker step after the canonical incubator write has succeeded. */
  saveMarkers: (markers: DuplicateEggMarker[]) => Promise<void>
}

export interface ResultSettlementChildren {
  skillPoints?: SkillPointsDestination
  meta?: MetaSettlementDestination
  tower?: TowerProgressionDestination
  incubator?: IncubatorProgressionDestination
  capture?: CaptureSettlementCoordinator
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

/**
 * Decide the ball and capture roll from the logical Result identity and the
 * original battle inputs. The UI never supplies an RNG and retries never
 * consume another stream value.
 */
export function deterministicCaptureDecision(
  identity: ResultIdentity,
  payload: CaptureSettlementPayload,
): CaptureDecision {
  const target = buildBattleMobie(payload.target)
  const rng = makeRng(`capture|${identity.resultId}|${identity.resultFingerprint}|${stableJson(payload)}`)
  const ballId = rollBall(rng)
  const ball = getBall(ballId)
  const captureMult = Number.isFinite(payload.captureMult) ? payload.captureMult : 1
  const captureChance = captureChanceWithBall(target, ball.mult * captureMult)
  const captureRoll = rng()
  return {
    ...identity,
    ballId,
    captureChance,
    captureRoll,
    caught: captureRoll < captureChance,
  }
}

// Short aliases make the pure decision seam discoverable without changing the
// canonical name used by the Result coordinator.
export const decideCapture = deterministicCaptureDecision
export const captureDecisionFor = deterministicCaptureDecision

/** Read only the durable presentation hint when a Result remounts. */
export function storedCaptureDecision(identity: ResultIdentity): CaptureDecision | null {
  const storage = safeStorage()
  if (!storage) return null
  try {
    const entries = parseArray<SettlementJournalEntry>(
      storage.getItem(RESULT_SETTLEMENT_JOURNAL_KEY),
      'Result 結算進度',
    )
    const plan = entries.find((entry) => entry.resultId === identity.resultId)?.capturePlan
    if (!plan || plan.resultFingerprint !== identity.resultFingerprint) return null
    return { ...plan.decision }
  } catch {
    return null
  }
}

/**
 * Compatibility identity for pre-handoff Result callers (tests and old
 * embedded screens). Production battles always provide the Web Crypto pair
 * from `BattleSession`; this fallback keeps those callers stable without
 * putting UI state or retry count into the capture roll.
 */
export function legacyResultIdentity(input: {
  regionId: string | null
  foeTeam: readonly Card[]
  playerTeam: readonly Card[]
  outcome: ResultOutcome
}): ResultIdentity {
  const basis = stableJson(input)
  return {
    resultId: `legacy-${hashSeed(`result|${basis}`).toString(16)}`,
    resultFingerprint: `legacy-${hashSeed(`fingerprint|${basis}`).toString(16)}`,
  }
}

function sameUnit(left: OwnedUnit | undefined, right: OwnedUnit): boolean {
  return Boolean(left && stableJson(left) === stableJson(right))
}

function cloneCard(card: Card): Card {
  return {
    ...card,
    ...(card.ivs ? { ivs: { ...card.ivs } } : {}),
    ...(card.equippedMoveIds ? { equippedMoveIds: [...card.equippedMoveIds] } : {}),
  }
}

function cloneOwnedUnit(unit: OwnedUnit): OwnedUnit {
  return {
    ...unit,
    ivs: { ...unit.ivs },
    ...(unit.learnedMoveIds ? { learnedMoveIds: [...unit.learnedMoveIds] } : {}),
    ...(unit.equippedMoveIds ? { equippedMoveIds: [...unit.equippedMoveIds] } : {}),
  }
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
        await this.persistence.saveMarkers(retainResultMarkers(next, identity))
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

function replaceRosterCaptureMarker(
  markers: readonly RosterCaptureMarker[],
  marker: RosterCaptureMarker,
): RosterCaptureMarker[] {
  const index = markers.findIndex((item) => item.resultId === marker.resultId)
  const next = [...markers]
  if (index < 0) next.push(marker)
  else next[index] = marker
  return next
}

function rosterCaptureReceipt(
  identity: ResultIdentity,
  unit: OwnedUnit,
  appliedAt: number,
  status: RosterCaptureReceipt['status'],
): RosterCaptureReceipt {
  return { ...identity, status, unit: cloneOwnedUnit(unit), appliedAt }
}

function rosterCaptureMarkerFor(
  identity: ResultIdentity,
  receipt: RosterCaptureReceipt,
  payload: RosterCapturePayload,
  unit: OwnedUnit,
  now: number,
  status: ResultMarkerStatus,
  previous?: RosterCaptureMarker,
): RosterCaptureMarker {
  return {
    ...identity,
    destination: 'roster-capture',
    status,
    createdAt: previous?.createdAt ?? now,
    ...(status === 'settled' ? { settledAt: previous?.settledAt ?? now } : {}),
    ...(previous?.leftResultAt === undefined ? {} : { leftResultAt: previous.leftResultAt }),
    canonicalApplied: previous?.canonicalApplied ?? false,
    payload: { card: cloneCard(payload.card) },
    unit: cloneOwnedUnit(previous?.unit ?? unit),
    receipt: {
      resultId: receipt.resultId,
      resultFingerprint: receipt.resultFingerprint,
      unit: cloneOwnedUnit(receipt.unit),
      appliedAt: receipt.appliedAt,
    },
  }
}

/** Durable Result child that adds one captured Card to the canonical roster. */
export class RosterCaptureDestination {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly persistence: RosterCapturePersistence,
    private readonly now: () => number = () => Date.now(),
  ) {}

  applyOnce(identity: ResultIdentity, payload: RosterCapturePayload): Promise<RosterCaptureReceipt> {
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
        if (marker.status === 'settled' || marker.canonicalApplied === true) return true
        // The roster marker is written before the canonical array because the
        // browser adapter has no cross-key transaction. Presence of the exact
        // captured id is the durable reconciliation evidence when the final
        // marker write was interrupted.
        const roster = await this.persistence.loadRoster()
        return roster.some((unit) => unit.id === marker.unit.id)
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, '讀取收服 Mobie 結算標記失敗，請重試。', error)
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
          replaceRosterCaptureMarker(markers, { ...marker, leftResultAt: this.now() }),
          identity,
        ))
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, '保存收服 Result 離場標記失敗，請重試。', error)
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async applySerialized(
    identity: ResultIdentity,
    payload: RosterCapturePayload,
  ): Promise<RosterCaptureReceipt> {
    let markers: RosterCaptureMarker[]
    try {
      markers = await this.persistence.loadMarkers()
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '讀取收服 Mobie 結算標記失敗，請重試。', cause)
    }
    const existing = markers.find((item) => item.resultId === identity.resultId)
    if (existing && existing.resultFingerprint !== identity.resultFingerprint) collision(identity)
    if (existing?.status === 'settled') {
      return { ...existing.receipt, unit: cloneOwnedUnit(existing.receipt.unit), status: 'already-applied' }
    }

    let roster: OwnedUnit[]
    try {
      roster = (await this.persistence.loadRoster()).map(cloneOwnedUnit)
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '讀取 canonical roster 失敗，請重試。', cause)
    }

    if (existing) {
      const canonicalUnit = roster.find((unit) => unit.id === existing.unit.id)
      if (existing.canonicalApplied !== true && !canonicalUnit) {
        try {
          await this.persistence.savePending(
            [...roster, cloneOwnedUnit(existing.unit)],
            markers,
            identity.resultId,
          )
          existing.canonicalApplied = true
        } catch (cause) {
          throw new ResultSettlementError('storage', identity, '恢復收服 Mobie 資料失敗，請重試。', cause)
        }
      } else if (existing.canonicalApplied !== true) {
        // A scanner/import may have supplied the same canonical id while the
        // receipt was pending. Preserve that unit and finalize the marker.
        existing.canonicalApplied = true
      }
      const settled: RosterCaptureMarker = {
        ...existing,
        status: 'settled',
        settledAt: existing.settledAt ?? this.now(),
      }
      try {
        await this.persistence.saveMarkers(replaceRosterCaptureMarker(markers, settled))
      } catch (cause) {
        throw new ResultSettlementError('receipt', identity, '收服 Mobie 已寫入，但回條保存失敗；請重試以完成對帳。', cause)
      }
      return { ...existing.receipt, unit: cloneOwnedUnit(existing.receipt.unit), status: 'already-applied' }
    }

    const unit = createOwnedUnit(payload.card.cardId, payload.card.speciesId, payload.card.level, payload.card)
    const canonicalUnit = roster.find((item) => item.id === unit.id)
    const appliedUnit = canonicalUnit ?? unit
    const appliedAt = this.now()
    const receipt = rosterCaptureReceipt(identity, appliedUnit, appliedAt, 'applied')
    const pending = rosterCaptureMarkerFor(identity, receipt, payload, appliedUnit, appliedAt, 'pending')
    try {
      await this.persistence.savePending(
        canonicalUnit ? roster : [...roster, unit],
        replaceRosterCaptureMarker(markers, pending),
        identity.resultId,
      )
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '保存收服 Mobie 結果失敗，請重試。', cause)
    }
    pending.canonicalApplied = true
    const settled = rosterCaptureMarkerFor(identity, receipt, payload, appliedUnit, appliedAt, 'settled', pending)
    try {
      await this.persistence.saveMarkers(replaceRosterCaptureMarker(markers, settled))
    } catch (cause) {
      throw new ResultSettlementError('receipt', identity, '收服 Mobie 已寫入，但回條保存失敗；請重試以完成對帳。', cause)
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
    ...(meta.achievementClaims
      ? {
          achievementClaims: meta.achievementClaims.map((claim: AchievementClaimOutbox) => ({
            ...claim,
            reward: claim.reward.kind === 'egg'
              ? { kind: 'egg' as const, label: claim.reward.label, speciesPool: [...claim.reward.speciesPool] }
              : { kind: 'sp' as const, label: claim.reward.label, amount: claim.reward.amount },
            ...(claim.rewardReceipt
              ? {
                  rewardReceipt: {
                    ...claim.rewardReceipt,
                    reward: claim.rewardReceipt.reward.kind === 'egg'
                      ? { kind: 'egg' as const, label: claim.rewardReceipt.reward.label, speciesPool: [...claim.rewardReceipt.reward.speciesPool] }
                      : { kind: 'sp' as const, label: claim.rewardReceipt.reward.label, amount: claim.rewardReceipt.reward.amount },
                    ...(claim.rewardReceipt.egg
                      ? { egg: { ...claim.rewardReceipt.egg, speciesPool: [...claim.rewardReceipt.egg.speciesPool] } }
                      : {}),
                  },
                }
              : {}),
          })),
        }
      : {}),
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
          identity,
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

/** Existing Result win/evolution Meta child destination. Capture has its own marker namespace below. */
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
          identity,
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

function replaceCaptureMetaMarker(
  markers: readonly CaptureMetaMarker[],
  marker: CaptureMetaMarker,
): CaptureMetaMarker[] {
  const index = markers.findIndex((item) => item.resultId === marker.resultId)
  const next = [...markers]
  if (index < 0) next.push(marker)
  else next[index] = marker
  return next
}

function captureMetaReceipt(
  identity: ResultIdentity,
  payload: CaptureMetaPayload,
  meta: MetaState,
  appliedAt: number,
  status: CaptureMetaReceipt['status'],
): CaptureMetaReceipt {
  return {
    ...identity,
    status,
    speciesId: payload.speciesId,
    shiny: payload.shiny,
    outcome: payload.outcome,
    meta: cloneMeta(meta),
    appliedAt,
  }
}

function captureMetaMarkerFor(
  identity: ResultIdentity,
  receipt: CaptureMetaReceipt,
  payload: CaptureMetaPayload,
  before: MetaState,
  after: MetaState,
  now: number,
  status: ResultMarkerStatus,
  previous?: CaptureMetaMarker,
): CaptureMetaMarker {
  return {
    ...identity,
    destination: 'meta-capture',
    status,
    createdAt: previous?.createdAt ?? now,
    ...(status === 'settled' ? { settledAt: previous?.settledAt ?? now } : {}),
    ...(previous?.leftResultAt === undefined ? {} : { leftResultAt: previous.leftResultAt }),
    canonicalApplied: previous?.canonicalApplied ?? false,
    payload: { ...payload },
    before: cloneMeta(previous?.before ?? before),
    after: cloneMeta(previous?.after ?? after),
    receipt: {
      resultId: receipt.resultId,
      resultFingerprint: receipt.resultFingerprint,
      speciesId: receipt.speciesId,
      shiny: receipt.shiny,
      outcome: receipt.outcome,
      meta: cloneMeta(receipt.meta),
      appliedAt: receipt.appliedAt,
    },
  }
}

/** Pure capture/Dex update owned by the capture Meta child. */
export function calculateCaptureMeta(meta: MetaState, payload: CaptureMetaPayload): MetaState {
  let next = addRegistered(meta, [payload.speciesId])
  next = bumpStat(next, 'captures')
  if (payload.shiny) next = bumpStat(next, 'shinies')
  return next
}

/** Durable capture/Dex Meta child; separate from the existing Result win child. */
export class CaptureMetaDestination {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly persistence: CaptureMetaPersistence,
    private readonly now: () => number = () => Date.now(),
  ) {}

  applyOnce(identity: ResultIdentity, payload: CaptureMetaPayload): Promise<CaptureMetaReceipt> {
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
        throw new ResultSettlementError('storage', identity, '讀取捕獲圖鑑結算標記失敗，請重試。', error)
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
          replaceCaptureMetaMarker(markers, { ...marker, leftResultAt: this.now() }),
          identity,
        ))
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, '保存捕獲圖鑑 Result 離場標記失敗，請重試。', error)
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async applySerialized(identity: ResultIdentity, payload: CaptureMetaPayload): Promise<CaptureMetaReceipt> {
    let markers: CaptureMetaMarker[]
    try {
      markers = await this.persistence.loadMarkers()
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '讀取捕獲圖鑑結算標記失敗，請重試。', cause)
    }
    const existing = markers.find((item) => item.resultId === identity.resultId)
    if (existing && existing.resultFingerprint !== identity.resultFingerprint) collision(identity)
    if (existing?.status === 'settled') {
      return {
        ...existing.receipt,
        meta: cloneMeta(existing.receipt.meta),
        status: 'already-applied',
      }
    }

    let meta: MetaState
    try {
      meta = cloneMeta(await this.persistence.loadMeta())
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '讀取 canonical Meta 失敗，請重試。', cause)
    }

    if (existing) {
      if (existing.canonicalApplied !== true) {
        const reconciled = calculateCaptureMeta(meta, existing.payload)
        try {
          await this.persistence.savePending(reconciled, markers, identity.resultId)
          existing.canonicalApplied = true
        } catch (cause) {
          throw new ResultSettlementError('storage', identity, '恢復捕獲圖鑑資料失敗，請重試。', cause)
        }
      }
      const settled: CaptureMetaMarker = {
        ...existing,
        status: 'settled',
        settledAt: existing.settledAt ?? this.now(),
      }
      try {
        await this.persistence.saveMarkers(replaceCaptureMetaMarker(markers, settled))
      } catch (cause) {
        throw new ResultSettlementError('receipt', identity, '捕獲圖鑑已寫入，但回條保存失敗；請重試以完成對帳。', cause)
      }
      return {
        ...existing.receipt,
        meta: cloneMeta(existing.receipt.meta),
        status: 'already-applied',
      }
    }

    const normalized: CaptureMetaPayload = {
      speciesId: Number.isFinite(payload.speciesId) ? Math.max(1, Math.floor(payload.speciesId)) : 1,
      shiny: payload.shiny === true,
      outcome: payload.outcome === 'captured-duplicate-egg' ? 'captured-duplicate-egg' : 'captured-new',
    }
    const after = calculateCaptureMeta(meta, normalized)
    const appliedAt = this.now()
    const receipt = captureMetaReceipt(identity, normalized, after, appliedAt, 'applied')
    const pending = captureMetaMarkerFor(identity, receipt, normalized, meta, after, appliedAt, 'pending')
    try {
      await this.persistence.savePending(after, replaceCaptureMetaMarker(markers, pending), identity.resultId)
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '保存捕獲圖鑑結果失敗，請重試。', cause)
    }
    pending.canonicalApplied = true
    const settled = captureMetaMarkerFor(identity, receipt, normalized, meta, after, appliedAt, 'settled', pending)
    try {
      await this.persistence.saveMarkers(replaceCaptureMetaMarker(markers, settled))
    } catch (cause) {
      throw new ResultSettlementError('receipt', identity, '捕獲圖鑑已寫入，但回條保存失敗；請重試以完成對帳。', cause)
    }
    return receipt
  }
}

function cloneTowerProgressionState(state: TowerProgressionState): TowerProgressionState {
  return {
    bestFloor: Number.isFinite(state.bestFloor) ? Math.max(0, Math.floor(state.bestFloor)) : 0,
    ascensionUnlocked: Number.isFinite(state.ascensionUnlocked)
      ? Math.max(0, Math.min(ASCENSIONS.length - 1, Math.floor(state.ascensionUnlocked)))
      : 0,
  }
}

function normalizeTowerPayload(payload: TowerProgressionPayload): TowerProgressionPayload {
  return {
    floor: Number.isFinite(payload.floor) ? Math.max(1, Math.floor(payload.floor)) : 1,
    ascension: Number.isFinite(payload.ascension)
      ? Math.max(0, Math.min(ASCENSIONS.length - 1, Math.floor(payload.ascension)))
      : 0,
    outcome: payload.outcome === 'win' ? 'win' : 'lose',
  }
}

/** Pure tower metadata update used by the tower child boundary. */
export function calculateTowerProgression(
  run: TowerProgressionState,
  payload: TowerProgressionPayload,
): { run: TowerProgressionState; payload: TowerProgressionPayload } {
  const before = cloneTowerProgressionState(run)
  const normalized = normalizeTowerPayload(payload)
  const reachedFloor = normalized.outcome === 'win' ? normalized.floor : Math.max(0, normalized.floor - 1)
  const unlocked = normalized.outcome === 'win' && isBossFloor(normalized.floor)
    ? Math.min(ASCENSIONS.length - 1, normalized.ascension + 1)
    : 0
  return {
    payload: normalized,
    run: {
      bestFloor: Math.max(before.bestFloor, reachedFloor),
      ascensionUnlocked: Math.max(before.ascensionUnlocked, unlocked),
    },
  }
}

function towerProgressionReceipt(
  identity: ResultIdentity,
  payload: TowerProgressionPayload,
  before: TowerProgressionState,
  after: TowerProgressionState,
  appliedAt: number,
  status: TowerProgressionReceipt['status'],
): TowerProgressionReceipt {
  return {
    ...identity,
    status,
    floor: payload.floor,
    ascension: payload.ascension,
    outcome: payload.outcome,
    before: cloneTowerProgressionState(before),
    after: cloneTowerProgressionState(after),
    appliedAt,
  }
}

function replaceTowerMarker(
  markers: readonly TowerProgressionMarker[],
  marker: TowerProgressionMarker,
): TowerProgressionMarker[] {
  const index = markers.findIndex((item) => item.resultId === marker.resultId)
  const next = [...markers]
  if (index < 0) next.push(marker)
  else next[index] = marker
  return next
}

function towerMarkerFor(
  identity: ResultIdentity,
  receipt: TowerProgressionReceipt,
  payload: TowerProgressionPayload,
  before: TowerProgressionState,
  after: TowerProgressionState,
  now: number,
  status: ResultMarkerStatus,
  previous?: TowerProgressionMarker,
): TowerProgressionMarker {
  return {
    ...identity,
    destination: 'tower-progression',
    status,
    createdAt: previous?.createdAt ?? now,
    ...(status === 'settled' ? { settledAt: previous?.settledAt ?? now } : {}),
    ...(previous?.leftResultAt === undefined ? {} : { leftResultAt: previous.leftResultAt }),
    canonicalApplied: previous?.canonicalApplied ?? false,
    payload: { ...payload },
    before: cloneTowerProgressionState(previous?.before ?? before),
    after: cloneTowerProgressionState(previous?.after ?? after),
    receipt: {
      resultId: receipt.resultId,
      resultFingerprint: receipt.resultFingerprint,
      floor: receipt.floor,
      ascension: receipt.ascension,
      outcome: receipt.outcome,
      before: cloneTowerProgressionState(receipt.before),
      after: cloneTowerProgressionState(receipt.after),
      appliedAt: receipt.appliedAt,
    },
  }
}

/** Durable Result child for monotonic Tower floor/unlock metadata. */
export class TowerProgressionDestination {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly persistence: TowerProgressionPersistence,
    private readonly now: () => number = () => Date.now(),
  ) {}

  applyOnce(identity: ResultIdentity, payload: TowerProgressionPayload): Promise<TowerProgressionReceipt> {
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
        throw new ResultSettlementError('storage', identity, '讀取連勝塔結算標記失敗，請重試。', error)
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
          replaceTowerMarker(markers, { ...marker, leftResultAt: this.now() }),
          identity,
        ))
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, '保存連勝塔 Result 離場標記失敗，請重試。', error)
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async applySerialized(
    identity: ResultIdentity,
    payload: TowerProgressionPayload,
  ): Promise<TowerProgressionReceipt> {
    let markers: TowerProgressionMarker[]
    try {
      markers = await this.persistence.loadMarkers()
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '讀取連勝塔結算標記失敗，請重試。', cause)
    }
    const existing = markers.find((item) => item.resultId === identity.resultId)
    if (existing && existing.resultFingerprint !== identity.resultFingerprint) collision(identity)
    if (existing?.status === 'settled') {
      return {
        ...existing.receipt,
        before: cloneTowerProgressionState(existing.receipt.before),
        after: cloneTowerProgressionState(existing.receipt.after),
        status: 'already-applied',
      }
    }

    let run: TowerProgressionState
    try {
      run = cloneTowerProgressionState(await this.persistence.loadRun())
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '讀取 canonical 連勝塔進度失敗，請重試。', cause)
    }

    if (existing) {
      if (existing.canonicalApplied !== true) {
        const reconciled = {
          bestFloor: Math.max(run.bestFloor, existing.after.bestFloor),
          ascensionUnlocked: Math.max(run.ascensionUnlocked, existing.after.ascensionUnlocked),
        }
        try {
          await this.persistence.savePending(reconciled, markers, identity.resultId)
          existing.canonicalApplied = true
        } catch (cause) {
          throw new ResultSettlementError('storage', identity, '恢復連勝塔結算資料失敗，請重試。', cause)
        }
      }
      const settled: TowerProgressionMarker = {
        ...existing,
        status: 'settled',
        settledAt: existing.settledAt ?? this.now(),
      }
      try {
        await this.persistence.saveMarkers(replaceTowerMarker(markers, settled))
      } catch (cause) {
        throw new ResultSettlementError('receipt', identity, '連勝塔進度已寫入，但回條保存失敗；請重試以完成對帳。', cause)
      }
      return {
        ...existing.receipt,
        before: cloneTowerProgressionState(existing.receipt.before),
        after: cloneTowerProgressionState(existing.receipt.after),
        status: 'already-applied',
      }
    }

    let calculated: { run: TowerProgressionState; payload: TowerProgressionPayload }
    try {
      calculated = calculateTowerProgression(run, payload)
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '連勝塔結算資料無效，請重試。', cause)
    }
    const appliedAt = this.now()
    const receipt = towerProgressionReceipt(identity, calculated.payload, run, calculated.run, appliedAt, 'applied')
    const pending = towerMarkerFor(
      identity,
      receipt,
      calculated.payload,
      run,
      calculated.run,
      appliedAt,
      'pending',
    )
    try {
      await this.persistence.savePending(calculated.run, replaceTowerMarker(markers, pending), identity.resultId)
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '保存連勝塔結算結果失敗，請重試。', cause)
    }
    pending.canonicalApplied = true
    const settled = towerMarkerFor(
      identity,
      receipt,
      calculated.payload,
      run,
      calculated.run,
      appliedAt,
      'settled',
      pending,
    )
    try {
      await this.persistence.saveMarkers(replaceTowerMarker(markers, settled))
    } catch (cause) {
      throw new ResultSettlementError('receipt', identity, '連勝塔進度已寫入，但回條保存失敗；請重試以完成對帳。', cause)
    }
    return receipt
  }
}

function cloneEgg(egg: Egg): Egg {
  return {
    ...egg,
    speciesPool: [...egg.speciesPool],
  }
}

function cloneIncubatorState(state: IncubatorState): IncubatorState {
  const cloneHatchOutbox = (entry: HatchOutbox): HatchOutbox => ({
    ...entry,
    egg: cloneEgg(entry.egg),
    payload: {
      ...entry.payload,
      egg: cloneEgg(entry.payload.egg),
      unit: cloneOwnedUnit(entry.payload.unit),
    },
    ...(entry.receipt ? {
      receipt: {
        ...entry.receipt,
        egg: cloneEgg(entry.receipt.egg),
        unit: cloneOwnedUnit(entry.receipt.unit),
        roster: {
          ...entry.receipt.roster,
          unit: cloneOwnedUnit(entry.receipt.roster.unit),
        },
        meta: {
          ...entry.receipt.meta,
          meta: cloneMeta(entry.receipt.meta.meta),
        },
      },
    } : {}),
  })
  return {
    schemaVersion: state.schemaVersion,
    nextId: state.nextId,
    eggs: state.eggs.map(cloneEgg),
    ...(state.achievementClaims
      ? {
          achievementClaims: state.achievementClaims.map((claim: AchievementRewardMarker) => ({
            ...claim,
            reward: claim.reward.kind === 'egg'
              ? { kind: 'egg' as const, label: claim.reward.label, speciesPool: [...claim.reward.speciesPool] }
              : { kind: 'sp' as const, label: claim.reward.label, amount: claim.reward.amount },
            receipt: {
              ...claim.receipt,
              reward: claim.receipt.reward.kind === 'egg'
                ? { kind: 'egg' as const, label: claim.receipt.reward.label, speciesPool: [...claim.receipt.reward.speciesPool] }
                : { kind: 'sp' as const, label: claim.receipt.reward.label, amount: claim.receipt.reward.amount },
              ...(claim.receipt.egg
                ? { egg: { ...claim.receipt.egg, speciesPool: [...claim.receipt.egg.speciesPool] } }
                : {}),
            },
          })),
        }
      : {}),
    ...(state.hatchOutbox ? { hatchOutbox: state.hatchOutbox.map(cloneHatchOutbox) } : {}),
  }
}

function normalizedProgressAmount(amount: number): number {
  return Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0
}

function invalidIncubatorSource(identity: ResultIdentity, source: string): never {
  throw new ResultSettlementError(
    'invalid-source',
    identity,
    `孵化進度來源無效：${source}；只接受 achievement 或 duplicate。`,
  )
}

/** Pure incubator progress update. It only advances already-existing supported eggs. */
export function calculateIncubatorProgression(
  state: IncubatorState,
  payload: IncubatorProgressionPayload,
): { state: IncubatorState; amount: number; updates: IncubatorProgressUpdate[] } {
  const amount = normalizedProgressAmount(payload.amount)
  const updates: IncubatorProgressUpdate[] = []
  const next = cloneIncubatorState(state)
  next.eggs = next.eggs.map((egg) => {
    if (!isSupportedEggSource(egg.source)) return egg
    if (payload.source !== undefined && payload.source !== egg.source) return egg
    const beforeProgress = Math.max(0, Math.floor(egg.progress))
    const afterProgress = Math.min(egg.requiredProgress, beforeProgress + amount)
    if (afterProgress !== beforeProgress) {
      updates.push({ eggId: egg.id, source: egg.source, beforeProgress, afterProgress })
    }
    return { ...egg, progress: afterProgress }
  })
  return { state: next, amount, updates }
}

function mergeIncubatorProgress(
  state: IncubatorState,
  updates: readonly IncubatorProgressUpdate[],
): IncubatorState {
  const byId = new Map(updates.map((update) => [update.eggId, update]))
  return {
    ...cloneIncubatorState(state),
    eggs: state.eggs.map((egg) => {
      const update = byId.get(egg.id)
      if (!update || !isSupportedEggSource(egg.source)) return cloneEgg(egg)
      return { ...egg, progress: Math.max(egg.progress, Math.min(egg.requiredProgress, update.afterProgress)) }
    }),
  }
}

function cloneProgressUpdates(updates: readonly IncubatorProgressUpdate[]): IncubatorProgressUpdate[] {
  return updates.map((update) => ({ ...update }))
}

function incubatorProgressionReceipt(
  identity: ResultIdentity,
  amount: number,
  updates: readonly IncubatorProgressUpdate[],
  appliedAt: number,
  status: IncubatorProgressionReceipt['status'],
): IncubatorProgressionReceipt {
  return {
    ...identity,
    status,
    amount,
    updates: cloneProgressUpdates(updates),
    appliedAt,
  }
}

function replaceIncubatorMarker(
  markers: readonly IncubatorProgressionMarker[],
  marker: IncubatorProgressionMarker,
): IncubatorProgressionMarker[] {
  const index = markers.findIndex((item) => item.resultId === marker.resultId)
  const next = [...markers]
  if (index < 0) next.push(marker)
  else next[index] = marker
  return next
}

function incubatorMarkerFor(
  identity: ResultIdentity,
  receipt: IncubatorProgressionReceipt,
  payload: IncubatorProgressionPayload,
  updates: readonly IncubatorProgressUpdate[],
  now: number,
  status: ResultMarkerStatus,
  previous?: IncubatorProgressionMarker,
): IncubatorProgressionMarker {
  return {
    ...identity,
    destination: 'incubator-progression',
    status,
    createdAt: previous?.createdAt ?? now,
    ...(status === 'settled' ? { settledAt: previous?.settledAt ?? now } : {}),
    ...(previous?.leftResultAt === undefined ? {} : { leftResultAt: previous.leftResultAt }),
    canonicalApplied: previous?.canonicalApplied ?? false,
    payload: { ...payload },
    updates: cloneProgressUpdates(previous?.updates ?? updates),
    receipt: {
      resultId: receipt.resultId,
      resultFingerprint: receipt.resultFingerprint,
      amount: receipt.amount,
      updates: cloneProgressUpdates(receipt.updates),
      appliedAt: receipt.appliedAt,
    },
  }
}

/** Durable Result child for progress on already-created achievement/duplicate eggs. */
export class IncubatorProgressionDestination {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly persistence: IncubatorProgressionPersistence,
    private readonly now: () => number = () => Date.now(),
  ) {}

  applyOnce(identity: ResultIdentity, payload: IncubatorProgressionPayload): Promise<IncubatorProgressionReceipt> {
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
        throw new ResultSettlementError('storage', identity, '讀取孵化進度結算標記失敗，請重試。', error)
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
          replaceIncubatorMarker(markers, { ...marker, leftResultAt: this.now() }),
          identity,
        ))
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, '保存孵化進度 Result 離場標記失敗，請重試。', error)
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async applySerialized(
    identity: ResultIdentity,
    payload: IncubatorProgressionPayload,
  ): Promise<IncubatorProgressionReceipt> {
    let markers: IncubatorProgressionMarker[]
    try {
      markers = await this.persistence.loadMarkers()
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '讀取孵化進度結算標記失敗，請重試。', cause)
    }
    const existing = markers.find((item) => item.resultId === identity.resultId)
    if (existing && existing.resultFingerprint !== identity.resultFingerprint) collision(identity)
    if (payload.source !== undefined && !isSupportedEggSource(payload.source)) {
      invalidIncubatorSource(identity, payload.source)
    }
    if (existing?.status === 'settled') {
      return {
        ...existing.receipt,
        updates: cloneProgressUpdates(existing.receipt.updates),
        status: 'already-applied',
      }
    }

    let state: IncubatorState
    try {
      state = cloneIncubatorState(await this.persistence.loadState())
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '讀取 canonical 孵化所進度失敗，請重試。', cause)
    }

    if (existing) {
      if (existing.canonicalApplied !== true) {
        const reconciled = mergeIncubatorProgress(state, existing.updates)
        try {
          await this.persistence.savePending(reconciled, markers, identity.resultId)
          existing.canonicalApplied = true
        } catch (cause) {
          throw new ResultSettlementError('storage', identity, '恢復孵化進度結算資料失敗，請重試。', cause)
        }
      }
      const settled: IncubatorProgressionMarker = {
        ...existing,
        status: 'settled',
        settledAt: existing.settledAt ?? this.now(),
      }
      try {
        await this.persistence.saveMarkers(replaceIncubatorMarker(markers, settled))
      } catch (cause) {
        throw new ResultSettlementError('receipt', identity, '孵化進度已寫入，但回條保存失敗；請重試以完成對帳。', cause)
      }
      return {
        ...existing.receipt,
        updates: cloneProgressUpdates(existing.receipt.updates),
        status: 'already-applied',
      }
    }

    const calculated = calculateIncubatorProgression(state, payload)
    const appliedAt = this.now()
    const receipt = incubatorProgressionReceipt(identity, calculated.amount, calculated.updates, appliedAt, 'applied')
    const normalizedPayload: IncubatorProgressionPayload = {
      amount: calculated.amount,
      ...(payload.source !== undefined ? { source: payload.source } : {}),
    }
    const pending = incubatorMarkerFor(
      identity,
      receipt,
      normalizedPayload,
      calculated.updates,
      appliedAt,
      'pending',
    )
    try {
      await this.persistence.savePending(calculated.state, replaceIncubatorMarker(markers, pending), identity.resultId)
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '保存孵化進度結果失敗，請重試。', cause)
    }
    pending.canonicalApplied = true
    const settled = incubatorMarkerFor(
      identity,
      receipt,
      normalizedPayload,
      calculated.updates,
      appliedAt,
      'settled',
      pending,
    )
    try {
      await this.persistence.saveMarkers(replaceIncubatorMarker(markers, settled))
    } catch (cause) {
      throw new ResultSettlementError('receipt', identity, '孵化進度已寫入，但回條保存失敗；請重試以完成對帳。', cause)
    }
    return receipt
  }
}

function replaceDuplicateEggMarker(
  markers: readonly DuplicateEggMarker[],
  marker: DuplicateEggMarker,
): DuplicateEggMarker[] {
  const index = markers.findIndex((item) => item.resultId === marker.resultId)
  const next = [...markers]
  if (index < 0) next.push(marker)
  else next[index] = marker
  return next
}

function cloneDuplicateEggPayload(payload: DuplicateEggPayload): DuplicateEggPayload {
  return {
    speciesId: payload.speciesId,
    label: payload.label,
    ...(payload.inheritedMoveId === undefined ? {} : { inheritedMoveId: payload.inheritedMoveId }),
  }
}

function normalizeDuplicateEggPayload(payload: DuplicateEggPayload): DuplicateEggPayload {
  return {
    speciesId: Number.isFinite(payload.speciesId) ? Math.max(1, Math.floor(payload.speciesId)) : 1,
    label: typeof payload.label === 'string' && payload.label.length > 0 ? payload.label : '重複轉化蛋',
    ...(Number.isInteger(payload.inheritedMoveId) && (payload.inheritedMoveId as number) > 0
      ? { inheritedMoveId: payload.inheritedMoveId }
      : {}),
  }
}

/** Pure duplicate-capture egg creation. */
export function calculateDuplicateEgg(
  state: IncubatorState,
  payload: DuplicateEggPayload,
): { state: IncubatorState; egg: Egg } {
  const normalized = normalizeDuplicateEggPayload(payload)
  const next = addEgg(state, {
    source: 'duplicate',
    speciesPool: [normalized.speciesId],
    label: normalized.label,
    ...(normalized.inheritedMoveId === undefined ? {} : { inheritedMoveId: normalized.inheritedMoveId }),
  })
  const egg = next.eggs.at(-1)
  if (!egg || next === state) throw new Error('duplicate egg payload did not create an egg')
  return { state: next, egg: cloneEgg(egg) }
}

function duplicateEggReceipt(
  identity: ResultIdentity,
  egg: Egg,
  appliedAt: number,
  status: DuplicateEggReceipt['status'],
): DuplicateEggReceipt {
  return { ...identity, status, egg: cloneEgg(egg), appliedAt }
}

function duplicateEggMarkerFor(
  identity: ResultIdentity,
  receipt: DuplicateEggReceipt,
  payload: DuplicateEggPayload,
  egg: Egg,
  now: number,
  status: ResultMarkerStatus,
  previous?: DuplicateEggMarker,
): DuplicateEggMarker {
  return {
    ...identity,
    destination: 'incubator-capture',
    status,
    createdAt: previous?.createdAt ?? now,
    ...(status === 'settled' ? { settledAt: previous?.settledAt ?? now } : {}),
    ...(previous?.leftResultAt === undefined ? {} : { leftResultAt: previous.leftResultAt }),
    canonicalApplied: previous?.canonicalApplied ?? false,
    payload: cloneDuplicateEggPayload(payload),
    egg: cloneEgg(previous?.egg ?? egg),
    receipt: {
      resultId: receipt.resultId,
      resultFingerprint: receipt.resultFingerprint,
      egg: cloneEgg(receipt.egg),
      appliedAt: receipt.appliedAt,
    },
  }
}

/** Durable duplicate-capture child; this is the only writer that creates the egg. */
export class DuplicateEggDestination {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly persistence: DuplicateEggPersistence,
    private readonly now: () => number = () => Date.now(),
  ) {}

  applyOnce(identity: ResultIdentity, payload: DuplicateEggPayload): Promise<DuplicateEggReceipt> {
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
        throw new ResultSettlementError('storage', identity, '讀取重複蛋結算標記失敗，請重試。', error)
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
          replaceDuplicateEggMarker(markers, { ...marker, leftResultAt: this.now() }),
          identity,
        ))
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, '保存重複蛋 Result 離場標記失敗，請重試。', error)
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async applySerialized(identity: ResultIdentity, payload: DuplicateEggPayload): Promise<DuplicateEggReceipt> {
    let markers: DuplicateEggMarker[]
    try {
      markers = await this.persistence.loadMarkers()
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '讀取重複蛋結算標記失敗，請重試。', cause)
    }
    const existing = markers.find((item) => item.resultId === identity.resultId)
    if (existing && existing.resultFingerprint !== identity.resultFingerprint) collision(identity)
    if (existing?.status === 'settled') {
      return { ...existing.receipt, egg: cloneEgg(existing.receipt.egg), status: 'already-applied' }
    }

    let state: IncubatorState
    try {
      state = cloneIncubatorState(await this.persistence.loadState())
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '讀取 canonical 孵化所資料失敗，請重試。', cause)
    }

    if (existing) {
      const canonicalEgg = state.eggs.find((egg) => egg.id === existing.egg.id)
      if (existing.canonicalApplied !== true && !canonicalEgg) {
        try {
          const reconciled: IncubatorState = {
            ...state,
            eggs: [...state.eggs.map(cloneEgg), cloneEgg(existing.egg)],
            nextId: Math.max(state.nextId, Number(existing.egg.id.replace(/^egg-/, '')) + 1 || state.nextId),
          }
          await this.persistence.savePending(reconciled, markers, identity.resultId)
          existing.canonicalApplied = true
        } catch (cause) {
          throw new ResultSettlementError('storage', identity, '恢復重複蛋資料失敗，請重試。', cause)
        }
      } else if (existing.canonicalApplied !== true) {
        existing.canonicalApplied = true
      }
      const settled: DuplicateEggMarker = {
        ...existing,
        status: 'settled',
        settledAt: existing.settledAt ?? this.now(),
      }
      try {
        await this.persistence.saveMarkers(replaceDuplicateEggMarker(markers, settled))
      } catch (cause) {
        throw new ResultSettlementError('receipt', identity, '重複蛋已寫入，但回條保存失敗；請重試以完成對帳。', cause)
      }
      return { ...existing.receipt, egg: cloneEgg(existing.receipt.egg), status: 'already-applied' }
    }

    const normalized = normalizeDuplicateEggPayload(payload)
    let calculated: { state: IncubatorState; egg: Egg }
    try {
      calculated = calculateDuplicateEgg(state, normalized)
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '重複蛋資料無效，請重試。', cause)
    }
    const appliedAt = this.now()
    const receipt = duplicateEggReceipt(identity, calculated.egg, appliedAt, 'applied')
    const pending = duplicateEggMarkerFor(identity, receipt, normalized, calculated.egg, appliedAt, 'pending')
    try {
      await this.persistence.savePending(
        calculated.state,
        replaceDuplicateEggMarker(markers, pending),
        identity.resultId,
      )
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '保存重複蛋結果失敗，請重試。', cause)
    }
    pending.canonicalApplied = true
    const settled = duplicateEggMarkerFor(identity, receipt, normalized, calculated.egg, appliedAt, 'settled', pending)
    try {
      await this.persistence.saveMarkers(replaceDuplicateEggMarker(markers, settled))
    } catch (cause) {
      throw new ResultSettlementError('receipt', identity, '重複蛋已寫入，但回條保存失敗；請重試以完成對帳。', cause)
    }
    return receipt
  }
}

export interface CaptureSettlementDependencies {
  loadRoster: () => Promise<OwnedUnit[]>
  roster: RosterCaptureDestination
  meta: CaptureMetaDestination
  duplicateEgg: DuplicateEggDestination
}

function capturePlanFor(
  identity: ResultIdentity,
  payload: CaptureSettlementPayload,
  roster: readonly OwnedUnit[],
): CaptureSettlementPlan {
  const normalizedPayload: CaptureSettlementPayload = {
    target: cloneCard(payload.target),
    captureMult: payload.captureMult,
  }
  const decision = deterministicCaptureDecision(identity, normalizedPayload)
  if (!decision.caught) {
    return {
      ...identity,
      payload: normalizedPayload,
      decision,
      outcome: 'escaped',
    }
  }

  const wild = buildBattleMobie(normalizedPayload.target)
  const alreadyOwned = roster.some((unit) => unit.speciesId === normalizedPayload.target.speciesId)
  if (alreadyOwned) {
    const inheritedMoveId = wild.moves.length > 1 ? wild.moves[wild.moves.length - 1]?.id : undefined
    return {
      ...identity,
      payload: normalizedPayload,
      decision,
      outcome: 'captured-duplicate-egg',
      meta: {
        speciesId: normalizedPayload.target.speciesId,
        shiny: wild.shiny,
        outcome: 'captured-duplicate-egg',
      },
      duplicateEgg: {
        speciesId: normalizedPayload.target.speciesId,
        label: `${wild.nameZh} 蛋`,
        ...(inheritedMoveId === undefined ? {} : { inheritedMoveId }),
      },
    }
  }

  return {
    ...identity,
    payload: normalizedPayload,
    decision,
    outcome: 'captured-new',
    roster: { card: cloneCard(normalizedPayload.target) },
    meta: {
      speciesId: normalizedPayload.target.speciesId,
      shiny: wild.shiny,
      outcome: 'captured-new',
    },
  }
}

/** Pure plan builder exposed for deterministic decision tests and diagnostics. */
export function planCaptureSettlement(
  identity: ResultIdentity,
  payload: CaptureSettlementPayload,
  roster: readonly OwnedUnit[],
): CaptureSettlementPlan {
  return capturePlanFor(identity, payload, roster)
}

function cloneCapturePlan(plan: CaptureSettlementPlan): CaptureSettlementPlan {
  return {
    ...plan,
    payload: { target: cloneCard(plan.payload.target), captureMult: plan.payload.captureMult },
    decision: { ...plan.decision },
    ...(plan.roster ? { roster: { card: cloneCard(plan.roster.card) } } : {}),
    ...(plan.meta ? { meta: { ...plan.meta } } : {}),
    ...(plan.duplicateEgg ? { duplicateEgg: cloneDuplicateEggPayload(plan.duplicateEgg) } : {}),
  }
}

function cloneCaptureReceipt(receipt: CaptureSettlementReceipt): CaptureSettlementReceipt {
  return {
    ...receipt,
    target: cloneCard(receipt.target),
    decision: { ...receipt.decision },
    ...(receipt.unit ? { unit: cloneOwnedUnit(receipt.unit) } : {}),
    ...(receipt.egg ? { egg: cloneEgg(receipt.egg) } : {}),
    ...(receipt.rosterCapture
      ? { rosterCapture: { ...receipt.rosterCapture, unit: cloneOwnedUnit(receipt.rosterCapture.unit) } }
      : {}),
    ...(receipt.meta
      ? { meta: { ...receipt.meta, meta: cloneMeta(receipt.meta.meta) } }
      : {}),
    ...(receipt.duplicateEgg
      ? { duplicateEgg: { ...receipt.duplicateEgg, egg: cloneEgg(receipt.duplicateEgg.egg) } }
      : {}),
  }
}

/**
 * Capture child coordinator. It owns deterministic plan selection and invokes
 * each canonical destination independently; it never writes a store itself.
 */
export class CaptureSettlementCoordinator {
  private queue: Promise<unknown> = Promise.resolve()
  private readonly plans = new Map<string, CaptureSettlementPlan>()
  private readonly completed = new Set<string>()

  constructor(
    private readonly dependencies: CaptureSettlementDependencies,
    private readonly now: () => number = () => Date.now(),
  ) {}

  prepare(identity: ResultIdentity, payload: CaptureSettlementPayload): Promise<CaptureSettlementPlan> {
    const run = this.queue.then(async () => {
      const existing = this.plans.get(identity.resultId)
      if (existing) {
        if (existing.resultFingerprint !== identity.resultFingerprint) collision(identity)
        return cloneCapturePlan(existing)
      }
      let roster: OwnedUnit[]
      try {
        roster = await this.dependencies.loadRoster()
      } catch (cause) {
        throw new ResultSettlementError('storage', identity, '讀取收服判定所需 roster 失敗，請重試。', cause)
      }
      const plan = capturePlanFor(identity, payload, roster)
      this.plans.set(identity.resultId, plan)
      return cloneCapturePlan(plan)
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  markResultLeft(identity: ResultIdentity): Promise<void> {
    const run = this.queue.then(async () => {
      const plan = this.plans.get(identity.resultId)
      if (plan && plan.resultFingerprint !== identity.resultFingerprint) collision(identity)
      await this.dependencies.roster.markResultLeft(identity)
      await this.dependencies.meta.markResultLeft(identity)
      await this.dependencies.duplicateEgg.markResultLeft(identity)
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  settle(
    identity: ResultIdentity,
    payload: CaptureSettlementPayload,
    existingPlan?: CaptureSettlementPlan,
  ): Promise<CaptureSettlementReceipt> {
    const run = this.queue.then(async () => {
      let plan: CaptureSettlementPlan
      if (existingPlan) {
        if (existingPlan.resultFingerprint !== identity.resultFingerprint) collision(identity)
        plan = cloneCapturePlan(existingPlan)
        this.plans.set(identity.resultId, plan)
      } else {
        const cached = this.plans.get(identity.resultId)
        if (cached) {
          if (cached.resultFingerprint !== identity.resultFingerprint) collision(identity)
          plan = cloneCapturePlan(cached)
        } else {
          let roster: OwnedUnit[]
          try {
            roster = await this.dependencies.loadRoster()
          } catch (cause) {
            throw new ResultSettlementError('storage', identity, '讀取收服判定所需 roster 失敗，請重試。', cause)
          }
          plan = capturePlanFor(identity, payload, roster)
          this.plans.set(identity.resultId, plan)
        }
      }

      if (plan.outcome === 'escaped') {
        const status: CaptureSettlementReceipt['status'] = this.completed.has(identity.resultId)
          ? 'already-applied'
          : 'applied'
        this.completed.add(identity.resultId)
        return {
          ...identity,
          status,
          decision: { ...plan.decision },
          outcome: plan.outcome,
          target: cloneCard(plan.payload.target),
          appliedAt: this.now(),
        }
      }

      let rosterReceipt: RosterCaptureReceipt | undefined
      if (plan.roster) {
        try {
          rosterReceipt = await this.dependencies.roster.applyOnce(identity, plan.roster)
        } catch (error) {
          if (error instanceof ResultSettlementError) throw error
          throw new ResultSettlementError('storage', identity, '收服 Mobie 子結算失敗，請重試。', error)
        }
      }

      let metaReceipt: CaptureMetaReceipt | undefined
      if (plan.meta) {
        try {
          metaReceipt = await this.dependencies.meta.applyOnce(identity, plan.meta)
        } catch (error) {
          if (error instanceof ResultSettlementError) throw error
          throw new ResultSettlementError('storage', identity, '捕獲圖鑑子結算失敗，請重試。', error)
        }
      }

      let duplicateEggReceipt: DuplicateEggReceipt | undefined
      if (plan.duplicateEgg) {
        try {
          duplicateEggReceipt = await this.dependencies.duplicateEgg.applyOnce(identity, plan.duplicateEgg)
        } catch (error) {
          if (error instanceof ResultSettlementError) throw error
          throw new ResultSettlementError('storage', identity, '重複蛋子結算失敗，請重試。', error)
        }
      }

      const status = [rosterReceipt?.status, metaReceipt?.status, duplicateEggReceipt?.status]
        .some((childStatus) => childStatus === 'already-applied')
        ? 'already-applied' as const
        : 'applied' as const
      this.completed.add(identity.resultId)
      const unit = rosterReceipt?.unit
      const egg = duplicateEggReceipt?.egg
      return cloneCaptureReceipt({
        ...identity,
        status,
        decision: { ...plan.decision },
        outcome: plan.outcome,
        target: cloneCard(plan.payload.target),
        ...(unit ? { unit: cloneOwnedUnit(unit) } : {}),
        ...(egg ? { egg: cloneEgg(egg) } : {}),
        ...(rosterReceipt ? { rosterCapture: rosterReceipt } : {}),
        ...(metaReceipt ? { meta: metaReceipt } : {}),
        ...(duplicateEggReceipt ? { duplicateEgg: duplicateEggReceipt } : {}),
        appliedAt: this.now(),
      })
    })
    this.queue = run.catch(() => undefined)
    return run
  }
}

// Compatibility aliases for callers that use the child-first vocabulary.
export { RosterCaptureDestination as CaptureRosterDestination }
export { CaptureMetaDestination as MetaCaptureDestination }
export { DuplicateEggDestination as IncubatorCaptureDestination }
export type CapturePlan = CaptureSettlementPlan

// Explicit aliases keep the boundary vocabulary readable to future Tickets 32–33 callers.
export { TowerProgressionDestination as TowerSettlementDestination }
export { TowerProgressionDestination as TowerProgressDestination }
export { TowerProgressionDestination as TowerDestination }
export { IncubatorProgressionDestination as IncubatorSettlementDestination }
export { IncubatorProgressionDestination as IncubatorProgressDestination }
export { IncubatorProgressionDestination as IncubatorDestination }
export type TowerSettlementPayload = TowerProgressionPayload
export type IncubatorSettlementPayload = IncubatorProgressionPayload
export type TowerSettlementMarker = TowerProgressionMarker
export type IncubatorSettlementMarker = IncubatorProgressionMarker
export type TowerSettlementPersistence = TowerProgressionPersistence
export type IncubatorSettlementPersistence = IncubatorProgressionPersistence
export type CaptureSettlementPersistence = RosterCapturePersistence
export type MetaCaptureSettlementPersistence = CaptureMetaPersistence
export type DuplicateEggSettlementPersistence = DuplicateEggPersistence

/** Result-level journal; it never mutates the roster and is not exactly-once authority. */
export class ResultSettlementCoordinator {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly destination: RosterGrowthDestination,
    private readonly journal: SettlementJournalPersistence,
    private readonly now: () => number = () => Date.now(),
    private readonly children: ResultSettlementChildren = {},
  ) {}

  /**
   * Prepare the durable presentation decision before any Result child writes.
   *
   * The journal remains orchestration state; the capture destination still
   * owns the canonical mutation. Persisting the plan here means a remount or
   * retry can render the exact same ball/outcome without asking the UI to roll
   * again, even when the first child later fails.
   */
  prepare(
    identity: ResultIdentity,
    payload: ResultSettlementPayload,
  ): Promise<ResultSettlementPreparation> {
    const run = this.queue.then(() => this.prepareSerialized(identity, payload))
    this.queue = run.catch(() => undefined)
    return run
  }

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
            identity,
          ))
          // A failed/pending Result may still have only some children durable.
          // Keep every child marker eligible for reconciliation until the
          // parent journal reaches settled; leave-time pruning is never a
          // proof that a pending mutation was completed.
          if (entry.status !== 'settled') return
        }
        await this.destination.markResultLeft(identity)
        if (this.children.skillPoints) await this.children.skillPoints.markResultLeft(identity)
        if (this.children.meta) await this.children.meta.markResultLeft(identity)
        if (this.children.tower) await this.children.tower.markResultLeft(identity)
        if (this.children.incubator) await this.children.incubator.markResultLeft(identity)
        if (this.children.capture) await this.children.capture.markResultLeft(identity)
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, '保存 Result 離場標記失敗，請重試。', error)
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async prepareSerialized(
    identity: ResultIdentity,
    payload: ResultSettlementPayload,
  ): Promise<ResultSettlementPreparation> {
    let entries: SettlementJournalEntry[]
    try {
      entries = await this.journal.load()
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '讀取 Result 結算進度失敗，請重試。', cause)
    }
    const existing = entries.find((item) => item.resultId === identity.resultId)
    if (existing && existing.resultFingerprint !== identity.resultFingerprint) collision(identity)

    const capturePayload = payload.capture ?? existing?.capturePayload
    if (!capturePayload || !this.children.capture) {
      return {
        ...identity,
        ...(existing?.capturePlan ? { capturePlan: cloneCapturePlan(existing.capturePlan) } : {}),
      }
    }

    let capturePlan = existing?.capturePlan
    if (!capturePlan) {
      try {
        capturePlan = await this.children.capture.prepare(identity, capturePayload)
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, '建立捕獲結算判定失敗，請重試。', error)
      }
    } else if (capturePlan.resultFingerprint !== identity.resultFingerprint) {
      collision(identity)
    }

    // Avoid an unnecessary journal write when the plan is already durable.
    if (existing?.capturePlan) {
      return { ...identity, capturePlan: cloneCapturePlan(capturePlan) }
    }

    const nextEntry: SettlementJournalEntry = existing
      ? {
          ...existing,
          capturePayload,
          capturePlan,
          error: undefined,
        }
      : {
          resultId: identity.resultId,
          resultFingerprint: identity.resultFingerprint,
          status: 'pending',
          createdAt: this.now(),
          ...(payload.outcome ? { outcome: payload.outcome } : {}),
          capturePayload,
          capturePlan,
        }
    try {
      await this.journal.save(replaceJournal(entries, nextEntry))
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '保存捕獲結算判定失敗，請重試。', cause)
    }
    return { ...identity, capturePlan: cloneCapturePlan(capturePlan) }
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
    let towerAlreadyApplied = false
    let incubatorAlreadyApplied = false
    const towerPayload = payload.tower ?? existing?.towerPayload ?? (existing?.tower
      ? {
          floor: existing.tower.floor,
          ascension: existing.tower.ascension,
          outcome: existing.tower.outcome,
        }
      : undefined)
    const incubatorPayload = payload.incubator ?? existing?.incubatorPayload ?? (existing?.incubator
      ? { amount: existing.incubator.amount }
      : undefined)
    const capturePayload = payload.capture ?? existing?.capturePayload
    const towerRequired = Boolean(this.children.tower && towerPayload)
    const incubatorRequired = Boolean(this.children.incubator && incubatorPayload)
    const captureRequired = Boolean(this.children.capture && capturePayload)
    if (existing) {
      // Reconciliation starts with the child authority. The journal is only
      // orchestration state and cannot prove that the roster write happened.
      try {
        childAlreadyApplied = await this.destination.hasApplied(identity)
        if (this.children.skillPoints) skillPointsAlreadyApplied = await this.children.skillPoints.hasApplied(identity)
        if (this.children.meta) metaAlreadyApplied = await this.children.meta.hasApplied(identity)
        if (towerRequired && this.children.tower) towerAlreadyApplied = await this.children.tower.hasApplied(identity)
        if (incubatorRequired && this.children.incubator) incubatorAlreadyApplied = await this.children.incubator.hasApplied(identity)
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, 'Result 子結算回條對帳失敗，請重試。', error)
      }
    }

    const allChildrenSettled = !captureRequired && existing?.status === 'settled'
      && existing.rosterGrowth
      && childAlreadyApplied
      && (!this.children.skillPoints || (existing.skillPoints && skillPointsAlreadyApplied))
      && (!this.children.meta || (existing.meta && metaAlreadyApplied))
      && (!towerRequired || (existing.tower && towerAlreadyApplied))
      && (!incubatorRequired || (existing.incubator && incubatorAlreadyApplied))
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
        const towerReceipt = towerRequired && this.children.tower && towerPayload
          ? await this.children.tower.applyOnce(identity, towerPayload)
          : undefined
        const incubatorReceipt = incubatorRequired && this.children.incubator && incubatorPayload
          ? await this.children.incubator.applyOnce(identity, incubatorPayload)
          : undefined
        childReceipt = {
          ...rosterReceipt,
          ...(skillPointsReceipt ? { skillPoints: skillPointsReceipt } : {}),
          ...(metaReceipt ? { meta: metaReceipt } : {}),
          ...(towerReceipt ? { tower: towerReceipt } : {}),
          ...(incubatorReceipt ? { incubator: incubatorReceipt } : {}),
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
        ...(childReceipt.tower ? { tower: { ...childReceipt.tower, status: 'already-applied' } } : {}),
        ...(childReceipt.incubator ? { incubator: { ...childReceipt.incubator, status: 'already-applied' } } : {}),
      }
    }

    let running: SettlementJournalEntry = existing
      ? {
          ...existing,
          status: 'pending',
          ...(towerPayload ? { towerPayload } : {}),
          ...(incubatorPayload ? { incubatorPayload } : {}),
          ...(capturePayload ? { capturePayload } : {}),
          error: undefined,
        }
      : {
          resultId: identity.resultId,
          resultFingerprint: identity.resultFingerprint,
          status: 'pending',
          createdAt: this.now(),
          ...(payload.outcome ? { outcome: payload.outcome } : {}),
          ...(towerPayload ? { towerPayload } : {}),
          ...(incubatorPayload ? { incubatorPayload } : {}),
          ...(capturePayload ? { capturePayload } : {}),
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

    let towerReceipt: TowerProgressionReceipt | undefined
    if (towerRequired && this.children.tower) {
      try {
        if (towerPayload) towerReceipt = await this.children.tower.applyOnce(identity, towerPayload)
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, '連勝塔結算失敗，請重試。', error)
      }
    }

    let incubatorReceipt: IncubatorProgressionReceipt | undefined
    if (incubatorRequired && this.children.incubator) {
      try {
        if (incubatorPayload) incubatorReceipt = await this.children.incubator.applyOnce(identity, incubatorPayload)
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, '孵化進度結算失敗，請重試。', error)
      }
    }

    let captureReceipt: CaptureSettlementReceipt | undefined
    if (captureRequired && this.children.capture && capturePayload) {
      let capturePlan = existing?.capturePlan
      if (!capturePlan) {
        try {
          capturePlan = await this.children.capture.prepare(identity, capturePayload)
        } catch (error) {
          if (error instanceof ResultSettlementError) throw error
          throw new ResultSettlementError('storage', identity, '建立捕獲結算判定失敗，請重試。', error)
        }
        // Persist the decision and the outcome-specific child intent before
        // any capture child writes. A retry therefore never rolls again.
        running = { ...running, capturePayload, capturePlan }
        try {
          await this.journal.save(replaceJournal(entries, running))
        } catch (cause) {
          throw new ResultSettlementError('storage', identity, '保存捕獲結算判定失敗，請重試。', cause)
        }
      }
      try {
        captureReceipt = await this.children.capture.settle(identity, capturePayload, capturePlan)
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, '捕獲子結算失敗，請重試。', error)
      }
    }

    const settled: SettlementJournalEntry = {
      ...running,
      status: 'settled',
      settledAt: running.settledAt ?? this.now(),
      rosterGrowth: receipt,
      ...(skillPointsReceipt ? { skillPoints: skillPointsReceipt } : {}),
      ...(metaReceipt ? { meta: metaReceipt } : {}),
      ...(towerReceipt ? { tower: towerReceipt } : {}),
      ...(incubatorReceipt ? { incubator: incubatorReceipt } : {}),
      ...(captureReceipt ? { capture: captureReceipt } : {}),
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
      ...(towerReceipt ? { tower: towerReceipt } : {}),
      ...(incubatorReceipt ? { incubator: incubatorReceipt } : {}),
      ...(captureReceipt ? { capture: captureReceipt } : {}),
    }
  }
}

/** The only lifecycle states a Result presentation is allowed to observe. */
export type ResultSettlementProjectionStatus = 'idle' | 'running' | 'settled' | 'error'

export interface ResultSettlementProjection {
  status: ResultSettlementProjectionStatus
  identity: ResultIdentity | null
  attempt: number
  captureDecision: CaptureDecision | null
  captureOutcome: CaptureOutcome | null
  receipt: ResultSettlementReceipt | null
  error: ResultSettlementError | null
}

export interface ResultSettlementProjectionRequest {
  identity: ResultIdentity
  payload: ResultSettlementPayload
}

export interface ResultSettlementProjectionDriver {
  prepare: (
    identity: ResultIdentity,
    payload: ResultSettlementPayload,
  ) => Promise<ResultSettlementPreparation>
  settle: (
    identity: ResultIdentity,
    payload: ResultSettlementPayload,
  ) => Promise<ResultSettlementReceipt>
  markResultLeft: (identity: ResultIdentity) => Promise<void>
}

/**
 * Orchestration state for the Result screen.  It is intentionally independent
 * from React: one instance can survive StrictMode remounts while stale Promise
 * completions are fenced by the request generation.
 */
export class ResultSettlementProjectionController {
  private snapshot: ResultSettlementProjection = {
    status: 'idle',
    identity: null,
    attempt: 0,
    captureDecision: null,
    captureOutcome: null,
    receipt: null,
    error: null,
  }
  private request: ResultSettlementProjectionRequest | null = null
  private generation = 0
  private readonly listeners = new Set<() => void>()

  constructor(private readonly driver: ResultSettlementProjectionDriver) {}

  getSnapshot = (): ResultSettlementProjection => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(request: ResultSettlementProjectionRequest | null): void {
    if (!request) {
      this.request = null
      this.generation += 1
      this.publish({
        status: 'idle',
        identity: null,
        attempt: this.snapshot.attempt,
        captureDecision: null,
        captureOutcome: null,
        receipt: null,
        error: null,
      })
      return
    }

    const current = this.request
    if (current && current.identity.resultId === request.identity.resultId
      && current.identity.resultFingerprint !== request.identity.resultFingerprint) {
      this.generation += 1
      // Keep the colliding pair fenced so a React re-render cannot silently
      // treat it as a fresh request.  Retry is intentionally disabled for a
      // collision; the caller must leave and start a new battle identity.
      this.request = request
      this.publish({
        status: 'error',
        identity: request.identity,
        attempt: this.snapshot.attempt,
        captureDecision: null,
        captureOutcome: null,
        receipt: null,
        error: new ResultSettlementError(
          'collision',
          request.identity,
          `結果識別碼碰撞：${request.identity.resultId} 已綁定不同的 fingerprint，請重新開始本場。`,
        ),
      })
      return
    }

    if (current && current.identity.resultId === request.identity.resultId
      && current.identity.resultFingerprint === request.identity.resultFingerprint) {
      // React remounts normally deliver the same payload and must be a no-op.
      // A durable journal may, however, contain an earlier partial shape (for
      // example a Tower child becoming required after a route re-entry).  Let
      // the coordinator reconcile that new child once the previous run is no
      // longer active; its destination markers still fence every mutation.
      if (stableJson(current.payload) === stableJson(request.payload)
        || this.snapshot.status === 'running'
        || this.snapshot.status === 'error') return
      this.request = request
      const generation = ++this.generation
      this.publish({
        status: 'running',
        identity: request.identity,
        attempt: this.snapshot.attempt + 1,
        captureDecision: this.snapshot.captureDecision,
        captureOutcome: this.snapshot.captureOutcome,
        receipt: null,
        error: null,
      })
      void this.run(request, generation)
      return
    }

    this.request = request
    const generation = ++this.generation
    this.publish({
      status: 'running',
      identity: request.identity,
      attempt: this.snapshot.attempt + 1,
      captureDecision: null,
      captureOutcome: null,
      receipt: null,
      error: null,
    })
    void this.run(request, generation)
  }

  retry(): void {
    if (this.snapshot.status !== 'error' || !this.request || this.snapshot.error?.code === 'collision') return
    const request = this.request
    const generation = ++this.generation
    this.publish({
      ...this.snapshot,
      status: 'running',
      attempt: this.snapshot.attempt + 1,
      captureDecision: this.snapshot.captureDecision,
      captureOutcome: this.snapshot.captureOutcome,
      receipt: null,
      error: null,
    })
    void this.run(request, generation)
  }

  async markResultLeft(identity: ResultIdentity | null = this.snapshot.identity): Promise<void> {
    if (!identity) return
    await this.driver.markResultLeft(identity)
  }

  private isCurrent(generation: number, request: ResultSettlementProjectionRequest): boolean {
    return this.generation === generation
      && this.request?.identity.resultId === request.identity.resultId
      && this.request.identity.resultFingerprint === request.identity.resultFingerprint
  }

  private async run(request: ResultSettlementProjectionRequest, generation: number): Promise<void> {
    try {
      const preparation = await this.driver.prepare(request.identity, request.payload)
      if (!this.isCurrent(generation, request)) return
      this.publish({
        ...this.snapshot,
        captureDecision: preparation.capturePlan?.decision ?? this.snapshot.captureDecision,
        captureOutcome: preparation.capturePlan?.outcome ?? this.snapshot.captureOutcome,
      })

      const receipt = await this.driver.settle(request.identity, request.payload)
      if (!this.isCurrent(generation, request)) return
      this.publish({
        ...this.snapshot,
        status: 'settled',
        captureDecision: receipt.capture?.decision ?? preparation.capturePlan?.decision ?? this.snapshot.captureDecision,
        captureOutcome: receipt.capture?.outcome ?? preparation.capturePlan?.outcome ?? this.snapshot.captureOutcome,
        receipt,
        error: null,
      })
    } catch (cause) {
      if (!this.isCurrent(generation, request)) return
      const error = cause instanceof ResultSettlementError
        ? cause
        : new ResultSettlementError('storage', request.identity, 'Result 結算失敗，請重試。', cause)
      this.publish({
        ...this.snapshot,
        status: 'error',
        error,
      })
    }
  }

  private publish(next: ResultSettlementProjection): void {
    this.snapshot = next
    for (const listener of this.listeners) listener()
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

function markerDestination(marker: unknown): string | undefined {
  if (!marker || typeof marker !== 'object' || Array.isArray(marker)) return undefined
  const destination = (marker as Record<string, unknown>).destination
  return typeof destination === 'string' ? destination : undefined
}

function markersForDestination<T>(markers: readonly unknown[], destination: string): T[] {
  return markers.filter((marker) => markerDestination(marker) === destination) as T[]
}

function readSharedMarkers(
  storage: ResultStorage | null,
  canonicalKey: string,
  mirrorKey: string,
  label: string,
): unknown[] {
  if (!storage) return []
  const embedded = readEmbeddedMarkers<unknown>(storage.getItem(canonicalKey), label)
  if (embedded) return embedded
  return parseArray<unknown>(storage.getItem(mirrorKey), label)
}

function mergeSharedMarkers(
  storage: ResultStorage | null,
  canonicalKey: string,
  mirrorKey: string,
  destination: string,
  incoming: readonly unknown[],
  label: string,
): unknown[] {
  const existing = readSharedMarkers(storage, canonicalKey, mirrorKey, label)
  const preserved = existing.filter((marker) => markerDestination(marker) !== destination)
  const merged = [...preserved, ...incoming]
  return merged
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

/** Browser persistence for the captured-new roster child boundary. */
export class LocalStorageRosterCapturePersistence implements RosterCapturePersistence {
  constructor(
    private readonly roster: {
      loadRoster: () => Promise<OwnedUnit[]>
      saveRoster: (units: OwnedUnit[]) => Promise<void>
      saveRosterWithCaptureMarkers?: (units: OwnedUnit[], markers: unknown[]) => Promise<void>
    },
    private readonly storage: ResultStorage | null = safeStorage(),
  ) {}

  loadRoster(): Promise<OwnedUnit[]> {
    return this.roster.loadRoster()
  }

  async loadMarkers(): Promise<RosterCaptureMarker[]> {
    if (!this.storage) return []
    const embedded = readEmbeddedMarkers<RosterCaptureMarker>(
      this.storage.getItem('mobie.roster.v2'),
      '收服 Mobie 結算標記',
    )
    if (embedded) return markersForDestination<RosterCaptureMarker>(embedded, 'roster-capture')
    return parseArray<RosterCaptureMarker>(
      this.storage.getItem(ROSTER_CAPTURE_SETTLEMENT_MARKER_KEY),
      '收服 Mobie 結算標記',
    )
  }

  async savePending(roster: OwnedUnit[], markers: RosterCaptureMarker[], operationId?: string): Promise<void> {
    if (!this.storage) {
      await this.roster.saveRoster(roster)
      return
    }
    try {
      if (this.roster.saveRosterWithCaptureMarkers) {
        // One canonical envelope write contains both the roster mutation and
        // its write-ahead marker. No cross-key transaction is implied.
        const completed = markers.map((marker) => marker.resultId === operationId
          ? { ...marker, canonicalApplied: true }
          : marker)
        await this.roster.saveRosterWithCaptureMarkers(roster, completed)
        try { this.storage.setItem(ROSTER_CAPTURE_SETTLEMENT_MARKER_KEY, JSON.stringify(completed)) } catch { /* canonical envelope is authoritative */ }
      } else {
        // Compatibility adapter for old persistence implementations that only
        // expose the legacy array writer.
        this.storage.setItem(ROSTER_CAPTURE_SETTLEMENT_MARKER_KEY, JSON.stringify(markers))
        await this.roster.saveRoster(roster)
      }
    } catch (cause) {
      throw new Error(`保存收服 Mobie 資料失敗：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  async saveMarkers(markers: RosterCaptureMarker[]): Promise<void> {
    if (!this.storage) return
    try {
      if (this.roster.saveRosterWithCaptureMarkers) {
        const roster = await this.roster.loadRoster()
        await this.roster.saveRosterWithCaptureMarkers(roster, markers)
      }
      try { this.storage.setItem(ROSTER_CAPTURE_SETTLEMENT_MARKER_KEY, JSON.stringify(markers)) } catch { /* canonical envelope is authoritative */ }
    } catch (cause) {
      throw new Error(`保存收服 Mobie 結算標記失敗：${cause instanceof Error ? cause.message : String(cause)}`)
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
      saveMetaWithMarkers: (meta: MetaState, markers: unknown[], operationId?: string) => Promise<void> | void
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
    return markersForDestination<MetaSettlementMarker>(
      readSharedMarkers(this.storage, 'mobie.meta.v1', META_SETTLEMENT_MARKER_KEY, 'Meta 結算標記'),
      'meta',
    )
  }

  async savePending(meta: MetaState, markers: MetaSettlementMarker[], operationId?: string): Promise<void> {
    const completed = markers.map((marker) => marker.resultId === operationId
      ? { ...marker, canonicalApplied: true }
      : marker)
    const merged = mergeSharedMarkers(
      this.storage,
      'mobie.meta.v1',
      META_SETTLEMENT_MARKER_KEY,
      'meta',
      completed,
      'Meta 結算標記',
    )
    try {
      await this.meta.saveMetaWithMarkers(meta, merged, operationId)
      try { this.storage?.setItem(META_SETTLEMENT_MARKER_KEY, JSON.stringify(merged)) } catch { /* canonical envelope is authoritative */ }
    } catch (cause) {
      throw new Error(`保存 Meta 結算資料失敗：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  async saveMarkers(markers: MetaSettlementMarker[]): Promise<void> {
    try {
      const meta = await this.loadMeta()
      const merged = mergeSharedMarkers(
        this.storage,
        'mobie.meta.v1',
        META_SETTLEMENT_MARKER_KEY,
        'meta',
        markers,
        'Meta 結算標記',
      )
      await this.meta.saveMetaWithMarkers(meta, merged)
      try { this.storage?.setItem(META_SETTLEMENT_MARKER_KEY, JSON.stringify(merged)) } catch { /* canonical envelope is authoritative */ }
    } catch (cause) {
      throw new Error(`保存 Meta 結算標記失敗：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
}

/** Browser persistence for capture/Dex Meta markers sharing the Meta envelope. */
export class LocalStorageCaptureMetaPersistence implements CaptureMetaPersistence {
  constructor(
    private readonly meta: {
      loadMeta: () => Promise<MetaState> | MetaState
      saveMetaWithMarkers: (meta: MetaState, markers: unknown[]) => Promise<void> | void
    },
    private readonly storage: ResultStorage | null = safeStorage(),
  ) {}

  loadMeta(): Promise<MetaState> {
    return Promise.resolve(this.meta.loadMeta())
  }

  async loadMarkers(): Promise<CaptureMetaMarker[]> {
    if (!this.storage) return []
    return markersForDestination<CaptureMetaMarker>(
      readSharedMarkers(this.storage, 'mobie.meta.v1', META_SETTLEMENT_MARKER_KEY, '捕獲圖鑑結算標記'),
      'meta-capture',
    )
  }

  async savePending(meta: MetaState, markers: CaptureMetaMarker[], operationId?: string): Promise<void> {
    const completed = markers.map((marker) => marker.resultId === operationId
      ? { ...marker, canonicalApplied: true }
      : marker)
    const merged = mergeSharedMarkers(
      this.storage,
      'mobie.meta.v1',
      META_SETTLEMENT_MARKER_KEY,
      'meta-capture',
      completed,
      '捕獲圖鑑結算標記',
    )
    try {
      await this.meta.saveMetaWithMarkers(meta, merged)
      try {
        this.storage?.setItem(META_CAPTURE_SETTLEMENT_MARKER_KEY, JSON.stringify(
          markersForDestination<CaptureMetaMarker>(merged, 'meta-capture'),
        ))
        this.storage?.setItem(META_SETTLEMENT_MARKER_KEY, JSON.stringify(merged))
      } catch { /* canonical envelope is authoritative */ }
    } catch (cause) {
      throw new Error(`保存捕獲圖鑑結算資料失敗：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  async saveMarkers(markers: CaptureMetaMarker[]): Promise<void> {
    try {
      const meta = await this.loadMeta()
      const merged = mergeSharedMarkers(
        this.storage,
        'mobie.meta.v1',
        META_SETTLEMENT_MARKER_KEY,
        'meta-capture',
        markers,
        '捕獲圖鑑結算標記',
      )
      await this.meta.saveMetaWithMarkers(meta, merged)
      try {
        this.storage?.setItem(META_CAPTURE_SETTLEMENT_MARKER_KEY, JSON.stringify(
          markersForDestination<CaptureMetaMarker>(merged, 'meta-capture'),
        ))
        this.storage?.setItem(META_SETTLEMENT_MARKER_KEY, JSON.stringify(merged))
      } catch { /* canonical envelope is authoritative */ }
    } catch (cause) {
      throw new Error(`保存捕獲圖鑑結算標記失敗：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
}

// Naming alias used by the destination-oriented vocabulary.
export { LocalStorageCaptureMetaPersistence as LocalStorageMetaCapturePersistence }

/** Browser persistence for the Tower progression child boundary. */
export class LocalStorageTowerProgressionPersistence implements TowerProgressionPersistence {
  constructor(
    private readonly run: {
      loadRun: () => Promise<TowerProgressionState> | TowerProgressionState
      saveRunWithMarkers: (run: TowerProgressionState, markers: TowerProgressionMarker[]) => Promise<void> | void
    },
    private readonly storage: ResultStorage | null = safeStorage(),
  ) {}

  loadRun(): Promise<TowerProgressionState> {
    return Promise.resolve(this.run.loadRun())
  }

  async loadMarkers(): Promise<TowerProgressionMarker[]> {
    if (!this.storage) return []
    const embedded = readEmbeddedMarkers<TowerProgressionMarker>(
      this.storage.getItem('mobie.run.v1'),
      '連勝塔結算標記',
    )
    if (embedded) return embedded
    return parseArray<TowerProgressionMarker>(
      this.storage.getItem(TOWER_PROGRESSION_SETTLEMENT_MARKER_KEY),
      '連勝塔結算標記',
    )
  }

  async savePending(
    run: TowerProgressionState,
    markers: TowerProgressionMarker[],
    operationId?: string,
  ): Promise<void> {
    const completed = markers.map((marker) => marker.resultId === operationId
      ? { ...marker, canonicalApplied: true }
      : marker)
    try {
      await this.run.saveRunWithMarkers(run, completed)
      try { this.storage?.setItem(TOWER_PROGRESSION_SETTLEMENT_MARKER_KEY, JSON.stringify(completed)) } catch { /* canonical envelope is authoritative */ }
    } catch (cause) {
      throw new Error(`保存連勝塔結算資料失敗：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  async saveMarkers(markers: TowerProgressionMarker[]): Promise<void> {
    try {
      const run = await this.loadRun()
      await this.run.saveRunWithMarkers(run, markers)
      try { this.storage?.setItem(TOWER_PROGRESSION_SETTLEMENT_MARKER_KEY, JSON.stringify(markers)) } catch { /* canonical envelope is authoritative */ }
    } catch (cause) {
      throw new Error(`保存連勝塔結算標記失敗：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
}

/** Browser persistence for the incubator progression child boundary. */
export class LocalStorageIncubatorProgressionPersistence implements IncubatorProgressionPersistence {
  constructor(
    private readonly incubator: {
      loadState: () => Promise<IncubatorState> | IncubatorState
      saveStateWithMarkers: (state: IncubatorState, markers: unknown[]) => Promise<void> | void
    },
    private readonly storage: ResultStorage | null = safeStorage(),
  ) {}

  loadState(): Promise<IncubatorState> {
    return Promise.resolve(this.incubator.loadState())
  }

  async loadMarkers(): Promise<IncubatorProgressionMarker[]> {
    if (!this.storage) return []
    return markersForDestination<IncubatorProgressionMarker>(
      readSharedMarkers(
        this.storage,
        'mobie.incubator.v1',
        INCUBATOR_PROGRESSION_SETTLEMENT_MARKER_KEY,
        '孵化進度結算標記',
      ),
      'incubator-progression',
    )
  }

  async savePending(
    state: IncubatorState,
    markers: IncubatorProgressionMarker[],
    operationId?: string,
  ): Promise<void> {
    const completed = markers.map((marker) => marker.resultId === operationId
      ? { ...marker, canonicalApplied: true }
      : marker)
    const merged = mergeSharedMarkers(
      this.storage,
      'mobie.incubator.v1',
      INCUBATOR_PROGRESSION_SETTLEMENT_MARKER_KEY,
      'incubator-progression',
      completed,
      '孵化進度結算標記',
    )
    try {
      await this.incubator.saveStateWithMarkers(state, merged)
      try { this.storage?.setItem(INCUBATOR_PROGRESSION_SETTLEMENT_MARKER_KEY, JSON.stringify(merged)) } catch { /* canonical envelope is authoritative */ }
    } catch (cause) {
      throw new Error(`保存孵化進度結算資料失敗：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  async saveMarkers(markers: IncubatorProgressionMarker[]): Promise<void> {
    try {
      const state = await this.loadState()
      const merged = mergeSharedMarkers(
        this.storage,
        'mobie.incubator.v1',
        INCUBATOR_PROGRESSION_SETTLEMENT_MARKER_KEY,
        'incubator-progression',
        markers,
        '孵化進度結算標記',
      )
      await this.incubator.saveStateWithMarkers(state, merged)
      try { this.storage?.setItem(INCUBATOR_PROGRESSION_SETTLEMENT_MARKER_KEY, JSON.stringify(merged)) } catch { /* canonical envelope is authoritative */ }
    } catch (cause) {
      throw new Error(`保存孵化進度結算標記失敗：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
}

/** Browser persistence for the duplicate-capture egg child sharing incubator state. */
export class LocalStorageDuplicateEggPersistence implements DuplicateEggPersistence {
  constructor(
    private readonly incubator: {
      loadState: () => Promise<IncubatorState> | IncubatorState
      saveStateWithMarkers: (state: IncubatorState, markers: unknown[]) => Promise<void> | void
    },
    private readonly storage: ResultStorage | null = safeStorage(),
  ) {}

  loadState(): Promise<IncubatorState> {
    return Promise.resolve(this.incubator.loadState())
  }

  async loadMarkers(): Promise<DuplicateEggMarker[]> {
    if (!this.storage) return []
    return markersForDestination<DuplicateEggMarker>(
      readSharedMarkers(
        this.storage,
        'mobie.incubator.v1',
        INCUBATOR_PROGRESSION_SETTLEMENT_MARKER_KEY,
        '重複蛋結算標記',
      ),
      'incubator-capture',
    )
  }

  async savePending(state: IncubatorState, markers: DuplicateEggMarker[], operationId?: string): Promise<void> {
    const completed = markers.map((marker) => marker.resultId === operationId
      ? { ...marker, canonicalApplied: true }
      : marker)
    const merged = mergeSharedMarkers(
      this.storage,
      'mobie.incubator.v1',
      INCUBATOR_PROGRESSION_SETTLEMENT_MARKER_KEY,
      'incubator-capture',
      completed,
      '重複蛋結算標記',
    )
    try {
      await this.incubator.saveStateWithMarkers(state, merged)
      try {
        this.storage?.setItem(DUPLICATE_EGG_SETTLEMENT_MARKER_KEY, JSON.stringify(
          markersForDestination<DuplicateEggMarker>(merged, 'incubator-capture'),
        ))
        this.storage?.setItem(INCUBATOR_SETTLEMENT_MARKER_KEY, JSON.stringify(merged))
      } catch { /* canonical envelope is authoritative */ }
    } catch (cause) {
      throw new Error(`保存重複蛋結算資料失敗：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }

  async saveMarkers(markers: DuplicateEggMarker[]): Promise<void> {
    try {
      const state = await this.loadState()
      const merged = mergeSharedMarkers(
        this.storage,
        'mobie.incubator.v1',
        INCUBATOR_PROGRESSION_SETTLEMENT_MARKER_KEY,
        'incubator-capture',
        markers,
        '重複蛋結算標記',
      )
      await this.incubator.saveStateWithMarkers(state, merged)
      try {
        this.storage?.setItem(DUPLICATE_EGG_SETTLEMENT_MARKER_KEY, JSON.stringify(
          markersForDestination<DuplicateEggMarker>(merged, 'incubator-capture'),
        ))
        this.storage?.setItem(INCUBATOR_SETTLEMENT_MARKER_KEY, JSON.stringify(merged))
      } catch { /* canonical envelope is authoritative */ }
    } catch (cause) {
      throw new Error(`保存重複蛋結算標記失敗：${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
}

// Naming alias used by the destination-oriented vocabulary.
export { LocalStorageDuplicateEggPersistence as LocalStorageIncubatorCapturePersistence }

// Compatibility aliases used by the Result settlement vocabulary.
export { LocalStorageTowerProgressionPersistence as LocalStorageTowerSettlementPersistence }
export { LocalStorageIncubatorProgressionPersistence as LocalStorageIncubatorSettlementPersistence }

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
      tower: entry.tower ? {
        ...entry.tower,
        before: cloneTowerProgressionState(entry.tower.before),
        after: cloneTowerProgressionState(entry.tower.after),
      } : undefined,
      incubator: entry.incubator ? {
        ...entry.incubator,
        updates: cloneProgressUpdates(entry.incubator.updates),
      } : undefined,
      capture: entry.capture ? cloneCaptureReceipt(entry.capture) : undefined,
      capturePlan: entry.capturePlan ? cloneCapturePlan(entry.capturePlan) : undefined,
      capturePayload: entry.capturePayload ? {
        target: cloneCard(entry.capturePayload.target),
        captureMult: entry.capturePayload.captureMult,
      } : undefined,
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
      tower: entry.tower ? {
        ...entry.tower,
        before: cloneTowerProgressionState(entry.tower.before),
        after: cloneTowerProgressionState(entry.tower.after),
      } : undefined,
      incubator: entry.incubator ? {
        ...entry.incubator,
        updates: cloneProgressUpdates(entry.incubator.updates),
      } : undefined,
      capture: entry.capture ? cloneCaptureReceipt(entry.capture) : undefined,
      capturePlan: entry.capturePlan ? cloneCapturePlan(entry.capturePlan) : undefined,
      capturePayload: entry.capturePayload ? {
        target: cloneCard(entry.capturePayload.target),
        captureMult: entry.capturePayload.captureMult,
      } : undefined,
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

export class MemoryRosterCapturePersistence implements RosterCapturePersistence {
  roster: OwnedUnit[]
  markers: RosterCaptureMarker[] = []
  failPending = false
  failMarker = false
  saveCount = 0

  constructor(roster: OwnedUnit[]) {
    this.roster = roster.map(cloneOwnedUnit)
  }

  async loadRoster(): Promise<OwnedUnit[]> {
    return this.roster.map(cloneOwnedUnit)
  }

  async loadMarkers(): Promise<RosterCaptureMarker[]> {
    return this.markers.map((marker) => ({
      ...marker,
      payload: { card: cloneCard(marker.payload.card) },
      unit: cloneOwnedUnit(marker.unit),
      receipt: { ...marker.receipt, unit: cloneOwnedUnit(marker.receipt.unit) },
    }))
  }

  async savePending(roster: OwnedUnit[], markers: RosterCaptureMarker[], operationId?: string): Promise<void> {
    if (this.failPending) throw new Error('capture roster pending write failed')
    this.markers = markers.map((marker) => ({
      ...marker,
      payload: { card: cloneCard(marker.payload.card) },
      unit: cloneOwnedUnit(marker.unit),
      receipt: { ...marker.receipt, unit: cloneOwnedUnit(marker.receipt.unit) },
    }))
    this.saveCount += 1
    this.roster = roster.map(cloneOwnedUnit)
    this.markers = this.markers.map((marker) => ({
      ...marker,
      ...(marker.resultId === operationId ? { canonicalApplied: true } : {}),
    }))
  }

  async saveMarkers(markers: RosterCaptureMarker[]): Promise<void> {
    if (this.failMarker) throw new Error('capture roster marker write failed')
    this.markers = markers.map((marker) => ({
      ...marker,
      payload: { card: cloneCard(marker.payload.card) },
      unit: cloneOwnedUnit(marker.unit),
      receipt: { ...marker.receipt, unit: cloneOwnedUnit(marker.receipt.unit) },
    }))
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

export class MemoryCaptureMetaPersistence implements CaptureMetaPersistence {
  meta: MetaState
  markers: CaptureMetaMarker[] = []
  failPending = false
  failMarker = false
  saveCount = 0

  constructor(meta: MetaState) {
    this.meta = cloneMeta(meta)
  }

  async loadMeta(): Promise<MetaState> {
    return cloneMeta(this.meta)
  }

  async loadMarkers(): Promise<CaptureMetaMarker[]> {
    return this.markers.map((marker) => ({
      ...marker,
      payload: { ...marker.payload },
      before: cloneMeta(marker.before),
      after: cloneMeta(marker.after),
      receipt: { ...marker.receipt, meta: cloneMeta(marker.receipt.meta) },
    }))
  }

  async savePending(meta: MetaState, markers: CaptureMetaMarker[], operationId?: string): Promise<void> {
    this.markers = markers.map((marker) => ({
      ...marker,
      payload: { ...marker.payload },
      before: cloneMeta(marker.before),
      after: cloneMeta(marker.after),
      receipt: { ...marker.receipt, meta: cloneMeta(marker.receipt.meta) },
    }))
    if (this.failPending) throw new Error('capture meta pending write failed')
    this.saveCount += 1
    this.meta = cloneMeta(meta)
    this.markers = this.markers.map((marker) => ({
      ...marker,
      ...(marker.resultId === operationId ? { canonicalApplied: true } : {}),
    }))
  }

  async saveMarkers(markers: CaptureMetaMarker[]): Promise<void> {
    if (this.failMarker) throw new Error('capture meta marker write failed')
    this.markers = markers.map((marker) => ({
      ...marker,
      payload: { ...marker.payload },
      before: cloneMeta(marker.before),
      after: cloneMeta(marker.after),
      receipt: { ...marker.receipt, meta: cloneMeta(marker.receipt.meta) },
    }))
  }
}

export class MemoryTowerProgressionPersistence implements TowerProgressionPersistence {
  run: TowerProgressionState
  markers: TowerProgressionMarker[] = []
  failPending = false
  failMarker = false
  saveCount = 0

  constructor(run: TowerProgressionState = { bestFloor: 0, ascensionUnlocked: 0 }) {
    this.run = cloneTowerProgressionState(run)
  }

  async loadRun(): Promise<TowerProgressionState> {
    return cloneTowerProgressionState(this.run)
  }

  async loadMarkers(): Promise<TowerProgressionMarker[]> {
    return this.markers.map((marker) => ({
      ...marker,
      payload: { ...marker.payload },
      before: cloneTowerProgressionState(marker.before),
      after: cloneTowerProgressionState(marker.after),
      receipt: {
        ...marker.receipt,
        before: cloneTowerProgressionState(marker.receipt.before),
        after: cloneTowerProgressionState(marker.receipt.after),
      },
    }))
  }

  async savePending(run: TowerProgressionState, markers: TowerProgressionMarker[], operationId?: string): Promise<void> {
    this.markers = markers.map((marker) => ({
      ...marker,
      payload: { ...marker.payload },
      before: cloneTowerProgressionState(marker.before),
      after: cloneTowerProgressionState(marker.after),
      receipt: {
        ...marker.receipt,
        before: cloneTowerProgressionState(marker.receipt.before),
        after: cloneTowerProgressionState(marker.receipt.after),
      },
    }))
    if (this.failPending) throw new Error('tower pending write failed')
    this.saveCount += 1
    this.run = cloneTowerProgressionState(run)
    this.markers = this.markers.map((marker) => ({
      ...marker,
      ...(marker.resultId === operationId ? { canonicalApplied: true } : {}),
    }))
  }

  async saveMarkers(markers: TowerProgressionMarker[]): Promise<void> {
    if (this.failMarker) throw new Error('tower marker write failed')
    this.markers = markers.map((marker) => ({
      ...marker,
      payload: { ...marker.payload },
      before: cloneTowerProgressionState(marker.before),
      after: cloneTowerProgressionState(marker.after),
      receipt: {
        ...marker.receipt,
        before: cloneTowerProgressionState(marker.receipt.before),
        after: cloneTowerProgressionState(marker.receipt.after),
      },
    }))
  }
}

export class MemoryIncubatorProgressionPersistence implements IncubatorProgressionPersistence {
  state: IncubatorState
  markers: IncubatorProgressionMarker[] = []
  failPending = false
  failMarker = false
  saveCount = 0

  constructor(state: IncubatorState) {
    this.state = cloneIncubatorState(state)
  }

  async loadState(): Promise<IncubatorState> {
    return cloneIncubatorState(this.state)
  }

  async loadMarkers(): Promise<IncubatorProgressionMarker[]> {
    return this.markers.map((marker) => ({
      ...marker,
      payload: { ...marker.payload },
      updates: cloneProgressUpdates(marker.updates),
      receipt: { ...marker.receipt, updates: cloneProgressUpdates(marker.receipt.updates) },
    }))
  }

  async savePending(state: IncubatorState, markers: IncubatorProgressionMarker[], operationId?: string): Promise<void> {
    this.markers = markers.map((marker) => ({
      ...marker,
      payload: { ...marker.payload },
      updates: cloneProgressUpdates(marker.updates),
      receipt: { ...marker.receipt, updates: cloneProgressUpdates(marker.receipt.updates) },
    }))
    if (this.failPending) throw new Error('incubator pending write failed')
    this.saveCount += 1
    this.state = cloneIncubatorState(state)
    this.markers = this.markers.map((marker) => ({
      ...marker,
      ...(marker.resultId === operationId ? { canonicalApplied: true } : {}),
    }))
  }

  async saveMarkers(markers: IncubatorProgressionMarker[]): Promise<void> {
    if (this.failMarker) throw new Error('incubator marker write failed')
    this.markers = markers.map((marker) => ({
      ...marker,
      payload: { ...marker.payload },
      updates: cloneProgressUpdates(marker.updates),
      receipt: { ...marker.receipt, updates: cloneProgressUpdates(marker.receipt.updates) },
    }))
  }
}

export class MemoryDuplicateEggPersistence implements DuplicateEggPersistence {
  state: IncubatorState
  markers: DuplicateEggMarker[] = []
  failPending = false
  failMarker = false
  saveCount = 0

  constructor(state: IncubatorState) {
    this.state = cloneIncubatorState(state)
  }

  async loadState(): Promise<IncubatorState> {
    return cloneIncubatorState(this.state)
  }

  async loadMarkers(): Promise<DuplicateEggMarker[]> {
    return this.markers.map((marker) => ({
      ...marker,
      payload: cloneDuplicateEggPayload(marker.payload),
      egg: cloneEgg(marker.egg),
      receipt: { ...marker.receipt, egg: cloneEgg(marker.receipt.egg) },
    }))
  }

  async savePending(state: IncubatorState, markers: DuplicateEggMarker[], operationId?: string): Promise<void> {
    this.markers = markers.map((marker) => ({
      ...marker,
      payload: cloneDuplicateEggPayload(marker.payload),
      egg: cloneEgg(marker.egg),
      receipt: { ...marker.receipt, egg: cloneEgg(marker.receipt.egg) },
    }))
    if (this.failPending) throw new Error('duplicate egg pending write failed')
    this.saveCount += 1
    this.state = cloneIncubatorState(state)
    this.markers = this.markers.map((marker) => ({
      ...marker,
      ...(marker.resultId === operationId ? { canonicalApplied: true } : {}),
    }))
  }

  async saveMarkers(markers: DuplicateEggMarker[]): Promise<void> {
    if (this.failMarker) throw new Error('duplicate egg marker write failed')
    this.markers = markers.map((marker) => ({
      ...marker,
      payload: cloneDuplicateEggPayload(marker.payload),
      egg: cloneEgg(marker.egg),
      receipt: { ...marker.receipt, egg: cloneEgg(marker.receipt.egg) },
    }))
  }
}
