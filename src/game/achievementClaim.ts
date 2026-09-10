import { addEgg, type Egg, type IncubatorState } from '@/game/incubator'
import {
  computeAchievements,
  getAchievement,
  type AchievementReward,
} from '@/game/achievements'
import { markClaimed, type MetaState } from '@/game/meta'
import type { HatchOutbox } from '@/game/incubatorHatch'

/**
 * Durable achievement claim protocol (M24 Ticket 40).
 *
 * The Meta boundary writes a pending outbox entry before a reward boundary is
 * touched. Egg and SP destinations each own their own applyOnce marker. There
 * is intentionally no claim-wide transaction: a reward can be durable while
 * the final Meta receipt still needs a retry.
 */
export const ACHIEVEMENT_CLAIM_SCHEMA_VERSION = 1
export const ACHIEVEMENT_CLAIM_META_MIRROR_KEY = 'mobie.achievement.claim.meta.v1'
export const ACHIEVEMENT_CLAIM_EGG_MIRROR_KEY = 'mobie.achievement.claim.incubator.v1'
export const ACHIEVEMENT_CLAIM_SP_MIRROR_KEY = 'mobie.achievement.claim.sp.v1'

export type AchievementClaimMarkerStatus = 'pending' | 'settled'
export type AchievementClaimResultStatus = 'applied' | 'already-applied'
export type AchievementClaimErrorCode = 'collision' | 'locked' | 'claimed' | 'storage' | 'reward' | 'receipt'

export interface AchievementClaimIdentity {
  claimOperationId: string
  rewardFingerprint: string
}

export interface AchievementClaimPayload {
  achievementId: string
  reward: AchievementReward
}

export interface AchievementRewardReceipt extends AchievementClaimIdentity {
  status: AchievementClaimResultStatus
  achievementId: string
  reward: AchievementReward
  kind: AchievementReward['kind']
  egg?: Egg
  delta?: number
  before?: number
  after?: number
  appliedAt: number
}

/** Meta-owned write-ahead outbox. The reward payload is copied into the entry. */
export interface AchievementClaimOutbox extends AchievementClaimIdentity {
  destination: 'achievement-meta'
  status: AchievementClaimMarkerStatus
  achievementId: string
  reward: AchievementReward
  createdAt: number
  settledAt?: number
  canonicalApplied?: boolean
  rewardReceipt?: AchievementRewardReceipt
}

/** Marker owned by one reward boundary (incubator or SP). */
export interface AchievementRewardMarker extends AchievementClaimIdentity {
  destination: 'achievement-egg' | 'achievement-sp'
  status: AchievementClaimMarkerStatus
  achievementId: string
  reward: AchievementReward
  createdAt: number
  settledAt?: number
  /** Set in the same canonical write as the reward payload. */
  canonicalApplied?: boolean
  /** Receipt without the mutable status field, retained for reconciliation. */
  receipt: Omit<AchievementRewardReceipt, 'status'>
}

export interface AchievementClaimResult extends AchievementClaimIdentity {
  status: AchievementClaimResultStatus
  achievementId: string
  reward: AchievementReward
  rewardReceipt?: AchievementRewardReceipt
  meta: MetaState
}

export interface AchievementClaimRecovery {
  attempted: number
  completed: number
  errors: Array<{ achievementId: string; message: string; code?: AchievementClaimErrorCode }>
}

export class AchievementClaimError extends Error {
  readonly code: AchievementClaimErrorCode
  readonly identity?: AchievementClaimIdentity
  readonly achievementId?: string

  constructor(
    code: AchievementClaimErrorCode,
    message: string,
    options: { identity?: AchievementClaimIdentity; achievementId?: string; cause?: unknown } = {},
  ) {
    super(message)
    this.name = 'AchievementClaimError'
    this.code = code
    this.identity = options.identity
    this.achievementId = options.achievementId
    if (options.cause !== undefined) this.cause = options.cause
  }
}

function cloneEgg(egg: Egg): Egg {
  return { ...egg, speciesPool: [...egg.speciesPool] }
}

function cloneReward(reward: AchievementReward): AchievementReward {
  return reward.kind === 'egg'
    ? { kind: 'egg', label: reward.label, speciesPool: [...reward.speciesPool] }
    : { kind: 'sp', label: reward.label, amount: reward.amount }
}

