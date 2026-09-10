import type { OwnedUnit } from '@/game/types'
import { addRegistered, bumpStat, loadMetaStrict, saveMetaStateStrict, type MetaState } from '@/game/meta'
import {
  hatchEgg,
  isHatchable,
  isSupportedEggSource,
  loadIncubatorStrict,
  saveIncubatorStateWithHatchOutboxStrict,
  type Egg,
  type IncubatorState,
} from '@/game/incubator'
import { LocalStorageAdapter, type PersistenceAdapter } from '@/game/persistence'
import { tryBeginSaveOperation, setSaveOperationRunning } from '@/game/save/saveOperationGuard'

/** Durable hatch protocol (M24 Ticket 41).
 *
 * The Incubator owns the operation outbox and removes the egg only after the
 * independent roster and Meta/Dex boundaries report success. Browser storage
 * has no cross-key transaction, so every boundary keeps its own marker and
 * retries reconcile from the exact deterministic payload.
 */
export const HATCH_SCHEMA_VERSION = 1
export const HATCH_OPERATION_ID_PREFIX = `hatch:v${HATCH_SCHEMA_VERSION}:`
export const HATCH_INCUBATOR_MIRROR_KEY = 'mobie.incubator.hatch.v1'
export const HATCH_ROSTER_MARKER_KEY = 'mobie.roster.hatch.v1'
export const HATCH_META_MARKER_KEY = 'mobie.meta.hatch.v1'
export const HATCH_MARKER_LIMIT = 128

export type HatchMarkerStatus = 'pending' | 'settled'
export type HatchResultStatus = 'applied' | 'already-applied'
export type HatchErrorCode =
  | 'collision'
  | 'missing-egg'
  | 'invalid-source'
  | 'not-ready'
  | 'storage'
  | 'receipt'
  | 'child'

export interface HatchIdentity {
  hatchOperationId: string
  hatchFingerprint: string
}

/** Exact deterministic child payload copied into the incubator outbox. */
export interface HatchPayload extends HatchIdentity {
  eggId: string
  egg: Egg
  unit: OwnedUnit
  speciesId: number
  shiny: boolean
}

export interface HatchRosterReceipt extends HatchIdentity {
  status: HatchResultStatus
  unit: OwnedUnit
  appliedAt: number
}

export interface HatchMetaReceipt extends HatchIdentity {
  status: HatchResultStatus
  speciesId: number
  shiny: boolean
  meta: MetaState
  appliedAt: number
}

export interface HatchRosterMarker extends HatchIdentity {
  destination: 'hatch-roster'
  status: HatchMarkerStatus
  createdAt: number
  settledAt?: number
  canonicalApplied?: boolean
  payload: HatchPayload
  unit: OwnedUnit
  receipt: Omit<HatchRosterReceipt, 'status'>
}

export interface HatchMetaMarker extends HatchIdentity {
  destination: 'hatch-meta'
  status: HatchMarkerStatus
  createdAt: number
  settledAt?: number
  canonicalApplied?: boolean
  payload: HatchPayload
  before: MetaState
  after: MetaState
  receipt: Omit<HatchMetaReceipt, 'status'>
}

export interface HatchReceipt extends HatchIdentity {
  status: HatchResultStatus
  eggId: string
  egg: Egg
  unit: OwnedUnit
  roster: HatchRosterReceipt
  meta: HatchMetaReceipt
  appliedAt: number
}

/** Incubator-owned write-ahead entry. `receipt` is present after finalization. */
export interface HatchOutbox extends HatchIdentity {
  destination: 'incubator-hatch'
  status: HatchMarkerStatus
  eggId: string
  egg: Egg
  payload: HatchPayload
  createdAt: number
  settledAt?: number
  canonicalApplied?: boolean
  receipt?: Omit<HatchReceipt, 'status'>
}

export interface HatchRecovery {
  attempted: number
  completed: number
  receipts: HatchReceipt[]
  errors: Array<{ eggId: string; message: string; code?: HatchErrorCode }>
}

export class HatchError extends Error {
  readonly code: HatchErrorCode
  readonly identity?: HatchIdentity
  readonly eggId?: string

  constructor(
    code: HatchErrorCode,
    message: string,
    options: { identity?: HatchIdentity; eggId?: string; cause?: unknown } = {},
  ) {
    super(message)
    this.name = 'HatchError'
    this.code = code
    this.identity = options.identity
    this.eggId = options.eggId
    if (options.cause !== undefined) this.cause = options.cause
  }
}

function messageOf(cause: unknown): string {
  return cause instanceof Error && cause.message ? cause.message : String(cause)
}

function cloneEgg(egg: Egg): Egg {
  return {
    ...egg,
    speciesPool: [...egg.speciesPool],
  }
}

function cloneUnit(unit: OwnedUnit): OwnedUnit {
  return {
    ...unit,
    ivs: { ...unit.ivs },
    ...(unit.learnedMoveIds ? { learnedMoveIds: [...unit.learnedMoveIds] } : {}),
    ...(unit.equippedMoveIds ? { equippedMoveIds: [...unit.equippedMoveIds] } : {}),
  }
}

function cloneMeta(meta: MetaState): MetaState {
  return {
    schemaVersion: meta.schemaVersion,
    registered: [...meta.registered],
    seen: [...meta.seen],
    stats: { ...meta.stats },
    achievements: { ...meta.achievements },
    ...(meta.achievementClaims
      ? { achievementClaims: meta.achievementClaims.map((claim) => ({
          ...claim,
          reward: claim.reward.kind === 'egg'
            ? { kind: 'egg' as const, label: claim.reward.label, speciesPool: [...claim.reward.speciesPool] }
            : { kind: 'sp' as const, label: claim.reward.label, amount: claim.reward.amount },
          ...(claim.rewardReceipt ? { rewardReceipt: {
              ...claim.rewardReceipt,
              reward: claim.rewardReceipt.reward.kind === 'egg'
                ? { kind: 'egg' as const, label: claim.rewardReceipt.reward.label, speciesPool: [...claim.rewardReceipt.reward.speciesPool] }
                : { kind: 'sp' as const, label: claim.rewardReceipt.reward.label, amount: claim.rewardReceipt.reward.amount },
              ...(claim.rewardReceipt.egg ? { egg: cloneEgg(claim.rewardReceipt.egg) } : {}),
            } } : {}),
        })) }
      : {}),
  }
}

