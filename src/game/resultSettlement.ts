import type { OwnedUnit } from '@/game/types'
import { applyExp, expYield, type ExpResult } from '@/game/growth'
import { effectiveLearnedMoves, newlyLearned } from '@/game/learnset'
import { getSpecies } from '@/game/data/species'
import { PRODUCT_RUNTIME } from '@/game/ext/productRuntime'

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

export type ResultOutcome = 'win' | 'lose'

export interface RosterGrowthPayload {
  unitIds: string[]
  foeLevels: number[]
  ratio: number
  /** Kept beside (and independent from) the identity pair for future destinations. */
  outcome?: ResultOutcome
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
  updates: OwnedUnit[]
  receipt: Omit<RosterGrowthReceipt, 'status'>
}

export interface SettlementJournalEntry extends ResultIdentity {
  status: ResultMarkerStatus
  createdAt: number
  settledAt?: number
  leftResultAt?: number
  outcome?: ResultOutcome
  rosterGrowth?: RosterGrowthReceipt
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

function mergeUpdates(roster: readonly OwnedUnit[], updates: readonly OwnedUnit[]): OwnedUnit[] {
  const byId = new Map(updates.map((unit) => [unit.id, unit]))
  return roster.map((unit) => byId.get(unit.id) ?? unit)
}

function updatesApplied(roster: readonly OwnedUnit[], updates: readonly OwnedUnit[]): boolean {
  const byId = new Map(roster.map((unit) => [unit.id, unit]))
  return updates.every((update) => sameUnit(byId.get(update.id), update))
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
      if (!updatesApplied(roster, existing.updates)) {
        const reconciled = mergeUpdates(roster, existing.updates)
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
        await this.persistence.saveMarkers(retainResultMarkers(replaceMarker(markers, settled)))
      } catch (cause) {
        throw new ResultSettlementError('receipt', identity, 'Result 結算已寫入，但回條保存失敗；請重試以完成對帳。', cause)
      }
      return { ...existing.receipt, status: 'already-applied' }
    }

    const calculated = calculateRosterGrowth(roster, payload)
    const appliedAt = this.now()
    const receipt = makeReceipt(identity, calculated, appliedAt, 'applied')
    const updates = calculated.results.map((result) => result.unit)
    const pending = markerFor(identity, receipt, updates, appliedAt, 'pending', payload.outcome)
    const pendingMarkers = replaceMarker(markers, pending)
    try {
      // Marker intent is durable before the canonical write.  If either write
      // fails, retry sees the pending marker and never recalculates growth.
      await this.persistence.savePending(calculated.roster, pendingMarkers)
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '保存 Mobie 成長結果失敗，請重試。', cause)
    }
    const settled = markerFor(identity, receipt, updates, appliedAt, 'settled', payload.outcome, pending)
    try {
      await this.persistence.saveMarkers(retainResultMarkers(replaceMarker(pendingMarkers, settled)))
    } catch (cause) {
      throw new ResultSettlementError('receipt', identity, 'Result 結算已寫入，但回條保存失敗；請重試以完成對帳。', cause)
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
  ) {}

  settle(identity: ResultIdentity, payload: RosterGrowthPayload): Promise<RosterGrowthReceipt> {
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
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, '保存 Result 離場標記失敗，請重試。', error)
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async settleSerialized(identity: ResultIdentity, payload: RosterGrowthPayload): Promise<RosterGrowthReceipt> {
    let entries: SettlementJournalEntry[]
    try {
      entries = await this.journal.load()
    } catch (cause) {
      throw new ResultSettlementError('storage', identity, '讀取 Result 結算進度失敗，請重試。', cause)
    }
    const existing = entries.find((item) => item.resultId === identity.resultId)
    if (existing && existing.resultFingerprint !== identity.resultFingerprint) collision(identity)

    if (existing?.status === 'settled' && existing.rosterGrowth) {
      // The journal is only orchestration state. Always ask the child
      // destination to reconcile its own marker before returning an existing
      // receipt; a journal entry alone is never proof that the roster write
      // happened.
      let childReceipt: RosterGrowthReceipt
      try {
        childReceipt = await this.destination.applyOnce(identity, payload)
      } catch (error) {
        if (error instanceof ResultSettlementError) throw error
        throw new ResultSettlementError('storage', identity, 'Result 成長回條對帳失敗，請重試。', error)
      }
      return { ...childReceipt, status: 'already-applied' }
    }

    const running: SettlementJournalEntry = existing ?? {
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

    const settled: SettlementJournalEntry = {
      ...running,
      status: 'settled',
      settledAt: running.settledAt ?? this.now(),
      rosterGrowth: receipt,
      error: undefined,
    }
    try {
      await this.journal.save(retainResultMarkers(replaceJournal(entries, settled)))
    } catch (cause) {
      // The child destination is now durable.  Keeping the journal in its
      // running state lets retry reconcile via destination.applyOnce.
      throw new ResultSettlementError('receipt', identity, 'Mobie 成長已保存，但 Result 回條尚未完成；請重試。', cause)
    }
    return receipt
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

/** Test-friendly in-memory marker/journal implementations. */
export class MemorySettlementJournal implements SettlementJournalPersistence {
  entries: SettlementJournalEntry[] = []
  failSave = false
  saveCount = 0
  failOnSave: number | undefined

  async load(): Promise<SettlementJournalEntry[]> {
    return this.entries.map((entry) => ({ ...entry, rosterGrowth: entry.rosterGrowth ? { ...entry.rosterGrowth } : undefined }))
  }

  async save(entries: SettlementJournalEntry[]): Promise<void> {
    this.saveCount += 1
    if (this.failSave || this.failOnSave === this.saveCount) throw new Error('journal write failed')
    this.entries = entries.map((entry) => ({ ...entry, rosterGrowth: entry.rosterGrowth ? { ...entry.rosterGrowth } : undefined }))
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