function cloneReceipt(receipt: AchievementRewardReceipt): AchievementRewardReceipt {
  return {
    ...receipt,
    reward: cloneReward(receipt.reward),
    ...(receipt.egg ? { egg: cloneEgg(receipt.egg) } : {}),
  }
}

function cloneOutbox(entry: AchievementClaimOutbox): AchievementClaimOutbox {
  return {
    ...entry,
    reward: cloneReward(entry.reward),
    ...(entry.rewardReceipt ? { rewardReceipt: cloneReceipt(entry.rewardReceipt) } : {}),
  }
}

function cloneMarker(entry: AchievementRewardMarker): AchievementRewardMarker {
  return {
    ...entry,
    reward: cloneReward(entry.reward),
    receipt: {
      ...entry.receipt,
      reward: cloneReward(entry.receipt.reward),
      ...(entry.receipt.egg ? { egg: cloneEgg(entry.receipt.egg) } : {}),
    },
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
      ? { achievementClaims: meta.achievementClaims.map(cloneOutbox) }
      : {}),
  }
}

function cloneHatchOutbox(entry: HatchOutbox): HatchOutbox {
  return {
    ...entry,
    egg: cloneEgg(entry.egg),
    payload: {
      ...entry.payload,
      egg: cloneEgg(entry.payload.egg),
      unit: {
        ...entry.payload.unit,
        ivs: { ...entry.payload.unit.ivs },
        ...(entry.payload.unit.learnedMoveIds ? { learnedMoveIds: [...entry.payload.unit.learnedMoveIds] } : {}),
        ...(entry.payload.unit.equippedMoveIds ? { equippedMoveIds: [...entry.payload.unit.equippedMoveIds] } : {}),
      },
    },
    ...(entry.receipt ? {
      receipt: {
        ...entry.receipt,
        egg: cloneEgg(entry.receipt.egg),
        unit: {
          ...entry.receipt.unit,
          ivs: { ...entry.receipt.unit.ivs },
          ...(entry.receipt.unit.learnedMoveIds ? { learnedMoveIds: [...entry.receipt.unit.learnedMoveIds] } : {}),
          ...(entry.receipt.unit.equippedMoveIds ? { equippedMoveIds: [...entry.receipt.unit.equippedMoveIds] } : {}),
        },
        roster: {
          ...entry.receipt.roster,
          unit: {
            ...entry.receipt.roster.unit,
            ivs: { ...entry.receipt.roster.unit.ivs },
            ...(entry.receipt.roster.unit.learnedMoveIds ? { learnedMoveIds: [...entry.receipt.roster.unit.learnedMoveIds] } : {}),
            ...(entry.receipt.roster.unit.equippedMoveIds ? { equippedMoveIds: [...entry.receipt.roster.unit.equippedMoveIds] } : {}),
          },
        },
        meta: {
          ...entry.receipt.meta,
          meta: cloneMeta(entry.receipt.meta.meta),
        },
      },
    } : {}),
  }
}

function cloneIncubatorState(state: IncubatorState): IncubatorState {
  return {
    schemaVersion: state.schemaVersion,
    nextId: state.nextId,
    eggs: state.eggs.map(cloneEgg),
    ...(state.achievementClaims
      ? { achievementClaims: state.achievementClaims.map(cloneMarker) }
      : {}),
    ...(state.hatchOutbox
      ? { hatchOutbox: state.hatchOutbox.map(cloneHatchOutbox) }
      : {}),
  }
}

function replaceOutbox(entries: readonly AchievementClaimOutbox[], entry: AchievementClaimOutbox): AchievementClaimOutbox[] {
  const index = entries.findIndex((candidate) => candidate.claimOperationId === entry.claimOperationId)
  const next = [...entries]
  if (index < 0) next.push(entry)
  else next[index] = entry
  return next
}

function replaceRewardMarker(entries: readonly AchievementRewardMarker[], entry: AchievementRewardMarker): AchievementRewardMarker[] {
  const index = entries.findIndex((candidate) => candidate.claimOperationId === entry.claimOperationId)
  const next = [...entries]
  if (index < 0) next.push(entry)
  else next[index] = entry
  return next
}