function clonePayload(payload: HatchPayload): HatchPayload {
  return {
    ...payload,
    egg: cloneEgg(payload.egg),
    unit: cloneUnit(payload.unit),
  }
}

function cloneRosterReceipt(receipt: HatchRosterReceipt): HatchRosterReceipt {
  return { ...receipt, unit: cloneUnit(receipt.unit) }
}

function cloneMetaReceipt(receipt: HatchMetaReceipt): HatchMetaReceipt {
  return { ...receipt, meta: cloneMeta(receipt.meta) }
}

function withoutStatus<T extends { status: HatchResultStatus }>(value: T): Omit<T, 'status'> {
  const { status: _status, ...rest } = value
  return rest
}

function cloneRosterMarker(marker: HatchRosterMarker): HatchRosterMarker {
  return {
    ...marker,
    payload: clonePayload(marker.payload),
    unit: cloneUnit(marker.unit),
    receipt: { ...marker.receipt, unit: cloneUnit(marker.receipt.unit) },
  }
}

function cloneMetaMarker(marker: HatchMetaMarker): HatchMetaMarker {
  return {
    ...marker,
    payload: clonePayload(marker.payload),
    before: cloneMeta(marker.before),
    after: cloneMeta(marker.after),
    receipt: { ...marker.receipt, meta: cloneMeta(marker.receipt.meta) },
  }
}

export function cloneHatchOutbox(entry: HatchOutbox): HatchOutbox {
  return {
    ...entry,
    egg: cloneEgg(entry.egg),
    payload: clonePayload(entry.payload),
    ...(entry.receipt ? {
      receipt: {
        ...entry.receipt,
        egg: cloneEgg(entry.receipt.egg),
        unit: cloneUnit(entry.receipt.unit),
        roster: cloneRosterReceipt(entry.receipt.roster),
        meta: cloneMetaReceipt(entry.receipt.meta),
      },
    } : {}),
  }
}