function withoutStatus(receipt: AchievementRewardReceipt): Omit<AchievementRewardReceipt, 'status'> {
  const { status: _status, ...rest } = receipt
  return rest
}

function messageOf(cause: unknown): string {
  return cause instanceof Error && cause.message ? cause.message : String(cause)
}

/** Normalize a reward before it becomes durable claim payload. */
export function normalizeAchievementReward(reward: AchievementReward): AchievementReward {
  if (reward.kind === 'egg') {
    const label = typeof reward.label === 'string' && reward.label.trim() ? reward.label.trim() : '成就蛋'
    const speciesPool = Array.isArray(reward.speciesPool)
      ? reward.speciesPool.filter((speciesId) => Number.isInteger(speciesId) && speciesId > 0)
      : []
    if (speciesPool.length === 0) throw new Error('成就蛋獎勵缺少合法物種池')
    return { kind: 'egg', label, speciesPool: [...speciesPool] }
  }
  if (reward.kind === 'sp') {
    const label = typeof reward.label === 'string' && reward.label.trim() ? reward.label.trim() : '成就 SP'
    const amount = Number.isFinite(reward.amount) ? Math.max(0, Math.floor(reward.amount)) : 0
    return { kind: 'sp', label, amount }
  }
  throw new Error('成就獎勵種類無效')
}

/** Stable namespaced operation ID: one achievement can be claimed once. */
export function claimOperationIdFor(achievementId: string): string {
  return `achievement-claim:v${ACHIEVEMENT_CLAIM_SCHEMA_VERSION}:${encodeURIComponent(achievementId)}`
}

/** Stable reward fingerprint detects an operation ID reused with changed reward data. */
export function rewardFingerprintFor(achievementId: string, reward: AchievementReward): string {
  const normalized = normalizeAchievementReward(reward)
  return `achievement-reward:v${ACHIEVEMENT_CLAIM_SCHEMA_VERSION}:${JSON.stringify({ achievementId, reward: normalized })}`
}

export function identityFor(achievementId: string, reward: AchievementReward): AchievementClaimIdentity {
  return {
    claimOperationId: claimOperationIdFor(achievementId),
    rewardFingerprint: rewardFingerprintFor(achievementId, reward),
  }
}

function assertIdentity(existing: AchievementClaimIdentity, incoming: AchievementClaimIdentity, achievementId: string): void {
  if (
    existing.claimOperationId !== incoming.claimOperationId
    || existing.rewardFingerprint !== incoming.rewardFingerprint
  ) {
    throw new AchievementClaimError(
      'collision',
      `成就領取識別碼碰撞：${incoming.claimOperationId} 已綁定不同的 reward fingerprint。`,
      { identity: incoming, achievementId },
    )
  }
}

function storageError(identity: AchievementClaimIdentity, achievementId: string, message: string, cause: unknown): AchievementClaimError {
  return new AchievementClaimError('storage', message, { identity, achievementId, cause })
}

function receiptError(identity: AchievementClaimIdentity, achievementId: string, message: string, cause: unknown): AchievementClaimError {
  return new AchievementClaimError('receipt', message, { identity, achievementId, cause })
}

function rewardError(identity: AchievementClaimIdentity, achievementId: string, message: string, cause?: unknown): AchievementClaimError {
  return new AchievementClaimError('reward', message, { identity, achievementId, cause })
}

export interface AchievementMetaPersistence {
  loadMeta: () => Promise<MetaState>
  /** Pending outbox and Meta payload share one canonical write. */
  savePending: (meta: MetaState) => Promise<void>
  /** Final claimed flag, settled outbox, and receipt share one canonical write. */
  saveFinal: (meta: MetaState) => Promise<void>
}

export interface AchievementEggPersistence {
  loadState: () => Promise<IncubatorState>
  loadMarkers: () => Promise<AchievementRewardMarker[]>
  /** Egg and pending marker share one canonical write. */
  savePending: (state: IncubatorState, markers: AchievementRewardMarker[], operationId?: string) => Promise<void>
  saveMarkers: (markers: AchievementRewardMarker[]) => Promise<void>
}

export interface AchievementSpPersistence {
  loadPoints: () => Promise<number>
  loadMarkers: () => Promise<AchievementRewardMarker[]>
  /** SP and pending marker share one canonical write. */
  savePending: (points: number, markers: AchievementRewardMarker[], operationId?: string) => Promise<void>
  saveMarkers: (markers: AchievementRewardMarker[]) => Promise<void>
}

function rewardReceipt(
  identity: AchievementClaimIdentity,
  payload: AchievementClaimPayload,
  appliedAt: number,
  fields: Partial<Pick<AchievementRewardReceipt, 'egg' | 'delta' | 'before' | 'after'>>,
  status: AchievementClaimResultStatus,
): AchievementRewardReceipt {
  return {
    ...identity,
    status,
    achievementId: payload.achievementId,
    reward: cloneReward(payload.reward),
    kind: payload.reward.kind,
    ...fields,
    appliedAt,
  }
}

function achievementEggFromMarker(state: IncubatorState, marker: AchievementRewardMarker): IncubatorState {
  const egg = marker.receipt.egg
  if (!egg) return state
  if (state.eggs.some((candidate) => candidate.id === egg.id)) return state
  const numericId = Number(egg.id.replace(/^egg-/, ''))
  return {
    ...cloneIncubatorState(state),
    eggs: [...state.eggs.map(cloneEgg), cloneEgg(egg)],
    nextId: Math.max(state.nextId, Number.isFinite(numericId) ? numericId + 1 : state.nextId),
  }
}

/** Exactly-once achievement egg destination. This is the only claim writer that creates achievement eggs. */
export class AchievementEggDestination {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly persistence: AchievementEggPersistence,
    private readonly now: () => number = () => Date.now(),
  ) {}

  applyOnce(identity: AchievementClaimIdentity, payload: AchievementClaimPayload): Promise<AchievementRewardReceipt> {
    const run = this.queue.then(() => this.applySerialized(identity, payload))
    this.queue = run.catch(() => undefined)
    return run
  }

  hasApplied(identity: AchievementClaimIdentity): Promise<boolean> {
    const run = this.queue.then(async () => {
      try {
        const marker = (await this.persistence.loadMarkers()).find((candidate) => candidate.claimOperationId === identity.claimOperationId)
        if (!marker) return false
        assertIdentity(marker, identity, marker.achievementId)
        return marker.status === 'settled' || marker.canonicalApplied === true
      } catch (cause) {
        if (cause instanceof AchievementClaimError) throw cause
        throw storageError(identity, '', '讀取成就蛋領取標記失敗，請重試。', cause)
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async applySerialized(identity: AchievementClaimIdentity, payload: AchievementClaimPayload): Promise<AchievementRewardReceipt> {
    const reward = (() => {
      try { return normalizeAchievementReward(payload.reward) }
      catch (cause) { throw rewardError(identity, payload.achievementId, `成就獎勵資料無效：${messageOf(cause)}`, cause) }
    })()
    if (reward.kind !== 'egg') throw rewardError(identity, payload.achievementId, '此成就獎勵不是孵化所蛋。')

    let markers: AchievementRewardMarker[]
    try { markers = await this.persistence.loadMarkers() }
    catch (cause) { throw storageError(identity, payload.achievementId, '讀取成就蛋領取標記失敗，請重試。', cause) }
    const existing = markers.find((candidate) => candidate.claimOperationId === identity.claimOperationId)
    if (existing) assertIdentity(existing, identity, payload.achievementId)
    if (existing?.status === 'settled') {
      return { ...cloneReceipt({ ...existing.receipt, status: 'already-applied' }), status: 'already-applied' }
    }

    let state: IncubatorState
    try { state = cloneIncubatorState(await this.persistence.loadState()) }
    catch (cause) { throw storageError(identity, payload.achievementId, '讀取 canonical 孵化所資料失敗，請重試。', cause) }

    if (existing) {
      if (existing.canonicalApplied !== true) {
        const reconciled = achievementEggFromMarker(state, existing)
        try {
          await this.persistence.savePending(reconciled, markers, identity.claimOperationId)
          existing.canonicalApplied = true
        } catch (cause) {
          throw storageError(identity, payload.achievementId, '恢復成就蛋資料失敗，請重試。', cause)
        }
      }
      const settled: AchievementRewardMarker = {
        ...existing,
        status: 'settled',
        canonicalApplied: true,
        settledAt: existing.settledAt ?? this.now(),
      }
      try { await this.persistence.saveMarkers(replaceRewardMarker(markers, settled)) }
      catch (cause) { throw receiptError(identity, payload.achievementId, '成就蛋已寫入，但回條保存失敗；請重試以完成對帳。', cause) }
      return { ...cloneReceipt({ ...existing.receipt, status: 'already-applied' }), status: 'already-applied' }
    }

    const next = addEgg(state, {
      source: 'achievement',
      label: reward.label,
      speciesPool: reward.speciesPool,
    })
    const egg = next.eggs.at(-1)
    if (!egg || next.eggs.length === state.eggs.length) {
      throw rewardError(identity, payload.achievementId, '成就蛋沒有可用的物種池。')
    }
    const appliedAt = this.now()
    const normalizedPayload: AchievementClaimPayload = { achievementId: payload.achievementId, reward }
    const receipt = rewardReceipt(identity, normalizedPayload, appliedAt, { egg: cloneEgg(egg) }, 'applied')
    const pending: AchievementRewardMarker = {
      ...identity,
      destination: 'achievement-egg',
      status: 'pending',
      achievementId: payload.achievementId,
      reward: cloneReward(reward),
      createdAt: appliedAt,
      canonicalApplied: false,
      receipt: withoutStatus(receipt),
    }
    try { await this.persistence.savePending(next, replaceRewardMarker(markers, pending), identity.claimOperationId) }
    catch (cause) { throw storageError(identity, payload.achievementId, '保存成就蛋結果失敗，請重試。', cause) }
    pending.canonicalApplied = true
    const settled: AchievementRewardMarker = { ...pending, status: 'settled', settledAt: appliedAt }
    try { await this.persistence.saveMarkers(replaceRewardMarker(markers, settled)) }
    catch (cause) { throw receiptError(identity, payload.achievementId, '成就蛋已寫入，但回條保存失敗；請重試以完成對帳。', cause) }
    return receipt
  }
}

/** Exactly-once account SP destination, used when an achievement definition chooses an SP reward. */
export class AchievementSpDestination {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly persistence: AchievementSpPersistence,
    private readonly now: () => number = () => Date.now(),
  ) {}

  applyOnce(identity: AchievementClaimIdentity, payload: AchievementClaimPayload): Promise<AchievementRewardReceipt> {
    const run = this.queue.then(() => this.applySerialized(identity, payload))
    this.queue = run.catch(() => undefined)
    return run
  }

  hasApplied(identity: AchievementClaimIdentity): Promise<boolean> {
    const run = this.queue.then(async () => {
      try {
        const marker = (await this.persistence.loadMarkers()).find((candidate) => candidate.claimOperationId === identity.claimOperationId)
        if (!marker) return false
        assertIdentity(marker, identity, marker.achievementId)
        return marker.status === 'settled' || marker.canonicalApplied === true
      } catch (cause) {
        if (cause instanceof AchievementClaimError) throw cause
        throw storageError(identity, '', '讀取成就 SP 領取標記失敗，請重試。', cause)
      }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async applySerialized(identity: AchievementClaimIdentity, payload: AchievementClaimPayload): Promise<AchievementRewardReceipt> {
    const reward = (() => {
      try { return normalizeAchievementReward(payload.reward) }
      catch (cause) { throw rewardError(identity, payload.achievementId, `成就獎勵資料無效：${messageOf(cause)}`, cause) }
    })()
    if (reward.kind !== 'sp') throw rewardError(identity, payload.achievementId, '此成就獎勵不是 SP。')

    let markers: AchievementRewardMarker[]
    try { markers = await this.persistence.loadMarkers() }
    catch (cause) { throw storageError(identity, payload.achievementId, '讀取成就 SP 領取標記失敗，請重試。', cause) }
    const existing = markers.find((candidate) => candidate.claimOperationId === identity.claimOperationId)
    if (existing) assertIdentity(existing, identity, payload.achievementId)
    if (existing?.status === 'settled') {
      return { ...cloneReceipt({ ...existing.receipt, status: 'already-applied' }), status: 'already-applied' }
    }

    let points: number
    try { points = await this.persistence.loadPoints() }
    catch (cause) { throw storageError(identity, payload.achievementId, '讀取 canonical SP 失敗，請重試。', cause) }

    if (existing) {
      if (existing.canonicalApplied !== true) {
        const delta = existing.receipt.delta ?? 0
        try {
          await this.persistence.savePending(points + delta, markers, identity.claimOperationId)
          existing.canonicalApplied = true
        } catch (cause) { throw storageError(identity, payload.achievementId, '恢復成就 SP 資料失敗，請重試。', cause) }
      }
      const settled: AchievementRewardMarker = {
        ...existing,
        status: 'settled',
        canonicalApplied: true,
        settledAt: existing.settledAt ?? this.now(),
      }
      try { await this.persistence.saveMarkers(replaceRewardMarker(markers, settled)) }
      catch (cause) { throw receiptError(identity, payload.achievementId, '成就 SP 已寫入，但回條保存失敗；請重試以完成對帳。', cause) }
      return { ...cloneReceipt({ ...existing.receipt, status: 'already-applied' }), status: 'already-applied' }
    }

    const amount = reward.amount
    const after = points + amount
    const appliedAt = this.now()
    const normalizedPayload: AchievementClaimPayload = { achievementId: payload.achievementId, reward }
    const receipt = rewardReceipt(identity, normalizedPayload, appliedAt, { delta: amount, before: points, after }, 'applied')
    const pending: AchievementRewardMarker = {
      ...identity,
      destination: 'achievement-sp',
      status: 'pending',
      achievementId: payload.achievementId,
      reward: cloneReward(reward),
      createdAt: appliedAt,
      canonicalApplied: false,
      receipt: withoutStatus(receipt),
    }
    try { await this.persistence.savePending(after, replaceRewardMarker(markers, pending), identity.claimOperationId) }
    catch (cause) { throw storageError(identity, payload.achievementId, '保存成就 SP 結果失敗，請重試。', cause) }
    pending.canonicalApplied = true
    const settled: AchievementRewardMarker = { ...pending, status: 'settled', settledAt: appliedAt }
    try { await this.persistence.saveMarkers(replaceRewardMarker(markers, settled)) }
    catch (cause) { throw receiptError(identity, payload.achievementId, '成就 SP 已寫入，但回條保存失敗；請重試以完成對帳。', cause) }
    return receipt
  }
}

export interface AchievementClaimDependencies {
  meta: AchievementMetaPersistence
  egg?: AchievementEggDestination
  sp?: AchievementSpDestination
}

/** Serializes the Meta outbox → reward child → Meta finalize sequence. */
export class AchievementClaimCoordinator {
  private queue: Promise<unknown> = Promise.resolve()

  constructor(
    private readonly dependencies: AchievementClaimDependencies,
    private readonly now: () => number = () => Date.now(),
  ) {}

  claimOnce(achievementId: string): Promise<AchievementClaimResult> {
    const run = this.queue.then(() => this.claimSerialized(achievementId))
    this.queue = run.catch(() => undefined)
    return run
  }

  /** Resume every durable pending outbox. Errors are retained for the next retry. */
  recoverPending(): Promise<AchievementClaimRecovery> {
    const run = this.queue.then(async () => {
      let meta: MetaState
      try { meta = await this.dependencies.meta.loadMeta() }
      catch (cause) {
        return { attempted: 0, completed: 0, errors: [{ achievementId: '*', message: `讀取成就領取資料失敗：${messageOf(cause)}`, code: 'storage' as const }] }
      }
      const pending = (meta.achievementClaims ?? []).filter((entry) => entry.status === 'pending')
      const errors: AchievementClaimRecovery['errors'] = []
      let completed = 0
      for (const entry of pending) {
        try {
          await this.claimSerialized(entry.achievementId)
          completed += 1
        } catch (cause) {
          errors.push({
            achievementId: entry.achievementId,
            message: messageOf(cause),
            ...(cause instanceof AchievementClaimError ? { code: cause.code } : {}),
          })
        }
      }
      return { attempted: pending.length, completed, errors }
    })
    this.queue = run.catch(() => undefined)
    return run
  }

  private async claimSerialized(achievementId: string): Promise<AchievementClaimResult> {
    let meta: MetaState
    try { meta = cloneMeta(await this.dependencies.meta.loadMeta()) }
    catch (cause) {
      const fallback = identityFor(achievementId, { kind: 'sp', label: 'unknown', amount: 0 })
      throw storageError(fallback, achievementId, '讀取圖鑑與成就失敗，請重試。', cause)
    }

    const def = getAchievement(achievementId)
    const existing = (meta.achievementClaims ?? []).find((entry) => entry.achievementId === achievementId)
    const reward = (() => {
      if (existing) return normalizeAchievementReward(existing.reward)
      if (def) return normalizeAchievementReward(def.reward)
      throw new AchievementClaimError('locked', `找不到成就「${achievementId}」。`, { achievementId })
    })()
    const identity = existing
      ? { claimOperationId: existing.claimOperationId, rewardFingerprint: existing.rewardFingerprint }
      : identityFor(achievementId, reward)
    if (existing) assertIdentity(existing, identity, achievementId)
    if (def && identity.rewardFingerprint !== rewardFingerprintFor(achievementId, def.reward)) {
      throw new AchievementClaimError(
        'collision',
        `成就「${achievementId}」的 reward fingerprint 與既有領取資料不同。`,
        { identity, achievementId },
      )
    }

    if (existing?.status === 'settled') {
      return {
        ...identity,
        status: 'already-applied',
        achievementId,
        reward: cloneReward(reward),
        ...(existing.rewardReceipt ? { rewardReceipt: cloneReceipt({ ...existing.rewardReceipt, status: 'already-applied' }) } : {}),
        meta,
      }
    }

    let wasPending = Boolean(existing)
    let outbox = existing
    if (!outbox) {
      const view = computeAchievements(meta).find((candidate) => candidate.def.id === achievementId)
      if (!view || view.claimed) {
        throw new AchievementClaimError('claimed', `成就「${achievementId}」已領取。`, { identity, achievementId })
      }
      if (!view.unlocked) {
        throw new AchievementClaimError('locked', `成就「${achievementId}」尚未達成。`, { identity, achievementId })
      }
      const now = this.now()
      outbox = {
        ...identity,
        destination: 'achievement-meta',
        status: 'pending',
        achievementId,
        reward: cloneReward(reward),
        createdAt: now,
        canonicalApplied: false,
      }
      const pendingMeta: MetaState = {
        ...meta,
        achievementClaims: replaceOutbox(meta.achievementClaims ?? [], outbox),
      }
      try { await this.dependencies.meta.savePending(pendingMeta) }
      catch (cause) { throw storageError(identity, achievementId, '保存成就領取待辦失敗，請重試。', cause) }
      meta = pendingMeta
      wasPending = false
    }

    const payload: AchievementClaimPayload = { achievementId, reward: cloneReward(outbox.reward) }
    let childReceipt: AchievementRewardReceipt
    try {
      if (payload.reward.kind === 'egg') {
        if (!this.dependencies.egg) throw rewardError(identity, achievementId, '孵化所獎勵 boundary 尚未就緒。')
        childReceipt = await this.dependencies.egg.applyOnce(identity, payload)
      } else {
        if (!this.dependencies.sp) throw rewardError(identity, achievementId, 'SP 獎勵 boundary 尚未就緒。')
        childReceipt = await this.dependencies.sp.applyOnce(identity, payload)
      }
    } catch (cause) {
      if (cause instanceof AchievementClaimError) throw cause
      throw rewardError(identity, achievementId, `成就獎勵寫入失敗：${messageOf(cause)}`, cause)
    }

    let latest: MetaState
    try { latest = cloneMeta(await this.dependencies.meta.loadMeta()) }
    catch (cause) { throw receiptError(identity, achievementId, '獎勵已寫入，但讀取 Meta 回條失敗；請重試以完成對帳。', cause) }
    const latestOutbox = (latest.achievementClaims ?? []).find((entry) => entry.claimOperationId === identity.claimOperationId)
    if (!latestOutbox) {
      throw receiptError(identity, achievementId, '獎勵已寫入，但找不到成就待辦回條；請重試以完成對帳。', new Error('missing claim outbox'))
    }
    assertIdentity(latestOutbox, identity, achievementId)
    const settledAt = latestOutbox.settledAt ?? this.now()
    const settledOutbox: AchievementClaimOutbox = {
      ...latestOutbox,
      status: 'settled',
      canonicalApplied: true,
      settledAt,
      rewardReceipt: cloneReceipt(childReceipt),
    }
    const finalMeta = markClaimed({
      ...latest,
      achievementClaims: replaceOutbox(latest.achievementClaims ?? [], settledOutbox),
    }, achievementId, latest.achievements[achievementId] ?? settledAt)
    try { await this.dependencies.meta.saveFinal(finalMeta) }
    catch (cause) { throw receiptError(identity, achievementId, '獎勵已寫入，但成就回條保存失敗；請重試以完成對帳。', cause) }
    return {
      ...identity,
      status: wasPending ? 'already-applied' : (childReceipt.status === 'already-applied' ? 'already-applied' : 'applied'),
      achievementId,
      reward: cloneReward(reward),
      rewardReceipt: cloneReceipt(childReceipt),
      meta: finalMeta,
    }
  }
}

/** Test-friendly in-memory Meta persistence. */
export class MemoryAchievementMetaPersistence implements AchievementMetaPersistence {
  meta: MetaState
  failPending = false
  failFinal = false
  savePendingCount = 0
  saveFinalCount = 0

  constructor(meta: MetaState) { this.meta = cloneMeta(meta) }

  async loadMeta(): Promise<MetaState> { return cloneMeta(this.meta) }

  async savePending(meta: MetaState): Promise<void> {
    this.savePendingCount += 1
    if (this.failPending) throw new Error('achievement Meta pending write failed')
    this.meta = cloneMeta(meta)
  }

  async saveFinal(meta: MetaState): Promise<void> {
    this.saveFinalCount += 1
    if (this.failFinal) throw new Error('achievement Meta final write failed')
    this.meta = cloneMeta(meta)
  }
}

/** Test-friendly in-memory egg boundary. */
export class MemoryAchievementEggPersistence implements AchievementEggPersistence {
  state: IncubatorState
  markers: AchievementRewardMarker[] = []
  failPending = false
  failMarker = false
  savePendingCount = 0

  constructor(state: IncubatorState) { this.state = cloneIncubatorState(state) }

  async loadState(): Promise<IncubatorState> { return cloneIncubatorState(this.state) }
  async loadMarkers(): Promise<AchievementRewardMarker[]> { return this.markers.map(cloneMarker) }

  async savePending(state: IncubatorState, markers: AchievementRewardMarker[], operationId?: string): Promise<void> {
    if (this.failPending) throw new Error('achievement egg pending write failed')
    this.savePendingCount += 1
    const completed = markers.map((marker) => marker.claimOperationId === operationId ? { ...marker, canonicalApplied: true } : marker)
    this.state = { ...cloneIncubatorState(state), achievementClaims: completed.map(cloneMarker) }
    this.markers = completed.map(cloneMarker)
  }

  async saveMarkers(markers: AchievementRewardMarker[]): Promise<void> {
    if (this.failMarker) throw new Error('achievement egg receipt write failed')
    this.markers = markers.map(cloneMarker)
    this.state = { ...this.state, achievementClaims: markers.map(cloneMarker) }
  }
}

/** Test-friendly in-memory SP boundary. */
export class MemoryAchievementSpPersistence implements AchievementSpPersistence {
  points: number
  markers: AchievementRewardMarker[] = []
  failPending = false
  failMarker = false
  savePendingCount = 0

  constructor(points = 0) { this.points = points }

  async loadPoints(): Promise<number> { return this.points }
  async loadMarkers(): Promise<AchievementRewardMarker[]> { return this.markers.map(cloneMarker) }

  async savePending(points: number, markers: AchievementRewardMarker[], operationId?: string): Promise<void> {
    if (this.failPending) throw new Error('achievement SP pending write failed')
    this.savePendingCount += 1
    const completed = markers.map((marker) => marker.claimOperationId === operationId ? { ...marker, canonicalApplied: true } : marker)
    this.points = points
    this.markers = completed.map(cloneMarker)
  }

  async saveMarkers(markers: AchievementRewardMarker[]): Promise<void> {
    if (this.failMarker) throw new Error('achievement SP receipt write failed')
    this.markers = markers.map(cloneMarker)
  }
}

// Keep these exports available to persistence adapters without exposing mutable internals.
export { cloneIncubatorState as cloneAchievementIncubatorState, cloneMeta as cloneAchievementMeta, cloneReward as cloneAchievementReward }