export function cloneIncubatorHatchState(state: IncubatorState): IncubatorState {
  return {
    ...state,
    eggs: state.eggs.map(cloneEgg),
    ...(state.achievementClaims ? { achievementClaims: state.achievementClaims.map((claim) => ({
      ...claim,
      reward: claim.reward.kind === 'egg'
        ? { kind: 'egg' as const, label: claim.reward.label, speciesPool: [...claim.reward.speciesPool] }
        : { kind: 'sp' as const, label: claim.reward.label, amount: claim.reward.amount },
      receipt: {
        ...claim.receipt,
        reward: claim.receipt.reward.kind === 'egg'
          ? { kind: 'egg' as const, label: claim.receipt.reward.label, speciesPool: [...claim.receipt.reward.speciesPool] }
          : { kind: 'sp' as const, label: claim.receipt.reward.label, amount: claim.receipt.reward.amount },
        ...(claim.receipt.egg ? { egg: cloneEgg(claim.receipt.egg) } : {}),
      },
    })) } : {}),
    ...(state.hatchOutbox ? { hatchOutbox: state.hatchOutbox.map(cloneHatchOutbox) } : {}),
  }
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function normalizedEgg(egg: Egg): Egg {
  const requiredProgress = Math.max(1, Math.floor(egg.requiredProgress))
  return {
    ...egg,
    speciesPool: egg.speciesPool.filter((id) => Number.isInteger(id) && id > 0),
    // Progress is a mutable presentation clock. Once an egg is ready, cap it
    // in the deterministic payload so a late progress tick cannot collide
    // with the same egg operation.
    progress: Math.min(requiredProgress, Math.max(0, Math.floor(egg.progress))),
    requiredProgress,
    label: typeof egg.label === 'string' ? egg.label : '孵化蛋',
  }
}

/** Stable operation identity is derived only from the canonical egg id. */
export function hatchOperationIdFor(eggOrId: Pick<Egg, 'id'> | string): string {
  const id = typeof eggOrId === 'string' ? eggOrId : eggOrId.id
  return `${HATCH_OPERATION_ID_PREFIX}${encodeURIComponent(id)}`
}

/** Stable fingerprint includes the exact egg snapshot and deterministic unit payload. */
export function hatchFingerprintFor(egg: Egg): string {
  const canonicalEgg = normalizedEgg(egg)
  let unit: OwnedUnit
  try { unit = hatchEgg(canonicalEgg) }
  catch (cause) {
    throw new HatchError('invalid-source', `孵化蛋「${egg.label || egg.id}」的 deterministic payload 無效：${messageOf(cause)}`, { eggId: egg.id, cause })
  }
  return `hatch-payload:v${HATCH_SCHEMA_VERSION}:${stableJson({ egg: canonicalEgg, unit })}`
}

export const hatchPayloadFingerprintFor = hatchFingerprintFor

export function hatchIdentityFor(egg: Egg): HatchIdentity {
  return {
    hatchOperationId: hatchOperationIdFor(egg),
    hatchFingerprint: hatchFingerprintFor(egg),
  }
}

const CANONICAL_REQUIRED_PROGRESS: Record<'achievement' | 'duplicate', number> = {
  achievement: 6,
  duplicate: 8,
}

/** Reject hand-authored/model-derived eggs at the hatch boundary. */
export function isCanonicalHatchEgg(egg: Egg): boolean {
  if (!isSupportedEggSource(egg.source)) return false
  if (!egg.id || !Number.isFinite(egg.progress) || egg.progress < 0) return false
  if (egg.seed !== `${egg.id}-${egg.source}`) return false
  if (egg.requiredProgress !== CANONICAL_REQUIRED_PROGRESS[egg.source]) return false
  if (!Array.isArray(egg.speciesPool) || egg.speciesPool.length === 0) return false
  return egg.speciesPool.every((speciesId) => Number.isInteger(speciesId) && speciesId > 0)
}

function invalidSource(egg: Egg): never {
  throw new HatchError(
    'invalid-source',
    `孵化蛋「${egg.label || egg.id}」的來源無效；只接受 achievement 或 duplicate。`,
    { eggId: egg.id },
  )
}

/** Validate the canonical egg and produce the exact payload saved to the outbox. */
export function prepareHatchPayload(egg: Egg): HatchPayload {
  if (!isCanonicalHatchEgg(egg)) invalidSource(egg)
  if (!isHatchable(egg)) {
    throw new HatchError('not-ready', `孵化蛋「${egg.label || egg.id}」尚未完成培育。`, { eggId: egg.id })
  }
  const canonicalEgg = normalizedEgg(egg)
  if (canonicalEgg.speciesPool.length === 0) {
    throw new HatchError('invalid-source', `孵化蛋「${egg.label || egg.id}」沒有合法物種池。`, { eggId: egg.id })
  }
  let unit: OwnedUnit
  try { unit = hatchEgg(canonicalEgg) }
  catch (cause) {
    throw new HatchError('invalid-source', `孵化蛋「${egg.label || egg.id}」無法產生 canonical 個體：${messageOf(cause)}`, { eggId: egg.id, cause })
  }
  const identity = hatchIdentityFor(canonicalEgg)
  return {
    ...identity,
    eggId: canonicalEgg.id,
    egg: cloneEgg(canonicalEgg),
    unit: cloneUnit(unit),
    speciesId: unit.speciesId,
    shiny: unit.shiny,
  }
}

function assertIdentity(existing: HatchIdentity, incoming: HatchIdentity, eggId = ''): void {
  if (
    existing.hatchOperationId !== incoming.hatchOperationId
    || existing.hatchFingerprint !== incoming.hatchFingerprint
  ) {
    throw new HatchError(
      'collision',
      `孵化識別碼碰撞：${incoming.hatchOperationId} 已綁定不同的 payload fingerprint。`,
      { identity: incoming, eggId },
    )
  }
}

function assertPayloadIdentity(identity: HatchIdentity, payload: HatchPayload): void {
  if (!isCanonicalHatchEgg(payload.egg)) invalidSource(payload.egg)
  assertIdentity(payload, identity, payload.eggId)
  if (hatchOperationIdFor(payload.eggId) !== identity.hatchOperationId) {
    throw new HatchError('collision', `孵化 payload 與 egg identity 不一致。`, { identity, eggId: payload.eggId })
  }
  let computed: string
  try { computed = hatchFingerprintFor(payload.egg) }
  catch (cause) {
    if (cause instanceof HatchError) throw cause
    throw new HatchError('collision', '孵化 payload fingerprint 無法驗證。', { identity, eggId: payload.eggId, cause })
  }
  if (computed !== identity.hatchFingerprint || payload.speciesId !== payload.unit.speciesId || payload.shiny !== payload.unit.shiny) {
    throw new HatchError('collision', `孵化 payload fingerprint 與 deterministic 個體不一致。`, { identity, eggId: payload.eggId })
  }
}

function replaceRosterMarker(markers: readonly HatchRosterMarker[], marker: HatchRosterMarker): HatchRosterMarker[] {
  const index = markers.findIndex((candidate) => candidate.hatchOperationId === marker.hatchOperationId)
  const next = [...markers]
  if (index < 0) next.push(marker)
  else next[index] = marker
  return next
}

function replaceMetaMarker(markers: readonly HatchMetaMarker[], marker: HatchMetaMarker): HatchMetaMarker[] {
  const index = markers.findIndex((candidate) => candidate.hatchOperationId === marker.hatchOperationId)
  const next = [...markers]
  if (index < 0) next.push(marker)
  else next[index] = marker
  return next
}

function replaceOutbox(entries: readonly HatchOutbox[], entry: HatchOutbox): HatchOutbox[] {
  const index = entries.findIndex((candidate) => candidate.hatchOperationId === entry.hatchOperationId)
  const next = [...entries]
  if (index < 0) next.push(entry)
  else next[index] = entry
  return next
}

function retainOutbox(entries: readonly HatchOutbox[]): HatchOutbox[] {
  const pending = entries.filter((entry) => entry.status !== 'settled')
  const settled = entries
    .filter((entry) => entry.status === 'settled')
    .sort((left, right) => (right.settledAt ?? right.createdAt) - (left.settledAt ?? left.createdAt))
    .slice(0, HATCH_MARKER_LIMIT)
  const kept = new Set([...pending, ...settled])
  return entries.filter((entry) => kept.has(entry))
}

function rosterReceipt(
  identity: HatchIdentity,
  unit: OwnedUnit,
  appliedAt: number,
  status: HatchResultStatus,
): HatchRosterReceipt {
  return { ...identity, status, unit: cloneUnit(unit), appliedAt }
}

function metaReceipt(
  identity: HatchIdentity,
  payload: HatchPayload,
  meta: MetaState,
  appliedAt: number,
  status: HatchResultStatus,
): HatchMetaReceipt {
  return {
    ...identity,
    status,
    speciesId: payload.speciesId,
    shiny: payload.shiny,
    meta: cloneMeta(meta),
    appliedAt,
  }
}

export interface HatchRosterPersistence {
  loadRoster: () => Promise<OwnedUnit[]>
  loadMarkers: () => Promise<HatchRosterMarker[]>
  /** Canonical roster and pending hatch marker share this boundary write. */
  savePending: (roster: OwnedUnit[], markers: HatchRosterMarker[], operationId?: string) => Promise<void>
  saveMarkers: (markers: HatchRosterMarker[]) => Promise<void>
}

export interface HatchMetaPersistence {
  loadMeta: () => Promise<MetaState>
  loadMarkers: () => Promise<HatchMetaMarker[]>
  /** Canonical Meta/Dex registration and pending hatch marker share this boundary write. */
  savePending: (meta: MetaState, markers: HatchMetaMarker[], operationId?: string) => Promise<void>
  saveMarkers: (markers: HatchMetaMarker[]) => Promise<void>
}

export interface HatchIncubatorPersistence {
  loadState: () => Promise<IncubatorState>
  /** Pending outbox + canonical incubator state are written together. */
  savePending: (state: IncubatorState) => Promise<void>
  /** Egg removal + settled outbox/receipt are written together. */
  saveFinal: (state: IncubatorState) => Promise<void>
}

/** Exactly-once roster child for a deterministic hatch payload. */
export class HatchRosterDestination {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly persistence: HatchRosterPersistence,
    private readonly now: () => number = () => Date.now(),
  ) {}

  applyOnce(identity: HatchIdentity, payload: HatchPayload): Promise<HatchRosterReceipt> {
    const run = this.queue.then(() => this.applySerialized(identity, payload))
    this.queue = run.catch(() => undefined)
    return run
  }

  hasApplied(identity: HatchIdentity): Promise<boolean> {
    const run = this.queue.then(async () => {
      let markers: HatchRosterMarker[]
      try { markers = await this.persistence.loadMarkers() }
      catch (cause) { throw new HatchError('storage', '讀取孵化 roster 標記失敗，請重試。', { identity, cause }) }
      const marker = markers.find((candidate) => candidate.hatchOperationId === identity.hatchOperationId)
      if (!marker) return false
      assertIdentity(marker, identity, marker.payload.eggId)
      if (marker.status === 'settled' || marker.canonicalApplied === true) return true
      try {
        const roster = await this.persistence.loadRoster()
        return roster.some((unit) => unit.id === marker.unit.id)
      } catch (cause) {
        throw new HatchError('storage', '讀取孵化 roster 失敗，請重試。', { identity, cause })
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async applySerialized(identity: HatchIdentity, payload: HatchPayload): Promise<HatchRosterReceipt> {
    assertPayloadIdentity(identity, payload)
    let markers: HatchRosterMarker[]
    try { markers = await this.persistence.loadMarkers() }
    catch (cause) { throw new HatchError('storage', '讀取孵化 roster 標記失敗，請重試。', { identity, cause }) }
    const existing = markers.find((candidate) => candidate.hatchOperationId === identity.hatchOperationId)
    if (existing) assertIdentity(existing, identity, payload.eggId)
    if (existing?.status === 'settled') {
      return { ...cloneRosterReceipt({ ...existing.receipt, status: 'already-applied' }), status: 'already-applied' }
    }

    let roster: OwnedUnit[]
    try { roster = (await this.persistence.loadRoster()).map(cloneUnit) }
    catch (cause) { throw new HatchError('storage', '讀取 canonical roster 失敗，請重試。', { identity, cause }) }

    if (existing) {
      const canonical = roster.find((unit) => unit.id === existing.unit.id)
      if (existing.canonicalApplied !== true && !canonical) {
        try {
          await this.persistence.savePending([...roster, cloneUnit(existing.unit)], markers, identity.hatchOperationId)
          existing.canonicalApplied = true
        } catch (cause) {
          throw new HatchError('storage', '恢復孵化 Mobie 失敗，請重試。', { identity, cause })
        }
      } else if (existing.canonicalApplied !== true) {
        existing.canonicalApplied = true
      }
      const settled: HatchRosterMarker = { ...existing, status: 'settled', canonicalApplied: true, settledAt: existing.settledAt ?? this.now() }
      try { await this.persistence.saveMarkers(replaceRosterMarker(markers, settled)) }
      catch (cause) { throw new HatchError('receipt', '孵化 Mobie 已寫入，但 roster 回條保存失敗；請重試。', { identity, cause }) }
      return { ...cloneRosterReceipt({ ...existing.receipt, status: 'already-applied' }), status: 'already-applied' }
    }

    const canonical = roster.find((unit) => unit.id === payload.unit.id)
    const appliedUnit = canonical ?? payload.unit
    const appliedAt = this.now()
    const receipt = rosterReceipt(identity, appliedUnit, appliedAt, 'applied')
    const pending: HatchRosterMarker = {
      ...identity,
      destination: 'hatch-roster',
      status: 'pending',
      createdAt: appliedAt,
      canonicalApplied: false,
      payload: clonePayload(payload),
      unit: cloneUnit(appliedUnit),
      receipt: withoutStatus(receipt),
    }
    try {
      await this.persistence.savePending(
        canonical ? roster : [...roster, cloneUnit(payload.unit)],
        replaceRosterMarker(markers, pending),
        identity.hatchOperationId,
      )
    } catch (cause) { throw new HatchError('storage', '保存孵化 Mobie 結果失敗，請重試。', { identity, cause }) }
    pending.canonicalApplied = true
    const settled: HatchRosterMarker = { ...pending, status: 'settled', canonicalApplied: true, settledAt: appliedAt }
    try { await this.persistence.saveMarkers(replaceRosterMarker(markers, settled)) }
    catch (cause) { throw new HatchError('receipt', '孵化 Mobie 已寫入，但 roster 回條保存失敗；請重試。', { identity, cause }) }
    return receipt
  }
}

/** Exactly-once Meta/Dex child for a deterministic hatch payload. */
export class HatchMetaDestination {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly persistence: HatchMetaPersistence,
    private readonly now: () => number = () => Date.now(),
  ) {}

  applyOnce(identity: HatchIdentity, payload: HatchPayload): Promise<HatchMetaReceipt> {
    const run = this.queue.then(() => this.applySerialized(identity, payload))
    this.queue = run.catch(() => undefined)
    return run
  }

  hasApplied(identity: HatchIdentity): Promise<boolean> {
    const run = this.queue.then(async () => {
      let markers: HatchMetaMarker[]
      try { markers = await this.persistence.loadMarkers() }
      catch (cause) { throw new HatchError('storage', '讀取孵化 Meta 標記失敗，請重試。', { identity, cause }) }
      const marker = markers.find((candidate) => candidate.hatchOperationId === identity.hatchOperationId)
      if (!marker) return false
      assertIdentity(marker, identity, marker.payload.eggId)
      if (marker.status === 'settled' || marker.canonicalApplied === true) return true
      try {
        const meta = await this.persistence.loadMeta()
        return metaAtOrBeyond(meta, marker.after)
      } catch (cause) {
        throw new HatchError('storage', '讀取 canonical Meta 失敗，請重試。', { identity, cause })
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async applySerialized(identity: HatchIdentity, payload: HatchPayload): Promise<HatchMetaReceipt> {
    assertPayloadIdentity(identity, payload)
    let markers: HatchMetaMarker[]
    try { markers = await this.persistence.loadMarkers() }
    catch (cause) { throw new HatchError('storage', '讀取孵化 Meta 標記失敗，請重試。', { identity, cause }) }
    const existing = markers.find((candidate) => candidate.hatchOperationId === identity.hatchOperationId)
    if (existing) assertIdentity(existing, identity, payload.eggId)
    if (existing?.status === 'settled') {
      return { ...cloneMetaReceipt({ ...existing.receipt, status: 'already-applied' }), status: 'already-applied' }
    }

    let meta: MetaState
    try { meta = cloneMeta(await this.persistence.loadMeta()) }
    catch (cause) { throw new HatchError('storage', '讀取 canonical Meta 失敗，請重試。', { identity, cause }) }

    if (existing) {
      if (existing.canonicalApplied !== true && !metaAtOrBeyond(meta, existing.after)) {
        try {
          await this.persistence.savePending(calculateHatchMeta(meta, existing.payload), markers, identity.hatchOperationId)
          existing.canonicalApplied = true
        } catch (cause) {
          throw new HatchError('storage', '恢復孵化圖鑑資料失敗，請重試。', { identity, cause })
        }
      } else if (existing.canonicalApplied !== true) {
        existing.canonicalApplied = true
      }
      const settled: HatchMetaMarker = { ...existing, status: 'settled', canonicalApplied: true, settledAt: existing.settledAt ?? this.now() }
      try { await this.persistence.saveMarkers(replaceMetaMarker(markers, settled)) }
      catch (cause) { throw new HatchError('receipt', '孵化圖鑑已寫入，但 Meta 回條保存失敗；請重試。', { identity, cause }) }
      return { ...cloneMetaReceipt({ ...existing.receipt, status: 'already-applied' }), status: 'already-applied' }
    }

    const after = calculateHatchMeta(meta, payload)
    const appliedAt = this.now()
    const receipt = metaReceipt(identity, payload, after, appliedAt, 'applied')
    const pending: HatchMetaMarker = {
      ...identity,
      destination: 'hatch-meta',
      status: 'pending',
      createdAt: appliedAt,
      canonicalApplied: false,
      payload: clonePayload(payload),
      before: cloneMeta(meta),
      after: cloneMeta(after),
      receipt: withoutStatus(receipt),
    }
    try { await this.persistence.savePending(after, replaceMetaMarker(markers, pending), identity.hatchOperationId) }
    catch (cause) { throw new HatchError('storage', '保存孵化圖鑑結果失敗，請重試。', { identity, cause }) }
    pending.canonicalApplied = true
    const settled: HatchMetaMarker = { ...pending, status: 'settled', canonicalApplied: true, settledAt: appliedAt }
    try { await this.persistence.saveMarkers(replaceMetaMarker(markers, settled)) }
    catch (cause) { throw new HatchError('receipt', '孵化圖鑑已寫入，但 Meta 回條保存失敗；請重試。', { identity, cause }) }
    return receipt
  }
}

/** Hatch metadata registration + account capture/shiny counters, applied once per egg. */
export function calculateHatchMeta(meta: MetaState, payload: Pick<HatchPayload, 'speciesId' | 'shiny'>): MetaState {
  let next = addRegistered(meta, [payload.speciesId])
  next = bumpStat(next, 'captures')
  if (payload.shiny) next = bumpStat(next, 'shinies')
  return next
}

function metaAtOrBeyond(current: MetaState, expected: MetaState): boolean {
  const stats = (Object.keys(expected.stats) as Array<keyof MetaState['stats']>)
  return expected.registered.every((id) => current.registered.includes(id))
    && stats.every((key) => current.stats[key] >= expected.stats[key])
}

export interface HatchDependencies {
  incubator: HatchIncubatorPersistence
  roster: HatchRosterDestination
  meta: HatchMetaDestination
}

/** Serializes pending outbox → roster child → Meta child → incubator finalize. */
export class HatchCoordinator {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly dependencies: HatchDependencies,
    private readonly now: () => number = () => Date.now(),
  ) {}

  hatchOnce(eggId: string): Promise<HatchReceipt> {
    if (!tryBeginSaveOperation('hatch')) return Promise.reject(new Error('存檔操作正在進行中，請稍候再試。'))
    const run = this.queue.then(() => this.hatchSerialized(eggId))
    run.then(
      () => setSaveOperationRunning('hatch', false),
      () => setSaveOperationRunning('hatch', false),
    )
    this.queue = run.catch(() => undefined)
    return run
  }

  hatch(eggId: string): Promise<HatchReceipt> {
    return this.hatchOnce(eggId)
  }

  hasPending(): Promise<boolean> {
    const run = this.queue.then(async () => {
      try {
        const state = await this.dependencies.incubator.loadState()
        return (state.hatchOutbox ?? []).some((entry) => entry.status === 'pending')
      } catch (cause) {
        throw new HatchError('storage', '讀取孵化待辦失敗，請重試。', { cause })
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  recoverPending(): Promise<HatchRecovery> {
    if (!tryBeginSaveOperation('hatch')) return Promise.reject(new Error('存檔操作正在進行中，請稍候再試。'))
    const run = this.queue.then(async () => {
      let state: IncubatorState
      try { state = await this.dependencies.incubator.loadState() }
      catch (cause) {
        return { attempted: 0, completed: 0, receipts: [], errors: [{ eggId: '*', message: `讀取孵化待辦失敗：${messageOf(cause)}`, code: 'storage' as const }] }
      }
      const pending = (state.hatchOutbox ?? []).filter((entry) => entry.status === 'pending')
      const errors: HatchRecovery['errors'] = []
      const receipts: HatchReceipt[] = []
      for (const entry of pending) {
        try {
          receipts.push(await this.hatchSerialized(entry.eggId))
        } catch (cause) {
          errors.push({ eggId: entry.eggId, message: messageOf(cause), ...(cause instanceof HatchError ? { code: cause.code } : {}) })
        }
      }
      return { attempted: pending.length, completed: receipts.length, receipts, errors }
    })
    run.then(
      () => setSaveOperationRunning('hatch', false),
      () => setSaveOperationRunning('hatch', false),
    )
    this.queue = run.catch(() => undefined)
    return run
  }

  private async child<T>(
    identity: HatchIdentity,
    payload: HatchPayload,
    destination: { hasApplied: (identity: HatchIdentity) => Promise<boolean>; applyOnce: (identity: HatchIdentity, payload: HatchPayload) => Promise<T> },
  ): Promise<T> {
    try {
      // hasApplied is an explicit reconciliation probe. applyOnce then
      // finalizes any pending marker and returns the durable receipt without a
      // second canonical mutation.
      await destination.hasApplied(identity)
      return await destination.applyOnce(identity, payload)
    } catch (cause) {
      if (cause instanceof HatchError) throw cause
      throw new HatchError('child', `孵化獎勵 boundary 寫入失敗：${messageOf(cause)}`, { identity, eggId: payload.eggId, cause })
    }
  }

  private async hatchSerialized(eggId: string): Promise<HatchReceipt> {
    let state: IncubatorState
    try { state = cloneIncubatorHatchState(await this.dependencies.incubator.loadState()) }
    catch (cause) { throw new HatchError('storage', '讀取 canonical 孵化所失敗，請重試。', { eggId, cause }) }

    const entries = state.hatchOutbox ?? []
    const existing = entries.find((entry) => entry.eggId === eggId)
    if (existing) {
      assertPayloadIdentity(existing, existing.payload)
      if (existing.status === 'settled' && existing.receipt) {
        return hatchReceiptFromOutbox(existing, 'already-applied')
      }
    }

    let pending: HatchOutbox
    let payload: HatchPayload
    let wasPending = false
    if (existing) {
      wasPending = true
      pending = cloneHatchOutbox(existing)
      payload = clonePayload(existing.payload)
      const currentEgg = state.eggs.find((egg) => egg.id === eggId)
      if (currentEgg && hatchFingerprintFor(currentEgg) !== existing.hatchFingerprint) {
        throw new HatchError('collision', `孵化蛋「${eggId}」已被改寫，無法沿用原始 payload。`, {
          identity: { hatchOperationId: existing.hatchOperationId, hatchFingerprint: existing.hatchFingerprint },
          eggId,
        })
      }
    } else {
      const egg = state.eggs.find((candidate) => candidate.id === eggId)
      if (!egg) {
        throw new HatchError('missing-egg', `找不到孵化蛋「${eggId}」；請重新載入孵化所。`, { eggId })
      }
      payload = prepareHatchPayload(egg)
      const createdAt = this.now()
      pending = {
        ...hatchIdentityFor(payload.egg),
        destination: 'incubator-hatch',
        status: 'pending',
        eggId: payload.eggId,
        egg: cloneEgg(payload.egg),
        payload: clonePayload(payload),
        createdAt,
        canonicalApplied: false,
      }
      try {
        await this.dependencies.incubator.savePending({
          ...state,
          hatchOutbox: retainOutbox(replaceOutbox(entries, pending)),
        })
      } catch (cause) {
        throw new HatchError('storage', '保存孵化待辦失敗，請重試。', { identity: pending, eggId, cause })
      }
      state = await this.loadIncubatorAfterPending(pending)
    }

    const identity: HatchIdentity = {
      hatchOperationId: pending.hatchOperationId,
      hatchFingerprint: pending.hatchFingerprint,
    }
    const roster = await this.child(identity, payload, this.dependencies.roster)
    const meta = await this.child(identity, payload, this.dependencies.meta)

    let latest: IncubatorState
    try { latest = cloneIncubatorHatchState(await this.dependencies.incubator.loadState()) }
    catch (cause) { throw new HatchError('storage', '讀取孵化完成狀態失敗；子 boundary 已完成，請重試。', { identity, eggId, cause }) }
    const latestEntry = (latest.hatchOutbox ?? []).find((entry) => entry.hatchOperationId === identity.hatchOperationId)
    if (latestEntry && latestEntry.hatchFingerprint !== identity.hatchFingerprint) {
      throw new HatchError('collision', `孵化待辦「${eggId}」的 fingerprint 已改變。`, { identity, eggId })
    }
    if (!latestEntry) {
      throw new HatchError('receipt', '孵化子 boundary 已完成，但找不到 canonical 孵化待辦；請重試以完成對帳。', {
        identity,
        eggId,
      })
    }
    const current = latestEntry
    const receipt: HatchReceipt = {
      ...identity,
      status: wasPending || roster.status === 'already-applied' || meta.status === 'already-applied' ? 'already-applied' : 'applied',
      eggId,
      egg: cloneEgg(current.egg),
      unit: cloneUnit(payload.unit),
      roster: cloneRosterReceipt(roster),
      meta: cloneMetaReceipt(meta),
      appliedAt: current.createdAt,
    }
    const settled: HatchOutbox = {
      ...current,
      status: 'settled',
      canonicalApplied: true,
      settledAt: current.settledAt ?? this.now(),
      receipt: withoutStatus(receipt),
    }
    const finalState: IncubatorState = {
      ...latest,
      eggs: latest.eggs.filter((egg) => egg.id !== eggId),
      hatchOutbox: retainOutbox(replaceOutbox(latest.hatchOutbox ?? [], settled)),
    }
    try { await this.dependencies.incubator.saveFinal(finalState) }
    catch (cause) {
      throw new HatchError('receipt', 'roster 與圖鑑已寫入，但孵化所回條保存失敗；請重試以完成對帳。', { identity, eggId, cause })
    }
    return receipt
  }

  private async loadIncubatorAfterPending(pending: HatchOutbox): Promise<IncubatorState> {
    try {
      const state = cloneIncubatorHatchState(await this.dependencies.incubator.loadState())
      const entry = (state.hatchOutbox ?? []).find((candidate) => candidate.hatchOperationId === pending.hatchOperationId)
      if (!entry) throw new Error('hatch outbox disappeared after pending write')
      assertIdentity(entry, pending, pending.eggId)
      return state
    } catch (cause) {
      if (cause instanceof HatchError) throw cause
      throw new HatchError('storage', '孵化待辦寫入後無法重新讀取，請重試。', { identity: pending, eggId: pending.eggId, cause })
    }
  }
}

function hatchReceiptFromOutbox(entry: HatchOutbox, status: HatchResultStatus): HatchReceipt {
  if (entry.receipt) {
    return {
      ...entry.receipt,
      status,
      egg: cloneEgg(entry.receipt.egg),
      unit: cloneUnit(entry.receipt.unit),
      roster: cloneRosterReceipt({ ...entry.receipt.roster, status: 'already-applied' }),
      meta: cloneMetaReceipt({ ...entry.receipt.meta, status: 'already-applied' }),
    }
  }
  throw new HatchError('receipt', `孵化蛋「${entry.eggId}」缺少完成回條，請重試。`, {
    identity: entry,
    eggId: entry.eggId,
  })
}

// ── Browser persistence ────────────────────────────────────────────────

interface StorageLike {
  getItem: (key: string) => string | null
  setItem: (key: string, value: string) => void
}

function safeStorage(): StorageLike | null {
  if (typeof localStorage === 'undefined') return null
  try {
    const storage = localStorage
    storage.getItem('__mobie_hatch_probe__')
    return storage
  } catch {
    return null
  }
}

function parseArray<T>(raw: string | null): T[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed as T[] : []
  } catch {
    return []
  }
}

function readEmbeddedArray<T>(storage: StorageLike | null, key: string, field: string, mirrorKey: string): T[] {
  if (!storage) return []
  try {
    const raw = storage.getItem(key)
    if (raw) {
      const parsed: unknown = JSON.parse(raw)
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const embedded = (parsed as Record<string, unknown>)[field]
        if (Array.isArray(embedded)) return embedded as T[]
      }
    }
  } catch { /* use mirror */ }
  return parseArray<T>(storage.getItem(mirrorKey))
}

function saveMirror(storage: StorageLike | null, key: string, value: unknown): void {
  try { storage?.setItem(key, JSON.stringify(value)) } catch { /* canonical envelope is authoritative */ }
}

export class LocalStorageHatchIncubatorPersistence implements HatchIncubatorPersistence {
  constructor(
    private readonly incubator: {
      loadState: () => Promise<IncubatorState> | IncubatorState
      saveStateWithHatchOutbox: (state: IncubatorState) => Promise<void> | void
    } = {
      loadState: loadIncubatorStrict,
      saveStateWithHatchOutbox: saveIncubatorStateWithHatchOutboxStrict,
    },
    private readonly onCanonicalWrite?: (state: IncubatorState) => void,
  ) {}

  loadState(): Promise<IncubatorState> { return Promise.resolve(this.incubator.loadState()) }

  async savePending(state: IncubatorState): Promise<void> {
    try {
      await this.incubator.saveStateWithHatchOutbox(state)
      this.onCanonicalWrite?.(state)
      saveMirror(safeStorage(), HATCH_INCUBATOR_MIRROR_KEY, state.hatchOutbox ?? [])
    } catch (cause) {
      throw new Error(`保存孵化待辦失敗：${messageOf(cause)}`)
    }
  }

  async saveFinal(state: IncubatorState): Promise<void> {
    try {
      await this.incubator.saveStateWithHatchOutbox(state)
      this.onCanonicalWrite?.(state)
      saveMirror(safeStorage(), HATCH_INCUBATOR_MIRROR_KEY, state.hatchOutbox ?? [])
    } catch (cause) {
      throw new Error(`保存孵化完成資料失敗：${messageOf(cause)}`)
    }
  }
}

export class LocalStorageHatchRosterPersistence implements HatchRosterPersistence {
  private readonly storage: StorageLike | null

  constructor(
    private readonly roster: {
      loadRoster: () => Promise<OwnedUnit[]>
      saveRoster: (units: OwnedUnit[]) => Promise<void>
      saveRosterWithHatchMarkers?: (units: OwnedUnit[], markers: unknown[]) => Promise<void>
    } = (() => {
      const adapter: PersistenceAdapter = new LocalStorageAdapter()
      return {
        loadRoster: adapter.loadRoster.bind(adapter),
        saveRoster: (adapter.saveRosterStrict ?? adapter.saveRoster).bind(adapter),
        saveRosterWithHatchMarkers: adapter.saveRosterWithHatchMarkersStrict?.bind(adapter),
      }
    })(),
    storage: StorageLike | null = safeStorage(),
    private readonly onCanonicalWrite?: (roster: OwnedUnit[]) => void,
  ) {
    this.storage = storage
  }

  loadRoster(): Promise<OwnedUnit[]> { return this.roster.loadRoster() }

  async loadMarkers(): Promise<HatchRosterMarker[]> {
    return readEmbeddedArray<HatchRosterMarker>(this.storage, 'mobie.roster.v2', 'hatchSettlements', HATCH_ROSTER_MARKER_KEY)
  }

  async savePending(roster: OwnedUnit[], markers: HatchRosterMarker[], operationId?: string): Promise<void> {
    const completed = markers.map((marker) => marker.hatchOperationId === operationId ? { ...marker, canonicalApplied: true } : marker)
    try {
      if (this.roster.saveRosterWithHatchMarkers) {
        await this.roster.saveRosterWithHatchMarkers(roster, completed)
      } else {
        saveMirror(this.storage, HATCH_ROSTER_MARKER_KEY, completed)
        await this.roster.saveRoster(roster)
      }
      this.onCanonicalWrite?.(roster)
      saveMirror(this.storage, HATCH_ROSTER_MARKER_KEY, completed)
    } catch (cause) { throw new Error(`保存孵化 roster 資料失敗：${messageOf(cause)}`) }
  }

  async saveMarkers(markers: HatchRosterMarker[]): Promise<void> {
    try {
      if (this.roster.saveRosterWithHatchMarkers) {
        const roster = await this.roster.loadRoster()
        await this.roster.saveRosterWithHatchMarkers(roster, markers)
      }
      saveMirror(this.storage, HATCH_ROSTER_MARKER_KEY, markers)
    } catch (cause) { throw new Error(`保存孵化 roster 回條失敗：${messageOf(cause)}`) }
  }
}

export class LocalStorageHatchMetaPersistence implements HatchMetaPersistence {
  private readonly storage: StorageLike | null

  constructor(
    private readonly meta: {
      loadMeta: () => Promise<MetaState> | MetaState
      saveMeta: (meta: MetaState) => Promise<void> | void
      saveMetaWithHatchMarkers?: (meta: MetaState, markers: unknown[]) => Promise<void> | void
    } = {
      loadMeta: loadMetaStrict,
      saveMeta: saveMetaStateStrict,
    },
    storage: StorageLike | null = safeStorage(),
    private readonly onCanonicalWrite?: (meta: MetaState) => void,
  ) {
    this.storage = storage
  }

  loadMeta(): Promise<MetaState> { return Promise.resolve(this.meta.loadMeta()) }

  async loadMarkers(): Promise<HatchMetaMarker[]> {
    return readEmbeddedArray<HatchMetaMarker>(this.storage, 'mobie.meta.v1', 'hatchSettlements', HATCH_META_MARKER_KEY)
  }

  async savePending(meta: MetaState, markers: HatchMetaMarker[], operationId?: string): Promise<void> {
    const completed = markers.map((marker) => marker.hatchOperationId === operationId ? { ...marker, canonicalApplied: true } : marker)
    try {
      if (this.meta.saveMetaWithHatchMarkers) await this.meta.saveMetaWithHatchMarkers(meta, completed)
      else {
        saveMirror(this.storage, HATCH_META_MARKER_KEY, completed)
        await this.meta.saveMeta(meta)
      }
      this.onCanonicalWrite?.(meta)
      saveMirror(this.storage, HATCH_META_MARKER_KEY, completed)
    } catch (cause) { throw new Error(`保存孵化圖鑑資料失敗：${messageOf(cause)}`) }
  }

  async saveMarkers(markers: HatchMetaMarker[]): Promise<void> {
    try {
      const meta = await this.meta.loadMeta()
      if (this.meta.saveMetaWithHatchMarkers) await this.meta.saveMetaWithHatchMarkers(meta, markers)
      saveMirror(this.storage, HATCH_META_MARKER_KEY, markers)
    } catch (cause) { throw new Error(`保存孵化圖鑑回條失敗：${messageOf(cause)}`) }
  }
}

// ── Test-friendly memory boundaries ────────────────────────────────────

export class MemoryHatchIncubatorPersistence implements HatchIncubatorPersistence {
  state: IncubatorState
  failPending = false
  failFinal = false
  savePendingCount = 0
  saveFinalCount = 0

  constructor(state: IncubatorState) { this.state = cloneIncubatorHatchState(state) }

  async loadState(): Promise<IncubatorState> { return cloneIncubatorHatchState(this.state) }

  async savePending(state: IncubatorState): Promise<void> {
    if (this.failPending) throw new Error('hatch incubator pending write failed')
    this.savePendingCount += 1
    this.state = cloneIncubatorHatchState(state)
  }

  async saveFinal(state: IncubatorState): Promise<void> {
    if (this.failFinal) throw new Error('hatch incubator final write failed')
    this.saveFinalCount += 1
    this.state = cloneIncubatorHatchState(state)
  }
}

export class MemoryHatchRosterPersistence implements HatchRosterPersistence {
  roster: OwnedUnit[]
  markers: HatchRosterMarker[] = []
  failPending = false
  failMarker = false
  savePendingCount = 0

  constructor(roster: OwnedUnit[] = []) { this.roster = roster.map(cloneUnit) }

  async loadRoster(): Promise<OwnedUnit[]> { return this.roster.map(cloneUnit) }
  async loadMarkers(): Promise<HatchRosterMarker[]> { return this.markers.map(cloneRosterMarker) }

  async savePending(roster: OwnedUnit[], markers: HatchRosterMarker[], operationId?: string): Promise<void> {
    if (this.failPending) throw new Error('hatch roster pending write failed')
    this.savePendingCount += 1
    this.roster = roster.map(cloneUnit)
    this.markers = markers.map((marker) => marker.hatchOperationId === operationId
      ? { ...cloneRosterMarker(marker), canonicalApplied: true }
      : cloneRosterMarker(marker))
  }

  async saveMarkers(markers: HatchRosterMarker[]): Promise<void> {
    if (this.failMarker) throw new Error('hatch roster marker write failed')
    this.markers = markers.map(cloneRosterMarker)
  }
}

export class MemoryHatchMetaPersistence implements HatchMetaPersistence {
  meta: MetaState
  markers: HatchMetaMarker[] = []
  failPending = false
  failMarker = false
  savePendingCount = 0

  constructor(meta: MetaState) { this.meta = cloneMeta(meta) }

  async loadMeta(): Promise<MetaState> { return cloneMeta(this.meta) }
  async loadMarkers(): Promise<HatchMetaMarker[]> { return this.markers.map(cloneMetaMarker) }

  async savePending(meta: MetaState, markers: HatchMetaMarker[], operationId?: string): Promise<void> {
    if (this.failPending) throw new Error('hatch Meta pending write failed')
    this.savePendingCount += 1
    this.meta = cloneMeta(meta)
    this.markers = markers.map((marker) => marker.hatchOperationId === operationId
      ? { ...cloneMetaMarker(marker), canonicalApplied: true }
      : cloneMetaMarker(marker))
  }

  async saveMarkers(markers: HatchMetaMarker[]): Promise<void> {
    if (this.failMarker) throw new Error('hatch Meta marker write failed')
    this.markers = markers.map(cloneMetaMarker)
  }
}

// Descriptive aliases keep the seam discoverable to callers that use the
// Incubator-prefixed vocabulary from the ticket.
export { HatchCoordinator as IncubatorHatchCoordinator }
export { HatchRosterDestination as IncubatorHatchRosterDestination }
export { HatchMetaDestination as IncubatorHatchMetaDestination }
